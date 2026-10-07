import {
  hostThreadIdSchema,
  hostTurnIdSchema,
  type HostThreadId,
  type HostTurnId,
} from "@codexhost/shared-contracts";

import type { RendererModelClient } from "./renderer-model-client.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const RESPONSE_CONVERSATION_ATTRIBUTE = "data-response-annotation-conversation";
const TURN_KEY_ATTRIBUTE = "data-content-search-turn-key";
const OPEN_THREAD_TIMEOUT_MS = 5_000;
const APP_SIDEBAR_SELECTOR = "#app-shell-sidebar";
const PROJECT_HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";

function abortError(): Error {
  return Object.assign(new Error("Thread opening was aborted"), { name: "AbortError" });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reactAncestors(element: Element): Record<string, unknown>[] {
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return [];
  let fiber = record(Object.getOwnPropertyDescriptor(element, key)?.value);
  const out: Record<string, unknown>[] = [];
  for (let depth = 0; fiber && depth < 32; depth += 1) {
    out.push(fiber);
    fiber = record(fiber.return);
  }
  return out;
}

// Desktop 的原生线程列表按项目分页，只渲染每个项目的前若干行，其余行折叠在
// 折叠的项目头或“展开显示”加载更多控件之后。待确认会话往往正落在这批未渲染
// 的行里，因此打开目标线程前，必须先请求原生列表把这些行挂载出来，而不是只做
// 一次行查询；否则“查看结果”会直接超时报“无法打开该会话”。
const THREAD_LIST_REVEAL_LIMIT = 40;
const THREAD_LIST_REVEAL_INTERVAL_MS = 120;

function findSidebarRow(threadId: HostThreadId, options: { hostId?: string }): HTMLElement | null {
  const matchesThreadId = (value: string | null): boolean => {
    if (value === threadId) return true;
    return options.hostId !== undefined && value === `${options.hostId}:${threadId}`;
  };
  for (const row of document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR) ?? []) {
    if (
      (options.hostId === undefined ||
        row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) === options.hostId) &&
      matchesThreadId(threadIdFromSidebarRowElement(row))
    ) {
      return row;
    }
  }
  return null;
}

function sidebarRoot(): HTMLElement | null {
  return document.querySelector?.(APP_SIDEBAR_SELECTOR) ?? null;
}

// 展开仍处于折叠状态的原生项目头，返回是否实际点击。
function expandCollapsedProjects(sidebar: HTMLElement): boolean {
  let clicked = false;
  for (const header of sidebar.querySelectorAll<HTMLElement>(PROJECT_HEADER_SELECTOR)) {
    if (header.getAttribute("aria-expanded") === "false") {
      header.click();
      clicked = true;
    }
  }
  return clicked;
}

// 只识别原生列表的“加载更多”控件：它在 Fiber 上以 hasMoreItems + onExpandedChange
// 暴露分页契约，加载到没有更多时自行置 hasMoreItems=false，因此点击到列表完整
// 就会自然收敛，不会把已经完整的列表再来回折叠。
function pagingButtons(sidebar: HTMLElement): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const button of sidebar.querySelectorAll<HTMLButtonElement>("button")) {
    const paging = reactAncestors(button).some((fiber) => {
      const props = record(fiber.memoizedProps);
      return props?.hasMoreItems === true && typeof props.onExpandedChange === "function";
    });
    if (paging) buttons.push(button);
  }
  return buttons;
}

export function openRendererThread(
  threadId: HostThreadId,
  options: { hostId?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortError());
  const current = findSidebarRow(threadId, options);
  if (current) {
    current.click();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let revealTimer: number | null = null;
    let revealRounds = 0;
    let pagingCursor = 0;
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      revealTimer = null;
      observer.disconnect();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (row: HTMLElement): void => {
      if (settled) return;
      settled = true;
      cleanup();
      row.click();
      resolve();
    };
    // 每轮只请求一次原生分页，并按轮次限流：MutationObserver 会在原生列表每次
    // 重渲染时触发，若直接在其中点击加载更多，会把 App server 请求队列打满。
    const step = (): void => {
      revealTimer = null;
      if (settled) return;
      const row = findSidebarRow(threadId, options);
      if (row) {
        finish(row);
        return;
      }
      const sidebar = sidebarRoot();
      if (sidebar && expandCollapsedProjects(sidebar)) {
        revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
        return;
      }
      if (!sidebar || revealRounds >= THREAD_LIST_REVEAL_LIMIT) return;
      const buttons = pagingButtons(sidebar);
      if (buttons.length === 0) return;
      revealRounds += 1;
      buttons[pagingCursor % buttons.length]?.click();
      pagingCursor += 1;
      revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
    };
    const observer = new MutationObserver(() => {
      if (settled) return;
      const row = findSidebarRow(threadId, options);
      if (row) finish(row);
    });
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Thread did not appear in the sidebar"));
    }, options.timeoutMs ?? OPEN_THREAD_TIMEOUT_MS);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
  });
}

export interface RendererForkTarget {
  control: object;
  isProjectlessConversation: boolean;
  threadId: HostThreadId;
  turnId: HostTurnId;
}

export interface RendererForkDom {
  listen(onFork: (target: RendererForkTarget) => boolean): () => void;
  openThread(threadId: HostThreadId): Promise<void>;
  replay(target: RendererForkTarget): void;
}

export interface RendererForkControl {
  dispose(): void;
}

