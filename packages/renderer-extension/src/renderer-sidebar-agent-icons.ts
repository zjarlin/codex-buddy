import {
  THREAD_OWNERSHIP_LIST_MAX_LENGTH,
  hostThreadIdSchema,
  type ThreadOwnership,
} from "@codexhost/shared-contracts";

import type { RendererAgent } from "./agent-selection-state.js";
import { createRendererAgentIcon, RENDERER_AGENT_LABELS } from "./renderer-agent-icon.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import {
  RendererMethodUnavailableError,
  type RendererRequestOptions,
} from "./renderer-request-sender.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";

export const SIDEBAR_THREAD_ROW_ATTRIBUTE = "data-app-action-sidebar-thread-row";
export const SIDEBAR_THREAD_ROW_SELECTOR = `[${SIDEBAR_THREAD_ROW_ATTRIBUTE}]`;
export const SIDEBAR_THREAD_ID_ATTRIBUTE = "data-app-action-sidebar-thread-id";
export const SIDEBAR_THREAD_HOST_ID_ATTRIBUTE = "data-app-action-sidebar-thread-host-id";
export const SIDEBAR_AGENT_ICON_ATTRIBUTE = "data-codexhost-sidebar-agent-icon";

export interface RendererSidebarContractInspection {
  rowCount: number;
  titleOwnerCount: number;
  resolvedThreadCount: number;
  ambiguousThreadCount: number;
}

