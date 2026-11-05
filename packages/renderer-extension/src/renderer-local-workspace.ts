import {
  LOCAL_WORKSPACE_PREPARE_METHOD,
  localWorkspacePrepareParamsSchema,
  localWorkspacePrepareResultSchema,
  hostThreadIdSchema,
} from "@codexhost/shared-contracts";
import {
  captureLocalWorkspaceContext,
  localContinuationMessage,
  readLocalWorkspaceContexts,
  saveLocalWorkspaceContext,
  type LocalWorkspaceContext,
} from "./local-workspace-context.js";
import { localWorkspaceMessages } from "./local-workspace-messages.js";
import { restoreRemoteProject } from "./renderer-remote-project-restore.js";
import { createVisiblePoll } from "./renderer-visible-poll.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";

type Target = { hostId: string; threadId: string };
interface Manager {
  sendRequest(method: string, params: unknown, options?: unknown): unknown;
}
const BINDINGS_KEY = "codexhost.local-workspace-bindings.v1";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 标题栏入口与只读上下文缓存共用当前会话身份，不依赖远程 Host 扩展。 */
export function installRendererLocalWorkspace(options: {
  getActiveThread(): Target | null;
  getLocale(): string;
  getManager(hostId: string): Manager | null;
  openThread(threadId: string): Promise<void>;
}) {
  if (typeof document.createElement !== "function" || !document.head?.append) {
    return { refresh() {}, dispose() {} };
  }
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-codexhost-local-workspace", "");
  const style = document.createElement("style");
  style.textContent = `
    [data-codexhost-local-workspace]{flex:none;border:1px solid var(--color-border,#8885);border-radius:6px;background:transparent;color:inherit;padding:3px 8px;cursor:pointer;font:inherit;-webkit-app-region:no-drag}
    [data-codexhost-local-workspace-dialog]{box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;border:1px solid var(--color-border,#8885);border-radius:12px;padding:20px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,CanvasText);color-scheme:inherit}
    [data-codexhost-local-workspace-dialog]::backdrop{background:#0006}
    [data-codexhost-local-workspace-dialog] form{display:grid;gap:12px}
    [data-codexhost-local-workspace-dialog] label{display:grid;gap:6px;font-size:13px}
    [data-codexhost-local-workspace-dialog] input{box-sizing:border-box;width:100%;padding:8px;border:1px solid #8885;border-radius:6px;background:transparent;color:inherit;font:inherit}
    [data-codexhost-local-workspace-dialog] button{padding:6px 10px;border:1px solid #8885;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit}
    [data-codexhost-local-workspace-dialog] button:disabled{opacity:.5;cursor:default}
    [data-codexhost-local-workspace-dialog] [role=status]{white-space:pre-wrap;font-size:13px;overflow-wrap:anywhere}
  `;
  document.head.append(style);
  let disposed = false;
  let activeKey = "";
  let dialog: HTMLDialogElement | null = null;
  let cacheError = "";
  const contexts = new Map<string, LocalWorkspaceContext>();
  const pending = new Map<string, Promise<LocalWorkspaceContext>>();
  const key = (target: Target) => JSON.stringify([target.hostId, target.threadId]);
  try {
    for (const context of readLocalWorkspaceContexts(window.localStorage).reverse())
      contexts.set(key(context), context);
  } catch (error) {
    cacheError = errorText(error);
  }

  const capture = (target: Target): Promise<LocalWorkspaceContext> => {
    const id = key(target);
    const existing = pending.get(id);
    if (existing) return existing;
    const manager = options.getManager(target.hostId);
    if (!manager) return Promise.reject(new Error("Remote Host unavailable"));
    const operation = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          Promise.resolve(
            manager.sendRequest(
              "thread/read",
              { threadId: target.threadId, includeTurns: true },
              { priority: "background", timeoutMs: 8000 },
            ),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Remote history timed out")), 8000);
          }),
        ]);
        if (disposed || options.getManager(target.hostId) !== manager)
          throw new Error("Connection changed");
        const context = captureLocalWorkspaceContext(
          target.hostId,
          target.threadId,
          record(response).thread,
        );
        contexts.delete(id);
        contexts.set(id, context);
        if (contexts.size > 8) {
          const oldest = contexts.keys().next().value;
          if (oldest) contexts.delete(oldest);
        }
        try {
          saveLocalWorkspaceContext(window.localStorage, context);
          cacheError = "";
        } catch (error) {
          cacheError = errorText(error);
        }
        return context;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      pending.delete(id);
    });
    pending.set(id, operation);
    return operation;
  };
  const captureActive = () => {
    const target = options.getActiveThread();
    if (target && target.hostId !== "local") {
      // 后台失败保留最后成功快照；入口中显示缓存时间，不把旧快照标成新读取。
      void capture(target).catch(() => undefined);
    }
  };
  const poll = createVisiblePoll(document, 30_000, captureActive);

  const open = async () => {
    const target = options.getActiveThread();
    if (disposed || dialog || !target || target.hostId === "local") return;
    const copy = localWorkspaceMessages(options.getLocale());
    const panel = document.createElement("dialog");
    dialog = panel;
    panel.setAttribute("data-codexhost-local-workspace-dialog", "");
    const form = document.createElement("form");
    const heading = document.createElement("strong");
    heading.id = "codexhost-local-workspace-heading";
    heading.textContent = copy.title;
    panel.setAttribute("aria-labelledby", heading.id);
    const help = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "?";
    summary.setAttribute("aria-label", copy.title);
    help.append(summary, document.createTextNode(copy.details));
    const field = (label: string) => {
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      wrapper.append(document.createTextNode(label), input);
      return { wrapper, input };
    };
    const folder = field(copy.path);
    const remote = field(copy.remote);
    folder.input.required = true;
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.textContent = copy.loading;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = copy.start;
    submit.disabled = true;
    const navigate = document.createElement("button");
    navigate.type = "button";
    navigate.textContent = copy.open;
    navigate.hidden = true;
    navigate.disabled = true;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = copy.close;
    form.append(heading, help, folder.wrapper, remote.wrapper, status, submit, navigate, close);
    panel.append(form);
    document.body.append(panel);
    let busy = false;
    let localThreadId: string | null = null;
    let creationAttempted = false;
    panel.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    panel.addEventListener("close", () => {
      panel.remove();
      if (dialog === panel) dialog = null;
      button.focus();
    });
    close.addEventListener("click", () => panel.close());
    panel.showModal();
    let context: LocalWorkspaceContext | undefined;
    let cached = false;
    try {
      context = await capture(target);
    } catch {
      context = contexts.get(key(target));
      cached = true;
    }
    if (disposed || dialog !== panel) return;
    if (!context) {
      status.textContent = copy.missing;
      return;
    }
    const snapshot = context;
    heading.textContent = `${copy.title} · ${snapshot.title}`;
    const bindingKey = JSON.stringify([target.hostId, snapshot.cwd]);
    const contextStatus = `${cached ? copy.cached : copy.fresh} · ${new Date(snapshot.capturedAt).toLocaleString()}${snapshot.truncated ? `\n${copy.partial}` : ""}`;
    status.textContent = contextStatus;
    if (cacheError) status.textContent += `\n${copy.cacheFailed}${cacheError}`;
    remote.input.value = snapshot.remote;
    try {
      const bindings = record(JSON.parse(window.localStorage.getItem(BINDINGS_KEY) ?? "{}"));
      const binding = record(bindings[bindingKey]);
      folder.input.value = typeof binding.path === "string" ? binding.path : "";
      if (typeof binding.remote === "string") remote.input.value = binding.remote;
    } catch (error) {
      status.textContent += `\n${copy.cacheFailed}${errorText(error)}`;
    }
    submit.disabled = false;
    folder.input.focus();
    const openLocal = async () => {
      if (!localThreadId) return;
      await options.openThread(localThreadId);
      panel.close();
    };
    navigate.addEventListener("click", () => {
      void openLocal().catch((error) => {
        status.textContent = copy.failed + errorText(error);
      });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (busy || creationAttempted) return;
      const manager = options.getManager("local");
      if (!manager) {
        status.textContent = copy.localMissing;
        return;
      }
      const request = async (method: string, params: unknown): Promise<unknown> => {
        if (disposed || options.getManager("local") !== manager) throw new Error(copy.localMissing);
        return manager.sendRequest(method, params, { priority: "interactive", timeoutMs: 90_000 });
      };
      busy = true;
      submit.disabled = true;
      close.disabled = true;
      folder.input.disabled = true;
      remote.input.disabled = true;
      status.textContent = copy.working;
      void (async () => {
        const params = localWorkspacePrepareParamsSchema.parse({
          path: folder.input.value,
          ...(remote.input.value.trim() ? { remote: remote.input.value.trim() } : {}),
        });
        const prepared = localWorkspacePrepareResultSchema.parse(
          await request(LOCAL_WORKSPACE_PREPARE_METHOD, params),
        );
        const bindings = record(JSON.parse(window.localStorage.getItem(BINDINGS_KEY) ?? "{}"));
        bindings[bindingKey] = { path: prepared.path, remote: params.remote ?? "" };
        window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
        creationAttempted = true;
        const started = record(
          await request("thread/start", {
            cwd: prepared.path,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
          }),
        );
        localThreadId = hostThreadIdSchema.parse(record(started.thread).id);
        navigate.hidden = false;
        status.textContent = copy.created;
        await request("turn/start", {
          threadId: localThreadId,
          input: [{ type: "text", text: localContinuationMessage(snapshot, prepared.path) }],
        });
        await restoreRemoteProject(request, {
          key: localThreadId.replaceAll("-", "").slice(0, 16),
          name: prepared.path.split(/[\\/]/u).filter(Boolean).at(-1) ?? snapshot.title,
          roots: [prepared.path],
          threads: [{ id: localThreadId, name: snapshot.title, updatedAt: Date.now() }],
        });
        status.textContent = copy.complete;
        await openLocal();
      })()
        .catch((error) => {
          status.textContent = `${copy.failed}${errorText(error)}${localThreadId ? `\n${copy.created}\n${localThreadId}` : creationAttempted ? `\n${copy.uncertain}` : ""}`;
        })
        .finally(() => {
          busy = false;
          submit.disabled = creationAttempted;
          navigate.disabled = false;
          close.disabled = false;
          folder.input.disabled = localThreadId !== null;
          remote.input.disabled = localThreadId !== null;
        });
    });
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void open().catch((error) => {
      const status = dialog?.querySelector('[role="status"]');
      if (status)
        status.textContent = localWorkspaceMessages(options.getLocale()).failed + errorText(error);
    });
  });
  const refresh = () => {
    if (disposed) return;
    const target = options.getActiveThread();
    const remote = target !== null && target.hostId !== "local";
    poll.setActive(remote);
    const label = localWorkspaceMessages(options.getLocale()).switch;
    if (button.textContent !== label) button.textContent = label;
    const titlebar = document.querySelector("[data-app-shell-titlebar-content]");
    if (remote && titlebar && button.parentElement !== titlebar) titlebar.append(button);
    if (!remote) button.remove();
    const next = remote ? key(target) : "";
    if (activeKey !== next) {
      activeKey = next;
      captureActive();
    }
  };
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList"],
    test: (mutation) => mutationAffectsElements(mutation, "[data-app-shell-titlebar-content]"),
    onMutate: () => refresh(),
  });
  return {
    refresh,
    dispose() {
      disposed = true;
      poll.dispose();
      stopObserving();
      dialog?.remove();
      dialog = null;
      button.remove();
      style.remove();
    },
  };
}
