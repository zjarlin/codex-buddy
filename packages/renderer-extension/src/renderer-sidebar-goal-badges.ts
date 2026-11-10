import type { ThreadGoal, ThreadGoalStatus } from "@codexhost/shared-contracts";

import { THREAD_GOAL_GET_METHOD, type RendererModelClient } from "./renderer-model-client.js";
import { isUnsupportedMethod, type RendererRequestOptions } from "./renderer-request-sender.js";
import {
  SIDEBAR_AGENT_ICON_ATTRIBUTE,
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

export const SIDEBAR_GOAL_BADGE_ATTRIBUTE = "data-codexhost-sidebar-goal";

type RendererLocale = "zh-CN" | "en";

const GOAL_REFRESH_MS = 30_000;
const RETRY_DELAYS_MS = [500, 1_500, 4_000, 10_000] as const;

const STATUS_LABELS: Record<ThreadGoalStatus, Record<RendererLocale, string>> = {
  active: { "zh-CN": "目标进行中", en: "Goal in progress" },
  paused: { "zh-CN": "目标已暂停", en: "Goal paused" },
  blocked: { "zh-CN": "目标受阻", en: "Goal blocked" },
  usageLimited: { "zh-CN": "目标用量受限", en: "Goal usage limited" },
  budgetLimited: { "zh-CN": "目标预算受限", en: "Goal budget limited" },
  complete: { "zh-CN": "目标已完成", en: "Goal complete" },
};

const STATUS_COLORS: Record<ThreadGoalStatus, string> = {
  active: "#2f81f7",
  paused: "#d29922",
  blocked: "#f85149",
  usageLimited: "#db6d28",
  budgetLimited: "#db6d28",
  complete: "#3fb950",
};

export interface SidebarGoalRow {
  isConnected(): boolean;
  hostId(): string | null;
  threadId(): string | null;
  render(goal: ThreadGoal, locale: RendererLocale): void;
  clear(): void;
}

export interface SidebarGoalDom {
  rows(): readonly SidebarGoalRow[];
  observe(onChange: (rows: readonly SidebarGoalRow[]) => void): () => void;
  clear(): void;
}

export interface RendererSidebarGoalBadges {
  refresh(): void;
  dispose(): void;
}

function sidebarGoalAnchor(titleTrigger: HTMLElement, title: HTMLElement): HTMLElement {
  const view = title.ownerDocument.defaultView;
  let anchor = title;
  while (anchor.parentElement && anchor.parentElement !== titleTrigger) {
    const style = view?.getComputedStyle(anchor.parentElement);
    if (style?.display.includes("flex") && !style.flexDirection.startsWith("column")) break;
    anchor = anchor.parentElement;
  }
  return anchor;
}

function createGoalIcon(document: Document, status: ThreadGoalStatus): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.style.color = STATUS_COLORS[status];
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("cx", "8");
  ring.setAttribute("cy", "8");
  ring.setAttribute("r", "5.25");
  ring.setAttribute("stroke", "currentColor");
  ring.setAttribute("stroke-width", "1.5");
  svg.append(ring);
  const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  center.setAttribute("cx", "8");
  center.setAttribute("cy", "8");
  center.setAttribute("r", "2");
  center.setAttribute("fill", "currentColor");
  svg.append(center);
  return svg;
}

