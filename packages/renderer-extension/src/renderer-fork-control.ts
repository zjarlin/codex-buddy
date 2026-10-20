import {
  hostThreadIdSchema,
  hostTurnIdSchema,
  type HostThreadId,
  type HostTurnId,
} from "@codexhost/shared-contracts";

import { rowProject } from "./project-tabs/native-binding.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const RESPONSE_CONVERSATION_ATTRIBUTE = "data-response-annotation-conversation";
const TURN_KEY_ATTRIBUTE = "data-content-search-turn-key";
const OPEN_THREAD_TIMEOUT_MS = 15_000;
// 侧栏行已挂载并不等于右侧已切换到目标会话；后者由 Composer 的会话目标确认。
const OPEN_THREAD_ACTIVE_TIMEOUT_MS = 10_000;
const OPEN_THREAD_ACTIVE_INTERVAL_MS = 100;
const APP_SIDEBAR_SELECTOR = "#app-shell-sidebar";
const PROJECT_CONTAINER_SELECTOR = "[data-sidebar-project-container-id]";
const PROJECT_HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";
const PROJECT_LABEL_ATTRIBUTE = "data-app-action-sidebar-project-label";

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

function projectContainerByLabel(
  root: HTMLElement,
  label: string | undefined,
  hostId?: string,
): HTMLElement | null {
  const expected = label?.trim();
  if (!expected) return null;
  for (const container of root.querySelectorAll<HTMLElement>(PROJECT_CONTAINER_SELECTOR)) {
    const project = rowProject(container);
    if (
      project &&
      hostId &&
      (project.projectKind === "local" ? hostId !== "local" : project.hostId !== hostId)
    )
      continue;
    const header = container.querySelector<HTMLElement>(PROJECT_HEADER_SELECTOR);
    const actual = (
      header?.getAttribute(PROJECT_LABEL_ATTRIBUTE) ?? header?.getAttribute("aria-label")
    )?.trim();
    if (actual === expected) return container;
  }
  return null;
}

// 每次只展开一个折叠项目。定位目标明确时 root 是目标项目容器；项目元数据缺失时
// 才退回侧栏逐个项目探测，避免旧实现一次把整个侧栏所有项目全部展开。
function expandNextCollapsedProject(
  root: ParentNode,
  expanded: Set<HTMLElement>,
): HTMLElement | null {
  for (const header of root.querySelectorAll<HTMLElement>(PROJECT_HEADER_SELECTOR)) {
    if (header.getAttribute("aria-expanded") !== "false" || expanded.has(header)) continue;
    header.click();
    expanded.add(header);
    return header;
  }
  return null;
}

// 只识别原生列表的“加载更多”控件：它在 Fiber 上以 hasMoreItems + onExpandedChange
// 暴露分页契约，加载到没有更多时自行置 hasMoreItems=false，因此点击到列表完整
// 就会自然收敛，不会把已经完整的列表再来回折叠。
function pagingButtons(root: ParentNode): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    const paging = reactAncestors(button).some((fiber) => {
      const props = record(fiber.memoizedProps);
      return props?.hasMoreItems === true && typeof props.onExpandedChange === "function";
    });
    if (paging) buttons.push(button);
  }
  return buttons;
}

// 还原 reveal 期间被打开的原生状态：重新点击我们展开过的“Show more”控件（此时已
// 变为“Show less”，其 onClick 调用 onExpandedChange(false)），再重新点击被展开的
// 项目头。只处理本次实际改动过的元素，用户原本就展开的列表与项目不受影响。
function restoreRevealedSidebar(
  expanded: Set<HTMLElement>,
  paged: Set<HTMLElement>,
  keepProject: HTMLElement | null,
): void {
  const sidebar = sidebarRoot();
  if (!sidebar) return;
  for (const button of pagingButtons(sidebar)) {
    if (!paged.has(button)) continue;
    if (keepProject?.contains(button)) continue;
    if (button.getAttribute("aria-disabled") === "true" || button.disabled) continue;
    button.click();
  }
  // React 重渲染会替换项目头节点，旧元素身份可能已断开；按容器属性重新取当前
  // 项目头，保证探测期间展开的项目在导航结束后确实收起来。
  for (const header of expanded) {
    if (keepProject?.contains(header)) continue;
    const current =
      (header.isConnected ? header : null) ??
      header
        .closest<HTMLElement>(PROJECT_CONTAINER_SELECTOR)
        ?.querySelector<HTMLElement>(PROJECT_HEADER_SELECTOR) ??
      null;
    if (current?.getAttribute("aria-expanded") !== "true") continue;
    if (current !== header) expanded.add(current);
    current.click();
  }
}

function isViewing(
  options: { hostId?: string | undefined; threadId?: HostThreadId | undefined },
  active: { hostId: string; threadId: string } | null,
): boolean {
  return Boolean(
    active &&
    options.hostId !== undefined &&
    active.hostId === options.hostId &&
    active.threadId === options.threadId,
  );
}