const OWNERSHIP_RETRY_DELAYS_MS = [100, 300, 800, 1_500, 3_000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sidebarThreadAttributes(element: HTMLElement): {
  taskKey: string;
  hostId: string;
  rowMarker: string;
} | null {
  const taskKey = element.getAttribute(SIDEBAR_THREAD_ID_ATTRIBUTE);
  const hostId = element.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
  const rowMarker = element.getAttribute(SIDEBAR_THREAD_ROW_ATTRIBUTE);
  if (taskKey === null || hostId === null || rowMarker === null) return null;
  return { taskKey, hostId, rowMarker };
}

export function draftIdFromSidebarRowElement(element: HTMLElement): string | null {
  const attributes = sidebarThreadAttributes(element);
  if (!attributes) return null;
  const hostPrefix = `${attributes.hostId}:`;
  const taskKey = attributes.taskKey.startsWith(hostPrefix)
    ? attributes.taskKey.slice(hostPrefix.length)
    : attributes.taskKey;
  return taskKey.startsWith("client-new-thread:") ? taskKey : null;
}

// 同一行会被多个侧栏观察者重复解析（未读、查阅次数、状态筛选、Agent 图标、
// 行操作、文件夹等各自全量扫描）。React 重用时同一个 DOM 元素身份与 fiber 对象
// 都保持不变，只有 data-app-action-* 属性或 fiber 指针变化才代表会话身份改变，
// 因此按「元素 + 属性指纹 + fiber 引用」缓存，把每次扫描中
// O(行数 × fiber 深度) 的回溯降为一次。
interface ThreadIdCacheEntry {
  taskKey: string;
  hostId: string;
  rowMarker: string;
  fiber: unknown;
  value: string | null;
}
const threadIdCache = new WeakMap<HTMLElement, ThreadIdCacheEntry>();

function resolveThreadIdFromSidebarRowElement(
  element: HTMLElement,
  taskKey: string,
  hostId: string,
  rowMarker: string,
): { fiber: unknown; value: string | null } {
  const fiberNames = Object.getOwnPropertyNames(element).filter((name) =>
    name.startsWith("__reactFiber$"),
  );
  const fiberName = fiberNames[0];
  if (fiberNames.length !== 1 || !fiberName) return { fiber: null, value: null };
  const firstFiber = Object.getOwnPropertyDescriptor(element, fiberName)?.value;
  if (!isRecord(firstFiber)) return { fiber: null, value: null };

  const candidates = new Set<string>();
  let fiber: Record<string, unknown> | null = firstFiber;
  for (let depth = 0; fiber && depth < 12; depth += 1) {
    const props = fiber.memoizedProps;
    if (isRecord(props) && isRecord(props.dataAttributes)) {
      const dataAttributes = props.dataAttributes;
      const threadId = hostThreadIdSchema.safeParse(props.conversationId);
      if (
        threadId.success &&
        dataAttributes[SIDEBAR_THREAD_ROW_ATTRIBUTE] === rowMarker &&
        dataAttributes[SIDEBAR_THREAD_ID_ATTRIBUTE] === taskKey &&
        dataAttributes[SIDEBAR_THREAD_HOST_ID_ATTRIBUTE] === hostId
      ) {
        candidates.add(threadId.data);
      }
    }
    fiber = isRecord(fiber.return) ? fiber.return : null;
  }
  const value = candidates.size === 1 ? (candidates.values().next().value ?? null) : null;
  return { fiber: firstFiber, value };
}

export function threadIdFromSidebarRowElement(element: HTMLElement): string | null {
  const attributes = sidebarThreadAttributes(element);
  if (!attributes) return null;
  const { taskKey, hostId, rowMarker } = attributes;

  const cached = threadIdCache.get(element);
  if (
    cached &&
    cached.taskKey === taskKey &&
    cached.hostId === hostId &&
    cached.rowMarker === rowMarker
  ) {
    // fiber 指针仍需一致：React 卸载/重挂同一 DOM 节点或测试删除 fiber 时，
    // 属性不变但会话身份已不可解析，此时必须重新回溯。
    const current = currentSidebarRowFiber(element);
    if (current === cached.fiber) return cached.value;
  }

  const { fiber, value } = resolveThreadIdFromSidebarRowElement(
    element,
    taskKey,
    hostId,
    rowMarker,
  );
  threadIdCache.set(element, { taskKey, hostId, rowMarker, fiber, value });
  return value;
}

function currentSidebarRowFiber(element: HTMLElement): unknown {
  const fiberNames = Object.getOwnPropertyNames(element).filter((name) =>
    name.startsWith("__reactFiber$"),
  );
  if (fiberNames.length !== 1 || fiberNames[0] === undefined) return null;
  return Object.getOwnPropertyDescriptor(element, fiberNames[0])?.value ?? null;
}

export function inspectRendererSidebarContract(
  root: ParentNode = document,
): RendererSidebarContractInspection {
  const rows = [...root.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)];
  let titleOwnerCount = 0;
  let resolvedThreadCount = 0;
  let ambiguousThreadCount = 0;
  for (const row of rows) {
    const titleTrigger = row.querySelector<HTMLElement>("[data-thread-title-trigger]");
    const title = titleTrigger?.querySelector<HTMLElement>("[data-thread-title]");
    if (titleTrigger && title) titleOwnerCount += 1;
    const attributes = sidebarThreadAttributes(row);
    if (!attributes || attributes.taskKey.startsWith("client-new-thread:")) continue;
    if (threadIdFromSidebarRowElement(row) === null) ambiguousThreadCount += 1;
    else resolvedThreadCount += 1;
  }
  return {
    rowCount: rows.length,
    titleOwnerCount,
    resolvedThreadCount,
    ambiguousThreadCount,
  };
}

export interface SidebarAgentIconRow {
  isConnected(): boolean;
  hostId(): string | null;
  threadId(): string | null;
  draftId(): string | null;
  render(agent: Exclude<RendererAgent, "codex">): void;
  clear(): void;
}

export interface SidebarAgentIconDom {
  rows(): readonly SidebarAgentIconRow[];
  observe(onChange: () => void): () => void;
  clear(): void;
}

export interface RendererSidebarAgentIcons {
  refresh(): void;
  dispose(): void;
}

