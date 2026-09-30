import { RendererMethodUnavailableError } from "./renderer-request-sender.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import type { GitWorkflowSnapshot, GitWorkflowParams } from "@codexhost/shared-contracts";
import { gitButtonLoadingStyles } from "./renderer-git-loading.js";
import { createVisiblePoll } from "./renderer-visible-poll.js";

interface Client extends Pick<RendererModelClient, "inspectTurnActions" | "executeTurnAction"> {
  inspectGitWorkflow(input: GitWorkflowParams): Promise<GitWorkflowSnapshot>;
  runGitWorkflow(input: GitWorkflowParams): Promise<GitWorkflowSnapshot>;
}
interface Context {
  anchor: Element;
  threadId: GitWorkflowParams["threadId"];
  client: Client;
}

// 只把按钮挂在当前主聊天的 Composer 附近，结果始终归属于发起请求的 Host 和任务。
export function installRendererGitWorkflowControl(getContext: () => Context | null) {
  const root = document.createElement("div");
  root.dataset.codexhostGitWorkflow = "";
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { display:flex; margin:4px 0; color:inherit; font:11px/1.5 var(--font-sans,system-ui); }
    .row { display:flex; align-items:center; gap:8px; min-width:0; }
    button { flex:none; min-height:26px; padding:3px 9px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); border-radius:6px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
    button:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
    button:focus-visible { outline:2px solid var(--text-link,#339cff); outline-offset:2px; }
    button:disabled { opacity:.5; cursor:default; }
    span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; opacity:.65; }
    span[data-error=true] { color:var(--color-text-danger,#d65f55); opacity:1; }
    ${gitButtonLoadingStyles}
  `;
  const row = document.createElement("div");
  row.className = "row";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "推送代码";
  button.title = "提交项目改动并推送；项目内所有任务结束后也会自动触发";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  row.append(button, status);
  shadow.append(style, row);
  let context: Context | null = null;
  let snapshot: GitWorkflowSnapshot | null = null;
  let disposed = false;
  let generation = 0;
  const requests = new WeakMap<Client, Set<string>>();
  const attempts = new WeakMap<Client, Map<string, string>>();
  let reading = false;
  let rendered = "";

  const pending = (): boolean =>
    Boolean(context && requests.get(context.client)?.has(context.threadId));
  const render = (): void => {
    const busy =
      pending() ||
      snapshot?.phase === "starting" ||
      snapshot?.phase === "running" ||
      snapshot?.phase === "waiting";
    const signature = JSON.stringify([
      Boolean(context),
      busy,
      snapshot?.workspace,
      snapshot?.phase,
      snapshot?.message,
    ]);
    if (rendered === signature) return;
    rendered = signature;
    button.disabled = !context || busy || (snapshot !== null && snapshot.workspace === null);
    button.setAttribute("aria-busy", String(busy));
    status.textContent = snapshot?.message ?? "全部任务结束后自动推送";
    status.title = snapshot?.workspace
      ? `${snapshot.workspace}\n${status.textContent}`
      : status.textContent;
    status.dataset.error = String(snapshot?.phase === "failed");
  };
  const refreshContext = (): void => {
    const next = disposed ? null : getContext();
    if (context?.client !== next?.client || context?.threadId !== next?.threadId) {
      generation++;
      snapshot = null;
      reading = false;
    }
    context = next;
    poll.setActive(Boolean(next));
    if (!next) {
      root.remove();
      return;
    }
    if (root.parentElement !== next.anchor.parentElement) next.anchor.before(root);
    render();
  };
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    refreshContext();
    if (document.hidden) return;
    const request = context;
    const version = generation;
    if (!request || reading || pending()) return;
    reading = true;
    try {
      const value = await request.client.inspectGitWorkflow({ threadId: request.threadId });
      if (!disposed && generation === version) snapshot = value;
    } catch (error) {
      if (!disposed && generation === version) {
        rendered = "";
        status.textContent = error instanceof Error ? error.message : String(error);
        status.dataset.error = "true";
      }
      return;
    } finally {
      if (generation === version) reading = false;
    }
    if (!disposed && generation === version) render();
  };
  button.addEventListener("click", () => {
    refreshContext();
    if (!context || button.disabled) return;
    const request = context;
    let threads = requests.get(request.client);
    if (!threads) {
      threads = new Set();
      requests.set(request.client, threads);
    }
    threads.add(request.threadId);
    const version = ++generation;
    reading = false;
    render();
    const run = async (): Promise<GitWorkflowSnapshot> => {
      if (request.client.inspectTurnActions && request.client.executeTurnAction) {
        try {
          const actions = await request.client.inspectTurnActions({ threadId: request.threadId });
          const action = actions.actions.find(({ actionId }) => actionId === "git.commit_push");
          if (!action?.enabled || !actions.latestTurnId)
            throw new Error(action?.disabledReason ?? "请先完成一个聊天回合");
          let clientAttempts = attempts.get(request.client);
          if (!clientAttempts) {
            clientAttempts = new Map();
            attempts.set(request.client, clientAttempts);
          }
          const key = `${request.threadId}:${actions.latestTurnId}:${action.version}`;
          const invocationId = clientAttempts.get(key) ?? crypto.randomUUID();
          clientAttempts.set(key, invocationId);
          const result = await request.client.executeTurnAction({
            threadId: request.threadId,
            sourceTurnId: actions.latestTurnId,
            actionId: action.actionId,
            version: action.version,
            invocationId,
          });
          return {
            workspace: snapshot?.workspace ?? null,
            threadId: request.threadId,
            turnId: result.executionTurnId ?? null,
            phase:
              result.state === "running"
                ? "running"
                : result.state === "completed"
                  ? "completed"
                  : "failed",
            message:
              result.message ??
              (result.state === "running" ? "提交并推送工作流运行中…" : "请查看实际回合结果"),
          };
        } catch (error) {
          if (!(error instanceof RendererMethodUnavailableError)) throw error;
        }
      }
      return request.client.runGitWorkflow({ threadId: request.threadId });
    };
    void run()
      .then((value) => {
        if (!disposed && generation === version) snapshot = value;
      })
      .catch((error) => {
        if (!disposed && generation === version) {
          snapshot = {
            workspace: snapshot?.workspace ?? "",
            phase: "failed",
            threadId: request.threadId,
            turnId: null,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      })
      .finally(() => {
        threads.delete(request.threadId);
        if (!disposed) {
          render();
          void refresh();
        }
      });
  });
  const poll = createVisiblePoll(document, 1500, () => void refresh());
  void refresh();
  return {
    refreshContext,
    dispose() {
      disposed = true;
      generation++;
      poll.dispose();
      root.remove();
    },
  };
}
