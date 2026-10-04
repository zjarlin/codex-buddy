import type { RendererModelClient } from "./renderer-model-client.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";
import { createVisiblePoll } from "./renderer-visible-poll.js";

const FILTER_ATTRIBUTE = "data-codexhost-sidebar-status-filter";
const HIDDEN_ATTRIBUTE = "data-codexhost-sidebar-status-hidden";
const PROJECT_SELECTOR = "#app-shell-sidebar [data-sidebar-project-container-id]";
const ROW_SELECTOR = `#app-shell-sidebar ${SIDEBAR_THREAD_ROW_SELECTOR}`;
const STORAGE_KEY = "codexhost.sidebar-status-view";
type ViewMode = "all" | "active" | "pending";
const REFRESH_MS = 15_000;
const MAX_CONCURRENT_READS = 4;

interface RowState {
  hostId: string;
  threadId: string;
  client: RendererModelClient;
  active: boolean | null;
  failed: boolean;
  checkedAt: number;
  pending: boolean;
}

const style = `
[${FILTER_ATTRIBUTE}]{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-width:0;padding:6px 10px;color:var(--color-token-text-secondary,currentColor);font:12px/18px system-ui,sans-serif;flex-wrap:wrap}
[${FILTER_ATTRIBUTE}] [role="group"]{display:inline-flex;flex:none;padding:2px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:6px}
[${FILTER_ATTRIBUTE}] button{min-width:0;min-height:24px;padding:2px 7px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}
[${FILTER_ATTRIBUTE}] button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 13%,transparent);color:var(--color-token-text-primary,currentColor)}
[${FILTER_ATTRIBUTE}] button:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[${FILTER_ATTRIBUTE}] [data-filter-status]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 100px}
[${HIDDEN_ATTRIBUTE}]{display:none!important}
`;