export function rendererAgentForThreadOwnership(
  ownership: ThreadOwnership,
): Exclude<RendererAgent, "codex"> | null {
  if (ownership.owner === "codex") return null;
  if (ownership.harnessId === "pi") return "pi";
  if (ownership.harnessId === "claude-code") return "claude-code";
  if (ownership.harnessId === "deepseek-harness") return "deepseek-harness";
  if (ownership.harnessId === "opencode") return "opencode";
  if (ownership.harnessId === "grok") return "grok";
  if (ownership.harnessId === "omp") return "omp";
  if (ownership.harnessId === "antigravity") return "antigravity";
  if (ownership.harnessId === "kiro-cli") return "kiro-cli";
  if (ownership.harnessId === "codebuddy") return "codebuddy";
  if (ownership.harnessId === "workbuddy") return "workbuddy";
  if (ownership.harnessId === "cursor-cli") return "cursor-cli";
  if (ownership.harnessId === "hermes") return "hermes";
  if (ownership.harnessId === "qoder") return "qoder";
  if (ownership.harnessId === "qoder-cn") return "qoder-cn";
  if (ownership.harnessId === "kimi-code") return "kimi-code";
  return null;
}

// Desktop wraps some titles (hover label, secondary line), so the title is not always a direct
// child of the trigger. Anchor the icon to the title's outermost wrapper that still sits in a
// horizontal flex row, keeping it on the title line.
function sidebarAgentIconAnchor(titleTrigger: HTMLElement, title: HTMLElement): HTMLElement {
  const view = title.ownerDocument.defaultView;
  let anchor = title;
  while (anchor.parentElement && anchor.parentElement !== titleTrigger) {
    const style = view?.getComputedStyle(anchor.parentElement);
    if (style?.display.includes("flex") && !style.flexDirection.startsWith("column")) break;
    anchor = anchor.parentElement;
  }
  return anchor;
}

class BrowserSidebarAgentIconRow implements SidebarAgentIconRow {
  constructor(private readonly element: HTMLElement) {}

  isConnected(): boolean {
    return this.element.isConnected;
  }

  hostId(): string | null {
    return sidebarThreadAttributes(this.element)?.hostId ?? null;
  }

  threadId(): string | null {
    return threadIdFromSidebarRowElement(this.element);
  }

  draftId(): string | null {
    return draftIdFromSidebarRowElement(this.element);
  }

  render(agent: Exclude<RendererAgent, "codex">): void {
    const titleTrigger = this.element.querySelector<HTMLElement>("[data-thread-title-trigger]");
    const title = titleTrigger?.querySelector<HTMLElement>("[data-thread-title]");
    if (!titleTrigger || !title) {
      this.clear();
      return;
    }
    const anchor = sidebarAgentIconAnchor(titleTrigger, title);
    const icons = [
      ...this.element.querySelectorAll<HTMLElement>(`[${SIDEBAR_AGENT_ICON_ATTRIBUTE}]`),
    ];
    if (
      icons.length === 1 &&
      icons[0]?.nextElementSibling === anchor &&
      icons[0].getAttribute(SIDEBAR_AGENT_ICON_ATTRIBUTE) === agent
    ) {
      return;
    }
    this.clear();

    const label = `${RENDERER_AGENT_LABELS[agent]} Agent`;
    const marker = this.element.ownerDocument.createElement("span");
    marker.setAttribute(SIDEBAR_AGENT_ICON_ATTRIBUTE, agent);
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", label);
    marker.title = label;
    marker.style.display = "inline-flex";
    marker.style.alignItems = "center";
    marker.style.justifyContent = "center";
    marker.style.width = "14px";
    marker.style.height = "14px";
    marker.style.flex = "none";
    marker.style.pointerEvents = "none";
    marker.append(createRendererAgentIcon(agent, 14, this.element.ownerDocument));
    anchor.before(marker);
  }

  clear(): void {
    for (const icon of this.element.querySelectorAll(`[${SIDEBAR_AGENT_ICON_ATTRIBUTE}]`)) {
      icon.remove();
    }
  }
}

class BrowserSidebarAgentIconDom implements SidebarAgentIconDom {
  readonly #rowsByElement = new WeakMap<HTMLElement, BrowserSidebarAgentIconRow>();
  readonly #trackedRows = new Set<BrowserSidebarAgentIconRow>();

  constructor(private readonly root: ParentNode & Node) {}

  rows(): readonly SidebarAgentIconRow[] {
    for (const row of this.#trackedRows) {
      if (!row.isConnected()) this.#trackedRows.delete(row);
    }
    return [...this.root.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].map(
      (element) => {
        let row = this.#rowsByElement.get(element);
        if (!row) {
          row = new BrowserSidebarAgentIconRow(element);
          this.#rowsByElement.set(element, row);
          this.#trackedRows.add(row);
        }
        return row;
      },
    );
  }

