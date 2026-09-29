import {
  committedReactAncestors,
  type RendererHostRoute,
} from "@codexhost/desktop-control/renderer-bindings";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

type Manager = Pick<RendererHostRoute["manager"], "addNotificationCallback">;
interface TurnState {
  turnId: string;
  finished: boolean;
  unread: boolean;
}
interface HostState {
  manager: Manager | null;
  unsubscribe: (() => void) | null;
  turns: Map<string, TurnState>;
}

const DOT = "data-codexhost-sidebar-unread";
const SLOT = "data-codexhost-sidebar-unread-slot";
const ACTIVE = "data-app-action-sidebar-thread-active";
const style = `
[${SLOT}]{position:relative}
[${SLOT}]>:not([${DOT}]){visibility:hidden}
[${DOT}]{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;pointer-events:none}
[${SLOT}]>[${DOT}]{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);visibility:visible}
[${DOT}]::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--color-background-info-solid,#3b82f6)}
`;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nativeUnread(row: HTMLElement): boolean {
  const key = Object.getOwnPropertyNames(row).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return false;
  for (const fiber of committedReactAncestors(Reflect.get(row, key)).slice(0, 12)) {
    const props = record(fiber.memoizedProps);
    const attributes = record(props?.dataAttributes);
    if (
      attributes?.[SIDEBAR_THREAD_ID_ATTRIBUTE] === row.getAttribute(SIDEBAR_THREAD_ID_ATTRIBUTE) &&
      attributes?.[SIDEBAR_THREAD_HOST_ID_ATTRIBUTE] ===
        row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) &&
      record(props?.statusState)?.unread === true
    )
      return true;
  }
  return false;
}

export function installRendererSidebarUnread(options: {
  getManager(hostId: string): Manager | null;
  getLocale(): "zh-CN" | "en";
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const hosts = new Map<string, HostState>();
  const mounted = new Map<HTMLElement, { dot: HTMLElement; slot: HTMLElement | null }>();
  let disposed = false;
  let scheduled = false;

  const clear = (row: HTMLElement): void => {
    const entry = mounted.get(row);
    entry?.dot.remove();
    entry?.slot?.removeAttribute(SLOT);
    mounted.delete(row);
  };
  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };
  const connect = (hostId: string): HostState => {
    let state = hosts.get(hostId);
    if (!state) {
      state = { manager: null, unsubscribe: null, turns: new Map() };
      hosts.set(hostId, state);
    }
    const manager = options.getManager(hostId);
    if (state.manager === manager) return state;
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.manager = manager;
    if (!manager?.addNotificationCallback) return state;
    const current = state;
    try {
      current.unsubscribe = manager.addNotificationCallback(
        ["turn/started", "turn/completed"],
        (notification) => {
          if (disposed || current.manager !== manager || options.getManager(hostId) !== manager)
            return;
          const event = record(notification);
          const params = record(event?.params);
          const turn = record(params?.turn);
          const threadId = params?.threadId;
          if (typeof threadId !== "string" || !threadId || typeof turn?.id !== "string" || !turn.id)
            return;
          if (event?.method !== "turn/started" && event?.method !== "turn/completed") return;
          const finished = event.method === "turn/completed";
          const previous = current.turns.get(threadId);
          // 重复完成通知不能重新点亮已读会话；新回合开始后忽略旧回合迟到的完成通知。
          if (previous?.turnId === turn.id && previous.finished) return;
          if (finished && previous && !previous.finished && previous.turnId !== turn.id) return;
          current.turns.set(threadId, {
            turnId: turn.id,
            finished,
            unread: finished && turn.status === "completed",
          });
          schedule();
        },
      );
    } catch (error) {
      current.manager = null;
      console.warn("[codexhost] Sidebar unread notifications unavailable", error);
    }
    return current;
  };

  function scan(): void {
    scheduled = false;
    if (disposed) return;
    const rows = new Set(document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR));
    for (const row of mounted.keys()) {
      if (!rows.has(row)) clear(row);
    }
    // 折叠项目后仍接收已连接 Host 的完成通知，展开时再补到新挂载的行。
    const hostIds = new Set(hosts.keys());
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      if (hostId && hostId !== "local" && hostId !== "durable") hostIds.add(hostId);
    }
    for (const hostId of hostIds) connect(hostId);
    const visible = !document.hidden && document.hasFocus();
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const id = threadIdFromSidebarRowElement(row);
      const threadId = hostId && id?.startsWith(`${hostId}:`) ? id.slice(hostId.length + 1) : id;
      const turn = hostId && threadId ? hosts.get(hostId)?.turns.get(threadId) : undefined;
      if (turn?.unread && ((visible && row.getAttribute(ACTIVE) === "true") || nativeUnread(row))) {
        // 官方未读标识出现后交回官方；查看会话时只清除本窗口的补充提示。
        turn.unread = false;
      }
      if (!turn?.unread) {
        clear(row);
        continue;
      }
      const title = row.querySelector<HTMLElement>("[data-thread-title-trigger]");
      if (!title) {
        clear(row);
        continue;
      }
      const leading = title.previousElementSibling;
      const slot =
        leading instanceof HTMLElement && leading.matches("div.w-4.shrink-0") ? leading : null;
      let entry = mounted.get(row);
      if (
        entry &&
        (entry.slot !== slot ||
          entry.dot.parentElement !== (slot ?? title.parentElement) ||
          (!slot && entry.dot.nextElementSibling !== title))
      ) {
        clear(row);
        entry = undefined;
      }
      if (!entry) {
        const dot = document.createElement("span");
        dot.setAttribute(DOT, "");
        dot.setAttribute("role", "img");
        if (slot) {
          slot.setAttribute(SLOT, "");
          slot.append(dot);
        } else {
          title.before(dot);
        }
        entry = { dot, slot };
        mounted.set(row, entry);
      }
      const label = options.getLocale() === "zh-CN" ? "新回复，尚未阅读" : "New unread reply";
      if (entry.dot.title !== label) {
        entry.dot.title = label;
        entry.dot.setAttribute("aria-label", label);
      }
    }
  }

  const observer = new MutationObserver((records) => {
    if (records.some((entry) => mutationAffectsElements(entry, SIDEBAR_THREAD_ROW_SELECTOR)))
      schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [SIDEBAR_THREAD_HOST_ID_ATTRIBUTE, SIDEBAR_THREAD_ID_ATTRIBUTE, ACTIVE],
  });
  window.addEventListener("focus", schedule);
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return {
    refresh: schedule,
    dispose() {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
      for (const state of hosts.values()) state.unsubscribe?.();
      for (const row of mounted.keys()) clear(row);
      hosts.clear();
      styles.remove();
    },
  };
}