// 点击原生行后，右侧可能还在读取线程；若立刻确认完成提醒，用户会看到卡片消失而
// 会话仍在转圈。只在调用方提供当前会话判定时，把「成为当前查看的会话」当作打开
// 成功；未提供时保持旧语义，避免其他导航入口多出等待。
export function openRendererThread(
  threadId: HostThreadId,
  options: {
    hostId?: string;
    project?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    revealProjects?: boolean;
    activeThread?(): { hostId: string; threadId: string } | null;
  } = {},
): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortError());
  const current = findSidebarRow(threadId, options);
  if (current) {
    current.click();
    if (!options.activeThread) return Promise.resolve();
    return waitForActiveThread(threadId, options);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let revealTimer: number | null = null;
    let timeout: number | null = null;
    let revealRounds = 0;
    let pagingCursor = 0;
    // 记录为定位目标行动过的原生状态，打开、超时或取消后统一还原，避免侧栏一直
    // 保持“被点过 Show more”的展开形态。
    const expandedProjects = new Set<HTMLElement>();
    const pagedButtons = new Set<HTMLElement>();
    // 归属未知时逐个项目探测；同一时间只保留一个探测项目展开，找到或换项目时
    // 立即收起上一个，避免侧栏长时间保持整片展开。
    let probing: HTMLElement | null = null;
    const collapseProbe = (): void => {
      if (!probing) return;
      if (probing.isConnected && probing.getAttribute("aria-expanded") === "true") {
        probing.click();
      }
      probing = null;
    };
    const cleanup = (): void => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      revealTimer = null;
      observer.disconnect();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (row: HTMLElement): void => {
      if (settled) return;
      settled = true;
      cleanup();
      // 保留目标项目展开，使当前会话行继续可见并参与滚动聚焦；只还原本次为探测
      // 其他项目而临时打开的状态。先点击原生行，再还原，避免重渲染卸载目标行。
      const keepProject = row.closest<HTMLElement>(PROJECT_CONTAINER_SELECTOR);
      row.click();
      restoreRevealedSidebar(expandedProjects, pagedButtons, keepProject);
      // 只有确认右侧已切换到目标会话才算打开成功，卡片保留到这一刻。
      if (options.activeThread) {
        waitForActiveThread(threadId, { ...options, activeThread: options.activeThread }).then(
          resolve,
          reject,
        );
      } else resolve();
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
      if (!sidebar) {
        revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
        return;
      }
      if (options.revealProjects === false) {
        revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
        return;
      }
      const project = projectContainerByLabel(sidebar, options.project, options.hostId);
      // 明确的项目尚未挂载时等待它，不能退回展开整个侧栏。
      if (options.project && !project) {
        revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
        return;
      }
      const revealRoot = project ?? sidebar;
      const expanded = expandNextCollapsedProject(revealRoot, expandedProjects);
      if (expanded) {
        if (!project) {
          collapseProbe();
          probing = expanded;
        }
        revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
        return;
      }
      if (revealRounds >= THREAD_LIST_REVEAL_LIMIT) return;
      // 原生列表异步加载时暂时没有分页按钮，继续等待后再检查。
      const buttons = pagingButtons(revealRoot);
      if (buttons.length === 0) {
        revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
        return;
      }
      revealRounds += 1;
      const paging = buttons[pagingCursor % buttons.length];
      paging?.click();
      if (paging) pagedButtons.add(paging);
      pagingCursor += 1;
      revealTimer = window.setTimeout(step, THREAD_LIST_REVEAL_INTERVAL_MS);
    };
    const observer = new MutationObserver(() => {
      if (settled) return;
      const row = findSidebarRow(threadId, options);
      if (row) finish(row);
    });
    timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      restoreRevealedSidebar(expandedProjects, pagedButtons, null);
      reject(new Error("Thread did not appear in the sidebar"));
    }, options.timeoutMs ?? OPEN_THREAD_TIMEOUT_MS);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      restoreRevealedSidebar(expandedProjects, pagedButtons, null);
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

function waitForActiveThread(
  threadId: HostThreadId,
  options: {
    hostId?: string | undefined;
    activeThread?(): { hostId: string; threadId: string } | null;
  },
): Promise<void> {
  const activeThread = options.activeThread ?? (() => null);
  const viewing = (): boolean => isViewing({ hostId: options.hostId, threadId }, activeThread());
  return new Promise((resolve, reject) => {
    let settled = false;
    let poll: number | null = null;
    let timeout: number | null = null;
    // 观察器与定时器相互补充：原生状态变化可能不触发属性重渲染，纯观察会漏掉；
    // 两者都必须在成功或失败时释放，避免留下持续的观察者。
    const observer = new MutationObserver(() => check());
    const stop = (): void => {
      if (poll !== null) window.clearInterval(poll);
      if (timeout !== null) window.clearTimeout(timeout);
      poll = null;
      timeout = null;
      observer.disconnect();
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      stop();
      if (error) reject(error);
      else resolve();
    };
    function check(): void {
      if (!viewing()) return;
      finish();
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    poll = window.setInterval(check, OPEN_THREAD_ACTIVE_INTERVAL_MS);
    timeout = window.setTimeout(
      () => finish(new Error("Thread did not become the current conversation")),
      OPEN_THREAD_ACTIVE_TIMEOUT_MS,
    );
    check();
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