function nativeThreadId(hostId: string, row: HTMLElement): string | null {
  const id = threadIdFromSidebarRowElement(row);
  if (!id) return null;
  const prefix = `${hostId}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

export function installRendererSidebarStatusFilter(options: {
  getClient(hostId: string): RendererModelClient | null;
  getLocale(): "zh-CN" | "en";
  hasPending?(hostId: string, threadId: string): boolean;
}): { refresh(): void; dispose(): void } {
  let mode: ViewMode = "all";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "active" || saved === "pending") mode = saved;
  } catch {
    // The view remains usable when Desktop storage is unavailable.
  }
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const toolbar = document.createElement("div");
  toolbar.setAttribute(FILTER_ATTRIBUTE, "");
  const group = document.createElement("div");
  group.setAttribute("role", "group");
  const allButton = document.createElement("button");
  const activeButton = document.createElement("button");
  const pendingButton = document.createElement("button");
  allButton.type = activeButton.type = pendingButton.type = "button";
  const status = document.createElement("span");
  status.dataset.filterStatus = "";
  status.setAttribute("role", "status");
  group.append(allButton, activeButton, pendingButton);
  toolbar.append(group, status);

  const states = new Map<HTMLElement, RowState>();
  let disposed = false;
  let scheduled = false;
  let inFlight = 0;

  const setMode = (next: ViewMode): void => {
    if (mode === next) return;
    mode = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage failure does not block this window's view.
    }
    for (const state of states.values()) state.checkedAt = 0;
    schedule();
  };
  allButton.addEventListener("click", () => setMode("all"));
  activeButton.addEventListener("click", () => setMode("active"));
  pendingButton.addEventListener("click", () => setMode("pending"));

  const renderToolbar = (count: number, pending: number, failed: number): void => {
    const chinese = options.getLocale() === "zh-CN";
    const allLabel = chinese ? "全部" : "All";
    const activeLabel = chinese ? "进行中" : "Active";
    const pendingLabel = chinese ? "待确认" : "To review";
    if (allButton.textContent !== allLabel) allButton.textContent = allLabel;
    if (activeButton.textContent !== activeLabel) activeButton.textContent = activeLabel;
    if (pendingButton.textContent !== pendingLabel) pendingButton.textContent = pendingLabel;
    activeButton.title = chinese
      ? "只显示运行中和进行中的会话"
      : "Show only running and in-progress conversations";
    allButton.setAttribute("aria-pressed", String(mode === "all"));
    activeButton.setAttribute("aria-pressed", String(mode === "active"));
    pendingButton.setAttribute("aria-pressed", String(mode === "pending"));
    pendingButton.title = chinese
      ? "只显示待确认的会话"
      : "Show only conversations awaiting confirmation";
    const statusLabel =
      mode === "all"
        ? ""
        : pending > 0
          ? chinese
            ? "正在检查状态…"
            : "Checking status…"
          : failed > 0
            ? chinese
              ? "部分状态读取失败，稍后重试"
              : "Some statuses unavailable; retrying"
            : count === 0
              ? chinese
                ? mode === "pending"
                  ? "没有待确认的会话"
                  : "没有进行中的会话"
                : mode === "pending"
                  ? "No conversations awaiting confirmation"
                  : "No active conversations"
              : chinese
                ? mode === "pending"
                  ? `${count} 个待确认`
                  : `${count} 个进行中`
                : mode === "pending"
                  ? `${count} awaiting confirmation`
                  : `${count} active`;
    if (status.textContent !== statusLabel) status.textContent = statusLabel;
  };

  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };
  const read = (row: HTMLElement, state: RowState): void => {
    if (!state.client.readThreadActivity) return;
    state.pending = true;
    state.checkedAt = Date.now();
    inFlight += 1;
    void state.client
      .readThreadActivity(state.threadId)
      .then(
        (active) => {
          if (states.get(row) !== state || disposed) return;
          state.active = active;
          state.failed = false;
        },
        () => {
          if (states.get(row) !== state || disposed) return;
          state.active = null;
          state.failed = true;
        },
      )
      .finally(() => {
        state.pending = false;
        inFlight -= 1;
        schedule();
      });
  };

  function scan(): void {
    scheduled = false;
    if (disposed) return;
    const project = document.querySelector<HTMLElement>(PROJECT_SELECTOR);
    const fallback = document.querySelector<HTMLElement>(
      `#app-shell-sidebar > :not([${FILTER_ATTRIBUTE}]):not([data-codexhost-git-sidebar])`,
    );
    const anchor = project ?? fallback;
    if (
      anchor?.parentElement &&
      (toolbar.parentElement !== anchor.parentElement || toolbar.nextElementSibling !== anchor)
    ) {
      anchor.parentElement.insertBefore(toolbar, anchor);
    } else if (!anchor) {
      toolbar.remove();
    }
    const rows = new Set(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    for (const [row] of states) {
      if (rows.has(row)) continue;
      row.removeAttribute(HIDDEN_ATTRIBUTE);
      states.delete(row);
    }
    let count = 0;
    let pending = 0;
    let failed = 0;
    let pendingCount = 0;
    const now = Date.now();
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const threadId = hostId ? nativeThreadId(hostId, row) : null;
      const client = hostId ? options.getClient(hostId) : null;
      let state = states.get(row);
      if (!hostId || !threadId || !client?.readThreadActivity) {
        states.delete(row);
        row.toggleAttribute(HIDDEN_ATTRIBUTE, mode !== "all");
        if (mode !== "all") failed += 1;
        continue;
      }
      if (
        !state ||
        state.hostId !== hostId ||
        state.threadId !== threadId ||
        state.client !== client
      ) {
        state = {
          hostId,
          threadId,
          client,
          active: null,
          failed: false,
          checkedAt: 0,
          pending: false,
        };
        states.set(row, state);
      }
      if (
        mode === "active" &&
        !state.pending &&
        now - state.checkedAt >= REFRESH_MS &&
        inFlight < MAX_CONCURRENT_READS
      ) {
        read(row, state);
      }
      const awaiting = options.hasPending?.(hostId, threadId) ?? false;
      if (awaiting) pendingCount += 1;
      const hidden =
        mode === "active" ? state.active !== true : mode === "pending" ? !awaiting : false;
      row.toggleAttribute(HIDDEN_ATTRIBUTE, hidden);
      if (state.active) count += 1;
      if (mode === "active" && (state.pending || state.checkedAt === 0)) pending += 1;
      if (mode === "active" && state.failed) failed += 1;
    }
    renderToolbar(mode === "pending" ? pendingCount : count, pending, failed);
    poll.setActive(mode === "active" && rows.size > 0);
  }

  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          mutationAffectsElements(record, `${PROJECT_SELECTOR},${ROW_SELECTOR}`) ||
          mutationAffectsElements(record, "#app-shell-sidebar", false),
      )
    )
      schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [SIDEBAR_THREAD_HOST_ID_ATTRIBUTE, "data-app-action-sidebar-thread-id"],
  });
  const poll = createVisiblePoll(document, REFRESH_MS, schedule);
  const onFocus = () => {
    for (const state of states.values()) state.checkedAt = 0;
    schedule();
  };
  window.addEventListener("focus", onFocus);
  schedule();
  return {
    refresh: onFocus,
    dispose() {
      disposed = true;
      observer.disconnect();
      poll.dispose();
      window.removeEventListener("focus", onFocus);
      for (const row of states.keys()) row.removeAttribute(HIDDEN_ATTRIBUTE);
      states.clear();
      toolbar.remove();
      styles.remove();
    },
  };
}