export interface RendererForkContractInspection {
  annotatedResponseCount: number;
  candidateButtonCount: number;
  verifiedButtonCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstFiber(element: Element): Record<string, unknown> | null {
  const names = Object.getOwnPropertyNames(element).filter((name) =>
    name.startsWith("__reactFiber$"),
  );
  const name = names[0];
  if (names.length !== 1 || !name) return null;
  const value = Object.getOwnPropertyDescriptor(element, name)?.value;
  return isRecord(value) ? value : null;
}

export function rendererForkTargetFromButton(button: HTMLButtonElement): RendererForkTarget | null {
  const annotation = button.closest<HTMLElement>(`[${RESPONSE_CONVERSATION_ATTRIBUTE}]`);
  const turnElement = button.closest<HTMLElement>(`[${TURN_KEY_ATTRIBUTE}]`);
  const threadId = hostThreadIdSchema.safeParse(
    annotation?.getAttribute(RESPONSE_CONVERSATION_ATTRIBUTE),
  );
  const turnId = hostTurnIdSchema.safeParse(turnElement?.getAttribute(TURN_KEY_ATTRIBUTE));
  if (!threadId.success || !turnId.success) return null;

  const conversationIds = new Set<string>();
  const turnIds = new Set<string>();
  const hostIds = new Set<string>();
  const projectlessStates = new Set<boolean>();
  let hasForkCallback = false;
  let fiber = firstFiber(button);
  const buttonProps = fiber?.memoizedProps;
  if (!isRecord(buttonProps) || !Object.hasOwn(buttonProps, "aria-busy")) return null;
  for (let depth = 0; fiber && depth < 24; depth += 1) {
    const props = fiber.memoizedProps;
    if (isRecord(props)) {
      if (typeof props.conversationId === "string") conversationIds.add(props.conversationId);
      if (typeof props.turnId === "string") turnIds.add(props.turnId);
      if (typeof props.hostId === "string") hostIds.add(props.hostId);
      if (typeof props.isProjectlessConversation === "boolean") {
        projectlessStates.add(props.isProjectlessConversation);
      }
      if (typeof props.onFork === "function") hasForkCallback = true;
    }
    fiber = isRecord(fiber.return) ? fiber.return : null;
  }
  if (
    !hasForkCallback ||
    conversationIds.size !== 1 ||
    !conversationIds.has(threadId.data) ||
    turnIds.size !== 1 ||
    !turnIds.has(turnId.data) ||
    hostIds.size !== 1 ||
    !hostIds.has("local") ||
    projectlessStates.size !== 1
  ) {
    return null;
  }
  return {
    control: button,
    isProjectlessConversation: projectlessStates.has(true),
    threadId: threadId.data,
    turnId: turnId.data,
  };
}

export function inspectRendererForkContract(
  root: ParentNode = document,
): RendererForkContractInspection {
  const annotatedResponses = [
    ...root.querySelectorAll<HTMLElement>(`[${RESPONSE_CONVERSATION_ATTRIBUTE}]`),
  ];
  const candidateButtons = annotatedResponses.flatMap((annotation) => [
    ...annotation.querySelectorAll<HTMLButtonElement>("button"),
  ]);
  return {
    annotatedResponseCount: annotatedResponses.length,
    candidateButtonCount: candidateButtons.length,
    verifiedButtonCount: candidateButtons.filter(
      (button) => rendererForkTargetFromButton(button) !== null,
    ).length,
  };
}

class BrowserRendererForkDom implements RendererForkDom {
  readonly #replayed = new WeakSet<HTMLButtonElement>();

  listen(onFork: (target: RendererForkTarget) => boolean): () => void {
    const listener = (event: MouseEvent): void => {
      const origin =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      const button = origin?.closest<HTMLButtonElement>("button");
      if (!button) return;
      if (this.#replayed.delete(button)) return;
      const target = rendererForkTargetFromButton(button);
      if (!target || !onFork(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", listener, true);
    return () => document.removeEventListener("click", listener, true);
  }

  replay(target: RendererForkTarget): void {
    if (!(target.control instanceof HTMLButtonElement) || !target.control.isConnected) return;
    this.#replayed.add(target.control);
    target.control.click();
  }

  openThread(threadId: HostThreadId): Promise<void> {
    return openRendererThread(threadId);
  }
}

export function installRendererForkControl(options: {
  getClient(): RendererModelClient | null;
  dom?: RendererForkDom;
  reportError?(error: unknown): void;
}): RendererForkControl {
  const dom = options.dom ?? new BrowserRendererForkDom();
  const pending = new Set<string>();
  let disposed = false;
  const stop = dom.listen((target) => {
    if (disposed) return false;
    const client = options.getClient();
    if (!client) return false;
    const key = `${target.threadId}\u0000${target.turnId}`;
    if (pending.has(key)) return true;
    pending.add(key);
    void client
      .inspectThread({ threadId: target.threadId })
      .then(async (inspection) => {
        if (disposed) return;
        // Project Threads must retain Desktop's native destination/worktree flow.
        // forkAcrossCwd validates the chosen destination at Host; it must not bypass that UI.
        if (
          inspection.owner === "codex" ||
          !inspection.history.fork ||
          !target.isProjectlessConversation
        ) {
          dom.replay(target);
          return;
        }
        const result = await client.forkThread({
          threadId: target.threadId,
          lastTurnId: target.turnId,
        });
        if (!disposed) await dom.openThread(result.threadId);
      })
      .catch((error: unknown) => options.reportError?.(error))
      .finally(() => pending.delete(key));
    return true;
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      pending.clear();
    },
  };
}
