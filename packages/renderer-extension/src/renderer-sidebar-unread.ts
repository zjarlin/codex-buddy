import type { PendingConfirmationsModel } from "./pending-confirmations-state.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";
import { sidebarThreadNativeStatus } from "./renderer-sidebar-thread-status.js";

const DOT = "data-codexhost-sidebar-unread";
const SLOT = "data-codexhost-sidebar-unread-slot";
const ACTIVE = "data-app-action-sidebar-thread-active";
const READ_DWELL_MS = 3_000;
const style = `
[${SLOT}]{position:relative}
[${SLOT}]>:not([${DOT}]){visibility:hidden}
[${DOT}]{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;pointer-events:none}
[${SLOT}]>[${DOT}]{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);visibility:visible}
[${DOT}]::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--color-background-info-solid,#3b82f6)}
`;

// 补充蓝点不是独立状态，而是待确认队列的投影：队列里有一条，行上就有一个点。
// 这样“侧栏蓝点个数”恒等于“能弹出的完成卡片个数”，也保证重启后两边一起消失。
export function installRendererSidebarUnread(options: {
  getLocale(): "zh-CN" | "en";
  pendingConfirmations: PendingConfirmationsModel;
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const mounted = new Map<HTMLElement, { dot: HTMLElement; slot: HTMLElement | null }>();
  let disposed = false;
  let scheduled = false;
  let reading: { hostId: string; threadId: string; turnId: string; since: number } | null = null;
  let readTimer: ReturnType<typeof setTimeout> | null = null;

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
  const unsubscribe = options.pendingConfirmations.subscribe(schedule);

  function scan(): void {
    scheduled = false;
    if (disposed) return;
    const rows = new Set(document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR));
    for (const row of mounted.keys()) {
      if (!rows.has(row)) clear(row);
    }
    const visible = !document.hidden && document.hasFocus();
    const now = performance.now();
    let nextReading: { hostId: string; threadId: string; turnId: string } | null = null;
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const id = threadIdFromSidebarRowElement(row);
      const threadId = hostId && id?.startsWith(`${hostId}:`) ? id.slice(hostId.length + 1) : id;
      if (!hostId || !threadId) {
        clear(row);
        continue;
      }
      const entry = options.pendingConfirmations
        .pending()
        .find((candidate) => candidate.hostId === hostId && candidate.threadId === threadId);
      if (!entry) {
        // 没有待确认项就没有蓝点；原生未读由官方自己绘制，不重复添加。
        clear(row);
        continue;
      }
      if (visible && row.getAttribute(ACTIVE) === "true") {
        nextReading = { hostId, threadId, turnId: entry.turnId };
      }
      // 官方蓝点已经表示同一条未读结果，避免叠成两个点。
      if (sidebarThreadNativeStatus(row).unread) {
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
      let current = mounted.get(row);
      if (
        current &&
        (current.slot !== slot ||
          current.dot.parentElement !== (slot ?? title.parentElement) ||
          (!slot && current.dot.nextElementSibling !== title))
      ) {
        clear(row);
        current = undefined;
      }
      if (!current) {
        const dot = document.createElement("span");
        dot.setAttribute(DOT, "");
        dot.setAttribute("role", "img");
        if (slot) {
          slot.setAttribute(SLOT, "");
          slot.append(dot);
        } else {
          title.before(dot);
        }
        current = { dot, slot };
        mounted.set(row, current);
      }
      const label =
        options.getLocale() === "zh-CN" ? "有新结果待确认" : "New result awaiting confirmation";
      if (current.dot.title !== label) {
        current.dot.title = label;
        current.dot.setAttribute("aria-label", label);
      }
    }
    // 只在前台连续停留该会话时计时；切换、失焦或新回合都会重新开始。
    if (
      !reading ||
      !nextReading ||
      reading.hostId !== nextReading.hostId ||
      reading.threadId !== nextReading.threadId ||
      reading.turnId !== nextReading.turnId
    ) {
      if (readTimer !== null) {
        clearTimeout(readTimer);
        readTimer = null;
      }
      reading = nextReading ? { ...nextReading, since: now } : null;
    }
    if (reading && nextReading && now - reading.since >= READ_DWELL_MS) {
      const target = options.pendingConfirmations
        .pending()
        .find(
          (candidate) =>
            candidate.hostId === nextReading?.hostId &&
            candidate.threadId === nextReading.threadId &&
            candidate.turnId === nextReading.turnId,
        );
      reading = null;
      if (target) {
        // 与卡片共用同一份队列：确认后蓝点和卡片在同一次状态变更里一起消失。
        options.pendingConfirmations.confirm(target);
        return;
      }
    }
    if (reading && readTimer === null) {
      readTimer = setTimeout(
        () => {
          readTimer = null;
          schedule();
        },
        Math.max(0, READ_DWELL_MS - (now - reading.since)),
      );
    }
  }

  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: [
      SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
      SIDEBAR_THREAD_ID_ATTRIBUTE,
      // 官方未读描述变化时要重扫，避免官方蓝点与补充蓝点同时出现。
      "aria-describedby",
      ACTIVE,
    ],
    test: (mutation) => mutationAffectsElements(mutation, SIDEBAR_THREAD_ROW_SELECTOR),
    onMutate: () => schedule(),
  });
  window.addEventListener("focus", schedule);
  window.addEventListener("blur", schedule);
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return {
    refresh: schedule,
    dispose() {
      disposed = true;
      stopObserving();
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (readTimer !== null) {
        clearTimeout(readTimer);
      }
      reading = null;
      unsubscribe();
      for (const row of mounted.keys()) clear(row);
      styles.remove();
    },
  };
}