function installGoalBadgeStyle(document: Document): void {
  if (document.querySelector("[data-codexhost-sidebar-goal-style]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-codexhost-sidebar-goal-style", "");
  style.textContent = `
[${SIDEBAR_GOAL_BADGE_ATTRIBUTE}] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 4px;
  margin-right: 2px;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
`;
  document.head.append(style);
}

class BrowserSidebarGoalRow implements SidebarGoalRow {
  constructor(private readonly element: HTMLElement) {}

  isConnected(): boolean {
    return this.element.isConnected;
  }

  hostId(): string | null {
    return this.element.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
  }

  threadId(): string | null {
    return threadIdFromSidebarRowElement(this.element);
  }

  render(goal: ThreadGoal, locale: RendererLocale): void {
    const titleTrigger = this.element.querySelector<HTMLElement>("[data-thread-title-trigger]");
    const title = titleTrigger?.querySelector<HTMLElement>("[data-thread-title]");
    if (!titleTrigger || !title) {
      this.clear();
      return;
    }
    const label = STATUS_LABELS[goal.status][locale];
    const objective = goal.objective.trim().replace(/\s+/g, " ");
    const summary = objective.length > 160 ? `${objective.slice(0, 157)}…` : objective;
    const tooltip = summary ? `${label}\n${summary}` : label;
    const existing = this.element.querySelector<HTMLElement>(`[${SIDEBAR_GOAL_BADGE_ATTRIBUTE}]`);
    if (
      existing &&
      existing.getAttribute(SIDEBAR_GOAL_BADGE_ATTRIBUTE) === goal.status &&
      existing.getAttribute("aria-label") === label &&
      existing.title === tooltip
    ) {
      return;
    }
    existing?.remove();

    const badge = this.element.ownerDocument.createElement("span");
    badge.setAttribute(SIDEBAR_GOAL_BADGE_ATTRIBUTE, goal.status);
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", label);
    badge.title = tooltip;
    badge.style.color = STATUS_COLORS[goal.status];
    badge.append(createGoalIcon(this.element.ownerDocument, goal.status));

    const agentIcon = this.element.querySelector<HTMLElement>(`[${SIDEBAR_AGENT_ICON_ATTRIBUTE}]`);
    if (agentIcon?.parentElement) agentIcon.after(badge);
    else sidebarGoalAnchor(titleTrigger, title).before(badge);
  }

  clear(): void {
    for (const badge of this.element.querySelectorAll(`[${SIDEBAR_GOAL_BADGE_ATTRIBUTE}]`)) {
      badge.remove();
    }
  }
}

class BrowserSidebarGoalDom implements SidebarGoalDom {
  readonly #rowsByElement = new WeakMap<HTMLElement, BrowserSidebarGoalRow>();
  readonly #trackedRows = new Set<BrowserSidebarGoalRow>();

  constructor(private readonly root: ParentNode) {}

  #row(element: HTMLElement): BrowserSidebarGoalRow {
    let row = this.#rowsByElement.get(element);
    if (!row) {
      row = new BrowserSidebarGoalRow(element);
      this.#rowsByElement.set(element, row);
    }
    if (element.isConnected && element.matches(SIDEBAR_THREAD_ROW_SELECTOR))
      this.#trackedRows.add(row);
    else this.#trackedRows.delete(row);
    return row;
  }

  rows(): readonly SidebarGoalRow[] {
    for (const row of this.#trackedRows) {
      if (!row.isConnected()) this.#trackedRows.delete(row);
    }
    return [...this.root.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].map(
      (element) => this.#row(element),
    );
  }

  observe(onChange: (rows: readonly SidebarGoalRow[]) => void): () => void {
    const observer = new MutationObserver((mutations) => {
      const changed = new Set<SidebarGoalRow>();
      const update = (element: Element | null): void => {
        if (!element) return;
        const row = element.closest<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR);
        if (row) changed.add(this.#row(row));
      };
      for (const mutation of mutations) {
        const target =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        update(target);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            update(node);
            for (const element of node.querySelectorAll(SIDEBAR_THREAD_ROW_SELECTOR))
              update(element);
          }
        }
        for (const node of mutation.removedNodes) {
          const element = node instanceof Element ? node : null;
          const row = element?.closest<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR);
          if (row && this.#rowsByElement.has(row)) changed.add(this.#row(row));
        }
      }
      if (changed.size) onChange([...changed]);
    });
    observer.observe(this.root, {
      attributes: true,
      attributeFilter: [
        SIDEBAR_THREAD_ROW_ATTRIBUTE,
        SIDEBAR_THREAD_ID_ATTRIBUTE,
        SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
      ],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }

  clear(): void {
    for (const row of this.#trackedRows) row.clear();
    this.#trackedRows.clear();
  }
}

interface GoalCacheEntry {
  goal: ThreadGoal | null;
  checkedAt: number;
}

export function installRendererSidebarGoalBadges(options: {
  getClient(hostId: string): RendererModelClient | null;
  getLocale(): RendererLocale;
  dom?: SidebarGoalDom;
}): RendererSidebarGoalBadges {
  const dom = options.dom ?? new BrowserSidebarGoalDom(document);
  if (options.dom === undefined) installGoalBadgeStyle(document);
  const goals = new Map<string, GoalCacheEntry>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  const unsupported = new WeakSet<object>();
  const retryAttempts = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const rowsByKey = new Map<string, Set<SidebarGoalRow>>();
  const keyByRow = new WeakMap<SidebarGoalRow, string>();
  const dirtyRows = new Set<SidebarGoalRow>();
  let disposed = false;
  let scanScheduled = false;

  const keyOf = (hostId: string, threadId: string): string => JSON.stringify([hostId, threadId]);

  const scheduleScan = (rows: Iterable<SidebarGoalRow>): void => {
    if (disposed) return;
    for (const row of rows) dirtyRows.add(row);
    if (scanScheduled || dirtyRows.size === 0) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  };

  const trackRow = (row: SidebarGoalRow, key?: string): void => {
    const previous = keyByRow.get(row);
    if (previous === key) return;
    if (previous !== undefined) {
      const rows = rowsByKey.get(previous);
      rows?.delete(row);
      if (rows?.size === 0) rowsByKey.delete(previous);
      keyByRow.delete(row);
    }
    if (key !== undefined) {
      let rows = rowsByKey.get(key);
      if (!rows) rowsByKey.set(key, (rows = new Set()));
      rows.add(row);
      keyByRow.set(row, key);
    }
  };

  const clearRetry = (key: string): void => {
    const timer = retryTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    retryTimers.delete(key);
    retryAttempts.delete(key);
    failed.delete(key);
  };

  const scheduleRetry = (hostId: string, threadId: string): void => {
    const key = keyOf(hostId, threadId);
    if (disposed || !failed.has(key) || pending.has(key) || retryTimers.has(key)) return;
    const attempt = retryAttempts.get(key) ?? 0;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    retryAttempts.set(key, attempt + 1);
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      if (disposed) return;
      failed.delete(key);
      scheduleScan(rowsByKey.get(key) ?? []);
    }, delay);
    retryTimers.set(key, timer);
  };

  const requestGoal = (hostId: string, threadId: string, client: RendererModelClient): void => {
    const key = keyOf(hostId, threadId);
    pending.add(key);
    const requestOptions: RendererRequestOptions = { priority: "background" };
    void Promise.resolve()
      .then(() => client.getThreadGoal?.(threadId, requestOptions))
      .then((goal) => {
        if (disposed) return;
        goals.set(key, { goal: goal ?? null, checkedAt: Date.now() });
        clearRetry(key);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        if (isUnsupportedMethod(error, THREAD_GOAL_GET_METHOD) || !client.getThreadGoal) {
          unsupported.add(client);
          return;
        }
        failed.add(key);
      })
      .finally(() => {
        pending.delete(key);
        scheduleScan(rowsByKey.get(key) ?? []);
        if (failed.has(key)) scheduleRetry(hostId, threadId);
      });
  };

  const scan = (): void => {
    scanScheduled = false;
    if (disposed) return;
    const rows = [...dirtyRows];
    dirtyRows.clear();
    const locale = options.getLocale();
    for (const row of rows) {
      if (!row.isConnected()) {
        trackRow(row);
        row.clear();
        continue;
      }
      const hostId = row.hostId();
      const threadId = row.threadId();
      if (!hostId || !threadId) {
        trackRow(row);
        row.clear();
        continue;
      }
      const key = keyOf(hostId, threadId);
      trackRow(row, key);
      const cached = goals.get(key);

      if (!cached) {
        row.clear();
      } else if (cached.goal) {
        row.render(cached.goal, locale);
      } else {
        row.clear();
      }

      if (pending.has(key) || (cached && Date.now() - cached.checkedAt < GOAL_REFRESH_MS)) continue;
      if (failed.has(key)) continue;
      const client = options.getClient(hostId);
      if (!client?.getThreadGoal || unsupported.has(client)) continue;
      requestGoal(hostId, threadId, client);
    }
  };

  const stopObserving = dom.observe(scheduleScan);
  for (const row of dom.rows()) dirtyRows.add(row);
  scan();

  return {
    refresh() {
      if (!disposed) scheduleScan(dom.rows());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      for (const row of dirtyRows) row.clear();
      dirtyRows.clear();
      rowsByKey.clear();
      goals.clear();
      pending.clear();
      failed.clear();
      retryAttempts.clear();
      dom.clear();
    },
  };
}