  observe(onChange: () => void): () => void {
    const ownerDocument =
      this.root instanceof Document ? this.root : (this.root.ownerDocument ?? document);
    return getDomMutationHub(ownerDocument).subscribe({
      kinds: ["childList", "attributes"],
      attributeFilter: [SIDEBAR_THREAD_ID_ATTRIBUTE, SIDEBAR_THREAD_HOST_ID_ATTRIBUTE],
      test: (record) => mutationAffectsElements(record, SIDEBAR_THREAD_ROW_SELECTOR),
      onMutate: () => onChange(),
    });
  }

  clear(): void {
    for (const row of this.#trackedRows) row.clear();
    this.#trackedRows.clear();
  }
}

export function installRendererSidebarAgentIcons(options: {
  getClient(hostId: string): RendererModelClient | null;
  /** Stable identity of the active ownership connection. A new identity means a
   * new connection, which is the only event that re-arms the retry budget. */
  ownershipClient?(): RendererModelClient | null;
  getLocalAgent?(input: {
    hostId: string;
    threadId: string | null;
    draftId: string | null;
  }): RendererAgent | null;
  dom?: SidebarAgentIconDom;
}): RendererSidebarAgentIcons {
  const dom = options.dom ?? new BrowserSidebarAgentIconDom(document);
  const ownershipByThread = new Map<string, Exclude<RendererAgent, "codex"> | null>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  const provisionalCodex = new Set<string>();
  const ownershipRetryAttempts = new Map<string, number>();
  const ownershipRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  let scanScheduled = false;
  // Bounded retries are per connection: a reconnect may re-arm them, but
  // repeated in-place refresh() calls on the same connection may not. Seed the
  // identity at install time so the first refresh is not mistaken for a change.
  let ownershipClientSeen: RendererModelClient | null = options.ownershipClient?.() ?? null;

  const ownershipKey = (hostId: string, threadId: string): string =>
    JSON.stringify([hostId, threadId]);

  const scheduleScan = (): void => {
    if (disposed || scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(scan);
  };

  const clearOwnershipRetry = (key: string): void => {
    const timer = ownershipRetryTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    ownershipRetryTimers.delete(key);
    ownershipRetryAttempts.delete(key);
    failed.delete(key);
    provisionalCodex.delete(key);
  };

  const scheduleOwnershipRetry = (hostId: string, threadId: string): void => {
    const key = ownershipKey(hostId, threadId);
    if (
      disposed ||
      (!failed.has(key) && !provisionalCodex.has(key)) ||
      pending.has(key) ||
      ownershipRetryTimers.has(key)
    ) {
      return;
    }
    const attempt = ownershipRetryAttempts.get(key) ?? 0;
    const delay = OWNERSHIP_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    ownershipRetryAttempts.set(key, attempt + 1);
    const timer = setTimeout(() => {
      ownershipRetryTimers.delete(key);
      if (disposed) return;
      failed.delete(key);
      ownershipByThread.delete(key);
      scheduleScan();
    }, delay);
    ownershipRetryTimers.set(key, timer);
  };

  const requestOwnership = (
    hostId: string,
    threadIds: ReturnType<typeof hostThreadIdSchema.parse>[],
    client: RendererModelClient,
  ): void => {
    for (const threadId of threadIds) pending.add(ownershipKey(hostId, threadId));
    let succeeded = false;
    let retryable = true;
    const requestOptions: RendererRequestOptions = { priority: "background" };
    void Promise.resolve()
      .then(() => client.listThreadOwnership({ threadIds }, requestOptions))
      .then(({ threads }) => {
        if (disposed) return;
        for (const ownership of threads) {
          const key = ownershipKey(hostId, ownership.threadId);
          ownershipByThread.set(key, rendererAgentForThreadOwnership(ownership));
          failed.delete(key);
          if (ownership.owner === "codex") {
            // Cold start may answer `codex` before the external mapping exists.
            // The retry budget is bounded per Thread and per connection, so this
            // recovers a late mapping without becoming an unbounded loop.
            provisionalCodex.add(key);
            scheduleOwnershipRetry(hostId, ownership.threadId);
          } else {
            clearOwnershipRetry(key);
          }
        }
        succeeded = true;
      })
      .catch((error) => {
        if (disposed) return;
        retryable = !(error instanceof RendererMethodUnavailableError);
        for (const threadId of threadIds) failed.add(ownershipKey(hostId, threadId));
      })
      .finally(() => {
        for (const threadId of threadIds) pending.delete(ownershipKey(hostId, threadId));
        if (retryable) {
          for (const threadId of threadIds) scheduleOwnershipRetry(hostId, threadId);
        }
        if (succeeded) scheduleScan();
      });
  };

  const scan = (): void => {
    scanScheduled = false;
    if (disposed) return;
    const unresolvedByHost = new Map<string, Set<ReturnType<typeof hostThreadIdSchema.parse>>>();
    for (const row of dom.rows()) {
      if (!row.isConnected()) {
        row.clear();
        continue;
      }
      const hostId = row.hostId();
      if (!hostId) {
        row.clear();
        continue;
      }
      const threadId = hostThreadIdSchema.safeParse(row.threadId());
      const localAgent = options.getLocalAgent?.({
        hostId,
        threadId: threadId.success ? threadId.data : null,
        draftId: row.draftId(),
      });
      if (localAgent !== null && localAgent !== undefined) {
        if (threadId.success) {
          const key = ownershipKey(hostId, threadId.data);
          ownershipByThread.set(key, localAgent === "codex" ? null : localAgent);
          clearOwnershipRetry(key);
        }
        if (localAgent === "codex") row.clear();
        else row.render(localAgent);
        continue;
      }
      if (!threadId.success) {
        row.clear();
        continue;
      }
      const key = ownershipKey(hostId, threadId.data);
      if (ownershipByThread.has(key)) {
        const agent = ownershipByThread.get(key);
        if (agent) row.render(agent);
        else row.clear();
        continue;
      }
      row.clear();
      if (!pending.has(key) && !failed.has(key)) {
        let unresolved = unresolvedByHost.get(hostId);
        if (!unresolved) {
          unresolved = new Set();
          unresolvedByHost.set(hostId, unresolved);
        }
        unresolved.add(threadId.data);
      }
    }
    for (const [hostId, unresolved] of unresolvedByHost) {
      const client = options.getClient(hostId);
      if (!client) {
        for (const threadId of unresolved) {
          const key = ownershipKey(hostId, threadId);
          failed.add(key);
          scheduleOwnershipRetry(hostId, threadId);
        }
        continue;
      }
      const threadIds = [...unresolved];
      for (let index = 0; index < threadIds.length; index += THREAD_OWNERSHIP_LIST_MAX_LENGTH) {
        requestOwnership(
          hostId,
          threadIds.slice(index, index + THREAD_OWNERSHIP_LIST_MAX_LENGTH),
          client,
        );
      }
    }
  };

  const stopObserving = dom.observe(scheduleScan);
  scan();

  return {
    refresh() {
      failed.clear();
      // Many unrelated Renderer events call refresh(). Only a new ownership
      // connection may restart the bounded retry budget, cancel a pending
      // retry, or discard a confirmed official-Thread classification; doing
      // that on every call turns a stale mapping into an unbounded request
      // loop that saturates the shared Desktop request queue.
      const ownershipClient = options.ownershipClient?.() ?? null;
      if (ownershipClient !== ownershipClientSeen) {
        ownershipClientSeen = ownershipClient;
        for (const timer of ownershipRetryTimers.values()) clearTimeout(timer);
        ownershipRetryTimers.clear();
        ownershipRetryAttempts.clear();
        for (const key of provisionalCodex) ownershipByThread.delete(key);
        provisionalCodex.clear();
      }
      scheduleScan();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      dom.clear();
      ownershipByThread.clear();
      pending.clear();
      failed.clear();
      provisionalCodex.clear();
      for (const timer of ownershipRetryTimers.values()) clearTimeout(timer);
      ownershipRetryTimers.clear();
      ownershipRetryAttempts.clear();
    },
  };
}
