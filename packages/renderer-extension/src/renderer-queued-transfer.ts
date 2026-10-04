import createElement from "lucide/dist/esm/createElement.mjs";
import ArrowRightLeft from "lucide/dist/esm/icons/arrow-right-left.mjs";
import X from "lucide/dist/esm/icons/x.mjs";

import { CODEX_COMPOSER_SELECTOR } from "./renderer-composer-dom.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  findComposerModelTarget,
  threadIdFromComposerModelTarget,
} from "./versioned-renderer-adapter.js";

const ACTION_ATTRIBUTE = "data-codexhost-queued-transfer";
const PANEL_ATTRIBUTE = "data-codexhost-queued-transfer-panel";
const MORE_SELECTOR =
  'button[aria-label="排队消息操作"],button[aria-label="Queued message actions"]';
const SEARCH_LIMIT = 50;
const MAX_SEARCH_PAGES = 3;

const style = `
[${ACTION_ATTRIBUTE}]{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
[${ACTION_ATTRIBUTE}]:hover,[${ACTION_ATTRIBUTE}]:focus-visible{background:color-mix(in srgb,currentColor 12%,transparent)}
[${ACTION_ATTRIBUTE}]:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[${PANEL_ATTRIBUTE}]{position:fixed;z-index:1300;box-sizing:border-box;width:min(380px,calc(100vw - 16px));max-height:calc(100dvh - 16px);padding:8px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:8px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-primary,inherit);box-shadow:0 8px 24px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[${PANEL_ATTRIBUTE}] .codexhost-transfer-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px 8px;font-weight:600}
[${PANEL_ATTRIBUTE}] .codexhost-transfer-close{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer}
[${PANEL_ATTRIBUTE}] input{box-sizing:border-box;width:100%;height:32px;padding:5px 8px;border:1px solid var(--color-border,rgba(127,127,127,.3));border-radius:6px;background:var(--color-background-primary,transparent);color:inherit;font:inherit;outline:none}
[${PANEL_ATTRIBUTE}] input:focus{border-color:#508df2}
[${PANEL_ATTRIBUTE}] [role="listbox"]{max-height:min(240px,calc(100dvh - 112px));overflow-y:auto;padding-top:4px}
[${PANEL_ATTRIBUTE}] [role="option"]{display:block;box-sizing:border-box;width:100%;min-height:38px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
[${PANEL_ATTRIBUTE}] [role="option"]:hover,[${PANEL_ATTRIBUTE}] [role="option"][aria-selected="true"]{background:color-mix(in srgb,currentColor 12%,transparent)}
[${PANEL_ATTRIBUTE}] [role="option"]:disabled{opacity:.55;cursor:wait}
[${PANEL_ATTRIBUTE}] .codexhost-transfer-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[${PANEL_ATTRIBUTE}] .codexhost-transfer-cwd{display:block;overflow:hidden;color:var(--color-token-text-secondary,#888);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
[${PANEL_ATTRIBUTE}] [role="status"],[${PANEL_ATTRIBUTE}] [role="alert"]{padding:7px 8px;overflow-wrap:anywhere;color:var(--color-token-text-secondary,#888)}
[${PANEL_ATTRIBUTE}] [role="alert"]{color:var(--color-token-text-warning,#b77b20)}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type Method = (...args: unknown[]) => unknown;
const disposeSymbol =
  (Symbol as unknown as { dispose?: symbol }).dispose ?? Symbol.for("Symbol.dispose");

interface QueueMessage {
  id: string;
  text: string;
  cwd: string;
  context: Record<string, unknown>;
  submission?: { status?: unknown };
}

interface RemovedMessage {
  message: QueueMessage;
  index: number;
  previousMessageId: string | null;
  nextMessageId: string | null;
  serverSubmission?: unknown;
}

interface QueueCoordinator {
  loadMessages(threadId: string): Promise<unknown>;
  readMessages(threadId: string): unknown;
  removeQueuedMessage(threadId: string, messageId: string): Promise<unknown>;
  restoreQueuedMessage(threadId: string, removed: RemovedMessage): Promise<unknown>;
  deferAutomaticTurns?(threadId: string): unknown;
}

export interface QueuedTransferManager {
  sendRequest(method: string, params: unknown): Promise<unknown> | unknown;
  getTurnCoordinator(): unknown;
  getConversationCwd(threadId: string): unknown;
  getConversation(threadId: string): unknown;
  sendFollowUpMessage(threadId: string, options: unknown): Promise<unknown> | unknown;
  resumeConversation?(options: unknown): Promise<unknown> | unknown;
}

export function isQueuedTransferManager(value: unknown): value is QueuedTransferManager {
  return (
    isRecord(value) &&
    [
      "sendRequest",
      "getTurnCoordinator",
      "getConversationCwd",
      "getConversation",
      "sendFollowUpMessage",
    ].every((name) => typeof value[name] === "function")
  );
}

export interface QueuedTransferTarget {
  id: string;
  title: string;
  cwd: string;
}

function queueCoordinator(manager: QueuedTransferManager): QueueCoordinator {
  const value = manager.getTurnCoordinator();
  if (
    !isRecord(value) ||
    typeof value.loadMessages !== "function" ||
    typeof value.readMessages !== "function" ||
    typeof value.removeQueuedMessage !== "function" ||
    typeof value.restoreQueuedMessage !== "function"
  ) {
    throw new Error("当前桌面版不支持排队消息转移");
  }
  return value as unknown as QueueCoordinator;
}

function queueMessage(value: unknown): value is QueueMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.cwd === "string" &&
    isRecord(value.context)
  );
}

export async function searchQueuedTransferTargets(
  manager: QueuedTransferManager,
  sourceThreadId: string,
  searchTerm: string,
): Promise<QueuedTransferTarget[]> {
  const targets: QueuedTransferTarget[] = [];
  const seen = new Set<string>([sourceThreadId]);
  let cursor: string | null = null;
  for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
    const response: unknown = await manager.sendRequest("thread/list", {
      archived: false,
      sortKey: "updated_at",
      sortDirection: "desc",
      limit: SEARCH_LIMIT,
      ...(searchTerm.trim() ? { searchTerm: searchTerm.trim() } : {}),
      ...(cursor ? { cursor } : {}),
    });
    if (!isRecord(response) || !Array.isArray(response.data)) {
      throw new Error("无法读取目标会话");
    }
    for (const value of response.data) {
      if (!isRecord(value) || typeof value.id !== "string" || seen.has(value.id)) continue;
      seen.add(value.id);
      if (value.canAcceptDirectInput === false || typeof value.cwd !== "string") continue;
      const title = typeof value.name === "string" ? value.name.trim() : "";
      const preview = typeof value.preview === "string" ? value.preview.trim().split("\n")[0] : "";
      targets.push({ id: value.id, title: title || preview || "未命名会话", cwd: value.cwd });
    }
    if (typeof response.nextCursor !== "string" || !response.nextCursor) break;
    if (response.nextCursor === cursor) throw new Error("目标会话分页游标重复");
    cursor = response.nextCursor;
  }
  return targets;
}

export async function transferQueuedMessage(input: {
  manager: QueuedTransferManager;
  sourceThreadId: string;
  messageId: string;
  target: QueuedTransferTarget;
}): Promise<void> {
  const { manager, sourceThreadId, messageId, target } = input;
  if (sourceThreadId === target.id) throw new Error("请选择另一个会话");
  const coordinator = queueCoordinator(manager);
  await coordinator.loadMessages(sourceThreadId);
  const messages = coordinator.readMessages(sourceThreadId);
  const message = Array.isArray(messages)
    ? messages.find((candidate) => isRecord(candidate) && candidate.id === messageId)
    : null;
  if (!queueMessage(message)) throw new Error("这条排队消息已不存在");
  if (message.submission?.status && message.submission.status !== "queued") {
    throw new Error("正在发送或结果未知的消息不能转移");
  }
  const prompt = message.text.trim() || String(message.context.prompt ?? "").trim();
  if (!prompt) throw new Error("仅含附件的消息暂不能转移，请先编辑并添加文字");

  if (manager.getConversationCwd(target.id) !== target.cwd) {
    if (!manager.resumeConversation) throw new Error("无法确认目标会话的工作目录");
    const result: unknown = await manager.resumeConversation({
      conversationId: target.id,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      workspaceRoots: [target.cwd],
      collaborationMode: null,
    });
    if (isRecord(result) && result.status === "not-ready") {
      throw new Error("目标会话尚未就绪");
    }
    if (manager.getConversationCwd(target.id) !== target.cwd) {
      throw new Error("目标会话的工作目录已变化，请重新选择");
    }
  }

  const deferral = coordinator.deferAutomaticTurns?.(sourceThreadId);
  let removed: RemovedMessage | null = null;
  try {
    const result = await coordinator.removeQueuedMessage(sourceThreadId, messageId);
    if (!isRecord(result) || !queueMessage(result.message)) {
      throw new Error("这条排队消息已被发送或移除");
    }
    removed = result as unknown as RemovedMessage;
    const context = {
      ...removed.message.context,
      prompt,
      workspaceRoots: [target.cwd],
      messageThreadId: undefined,
      priorConversation: undefined,
    };
    await manager.sendFollowUpMessage(target.id, {
      prompt,
      attachmentContext: context,
    });
  } catch (error) {
    if (removed) {
      try {
        await coordinator.restoreQueuedMessage(sourceThreadId, removed);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "转移失败，原排队消息也未能恢复");
      }
    }
    throw error;
  } finally {
    const dispose = isRecord(deferral) ? Reflect.get(deferral, disposeSymbol) : null;
    if (typeof dispose === "function") {
      (dispose as Method).call(deferral);
    }
  }
}

interface QueueRow {
  button: HTMLButtonElement;
  composer: Element;
  hostId: string;
  threadId: string;
  messageId: string;
}

function queueRow(button: HTMLButtonElement): QueueRow | null {
  const composer = button.closest(CODEX_COMPOSER_SELECTOR);
  if (!composer) return null;
  const threadId = threadIdFromComposerModelTarget(findComposerModelTarget(composer));
  if (!threadId) return null;
  const fiberNames = Object.getOwnPropertyNames(button).filter((name) =>
    name.startsWith("__reactFiber$"),
  );
  if (fiberNames.length !== 1) return null;
  let fiber = Object.getOwnPropertyDescriptor(button, fiberNames[0] as string)?.value;
  let messageId: string | null = null;
  let hostId: string | null = null;
  for (let depth = 0; isRecord(fiber) && depth < 40; depth += 1) {
    const props = fiber.memoizedProps;
    if (
      isRecord(props) &&
      typeof props.messageId === "string" &&
      typeof props.onDeleteMessage === "function"
    ) {
      messageId = props.messageId;
      hostId = typeof props.hostId === "string" ? props.hostId : null;
      break;
    }
    fiber = fiber.return;
  }
  return messageId && hostId ? { button, composer, hostId, threadId, messageId } : null;
}

export function installRendererQueuedTransfer(options: {
  getManager(hostId: string): QueuedTransferManager | null;
  getLocale(): "zh-CN" | "en";
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const mounted = new Map<HTMLButtonElement, HTMLButtonElement>();
  let panel: HTMLElement | null = null;
  let closed = false;
  let scheduled = false;
  let requestId = 0;
  let nextListId = 0;
  let searchTimer: number | null = null;

  const close = (): void => {
    requestId += 1;
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = null;
    panel?.remove();
    panel = null;
  };

  const show = (row: QueueRow): void => {
    close();
    const locale = options.getLocale();
    const manager = options.getManager(row.hostId);
    if (!manager) return;
    const current = document.createElement("div");
    current.setAttribute(PANEL_ATTRIBUTE, "");
    const header = document.createElement("div");
    header.className = "codexhost-transfer-header";
    header.textContent = locale === "zh-CN" ? "转移并发送到会话" : "Move and send to conversation";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "codexhost-transfer-close";
    dismiss.setAttribute("aria-label", locale === "zh-CN" ? "关闭" : "Close");
    dismiss.append(createElement(X, { width: 15, height: 15, "aria-hidden": "true" }));
    dismiss.addEventListener("click", close);
    header.append(dismiss);
    const input = document.createElement("input");
    const list = document.createElement("div");
    const listId = `codexhost-queued-targets-${++nextListId}`;
    input.type = "search";
    input.placeholder = locale === "zh-CN" ? "搜索会话标题" : "Search conversation titles";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", listId);
    list.id = listId;
    list.setAttribute("role", "listbox");
    current.append(header, input, list);
    document.body.append(current);
    panel = current;
    const bounds = row.button.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 16);
    current.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
    current.style.top = `${Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 340))}px`;
    input.focus();

    let targets: QueuedTransferTarget[] = [];
    let selected = 0;
    let pending = false;
    const notice = (message: string, error = false): void => {
      list.replaceChildren();
      const status = document.createElement("div");
      status.setAttribute("role", error ? "alert" : "status");
      status.textContent = message;
      list.append(status);
    };
    const render = (): void => {
      list.replaceChildren();
      if (targets.length === 0) {
        notice(locale === "zh-CN" ? "没有匹配的会话" : "No matching conversations");
        return;
      }
      targets.forEach((target, index) => {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.setAttribute("role", "option");
        choice.setAttribute("aria-selected", String(index === selected));
        choice.disabled = pending;
        const title = document.createElement("span");
        title.className = "codexhost-transfer-title";
        title.textContent = target.title;
        const cwd = document.createElement("span");
        cwd.className = "codexhost-transfer-cwd";
        cwd.textContent = target.cwd;
        choice.append(title, cwd);
        choice.addEventListener("click", () => void move(target));
        list.append(choice);
      });
    };
    const move = async (target: QueuedTransferTarget): Promise<void> => {
      if (pending) return;
      pending = true;
      requestId += 1;
      if (searchTimer !== null) window.clearTimeout(searchTimer);
      searchTimer = null;
      input.disabled = true;
      render();
      try {
        if (options.getManager(row.hostId) !== manager) {
          throw new Error(locale === "zh-CN" ? "Host 连接已变化" : "Host connection changed");
        }
        await transferQueuedMessage({
          manager,
          sourceThreadId: row.threadId,
          messageId: row.messageId,
          target,
        });
        if (panel === current) {
          input.remove();
          notice(locale === "zh-CN" ? `已转移到「${target.title}」` : `Moved to “${target.title}”`);
        }
      } catch (error) {
        if (panel === current) {
          pending = false;
          input.disabled = false;
          render();
          const alert = document.createElement("div");
          alert.setAttribute("role", "alert");
          alert.textContent = error instanceof Error ? error.message : String(error);
          list.prepend(alert);
          input.focus();
        }
      }
    };
    const search = async (): Promise<void> => {
      const id = ++requestId;
      notice(locale === "zh-CN" ? "正在查找会话…" : "Searching conversations…");
      try {
        const result = await searchQueuedTransferTargets(manager, row.threadId, input.value);
        if (panel !== current || id !== requestId) return;
        targets = result;
        selected = 0;
        render();
      } catch (error) {
        if (panel === current && id === requestId) {
          notice(error instanceof Error ? error.message : String(error), true);
        }
      }
    };
    input.addEventListener("input", () => {
      requestId += 1;
      if (searchTimer !== null) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void search(), 140);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        selected =
          (selected + (event.key === "ArrowDown" ? 1 : -1) + targets.length) %
          (targets.length || 1);
        render();
      } else if (event.key === "Enter" && targets[selected]) {
        event.preventDefault();
        void move(targets[selected] as QueuedTransferTarget);
      }
    });
    void search();
  };

  const scan = (): void => {
    scheduled = false;
    if (closed) return;
    const buttons = new Set(document.querySelectorAll<HTMLButtonElement>(MORE_SELECTOR));
    for (const [more, transfer] of mounted) {
      if (!buttons.has(more) || transfer.parentElement !== more.parentElement) {
        transfer.remove();
        mounted.delete(more);
      }
    }
    for (const more of buttons) {
      if (mounted.has(more)) continue;
      const row = queueRow(more);
      if (!row || !options.getManager(row.hostId) || !more.parentElement) continue;
      const transfer = document.createElement("button");
      transfer.type = "button";
      transfer.setAttribute(ACTION_ATTRIBUTE, "");
      const label = options.getLocale() === "zh-CN" ? "转移到会话" : "Move to conversation";
      transfer.title = label;
      transfer.setAttribute("aria-label", label);
      transfer.append(
        createElement(ArrowRightLeft, { width: 16, height: 16, "aria-hidden": "true" }),
      );
      transfer.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = queueRow(more);
        if (current) show(current);
      });
      for (const name of ["pointerdown", "mousedown", "keydown", "keyup"] as const) {
        transfer.addEventListener(name, (event) => event.stopPropagation());
      }
      more.parentElement.insertBefore(transfer, more);
      mounted.set(more, transfer);
    }
  };
  const refresh = (): void => {
    if (closed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList"],
    test: (mutation) => mutationAffectsElements(mutation, MORE_SELECTOR, false),
    onMutate: () => refresh(),
  });
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel || !(event.target instanceof Node)) return;
    if (
      panel.contains(event.target) ||
      [...mounted.values()].some((button) => button.contains(event.target as Node))
    )
      return;
    close();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  refresh();
  return {
    refresh,
    dispose() {
      closed = true;
      stopObserving();
      document.removeEventListener("pointerdown", onPointerDown, true);
      close();
      for (const transfer of mounted.values()) transfer.remove();
      mounted.clear();
      styles.remove();
    },
  };
}
