import createElement from "lucide/dist/esm/createElement.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import type { InterruptedQueue, InterruptedQueueEntry } from "./interrupted-queue.js";
import type { RendererModelClient } from "../renderer-model-client.js";
import { mutationAffectsElements } from "../renderer-dom-mutations.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "../renderer-sidebar-agent-icons.js";

type InterruptedThread = InterruptedQueueEntry;
type RecoveryStatus = InterruptedThread["status"];
const marker = "data-buddy-sidebar-recovery";
const recoverableMarker = "data-buddy-sidebar-recoverable";
const stateMarker = "data-buddy-sidebar-state";
// 覆盖原生状态槽的视觉内容，卸载时保留 React 管理的原始节点。
const style = `
[${recoverableMarker}]{background:color-mix(in srgb,#d99000 9%,transparent)!important;box-shadow:inset 3px 0 0 #d99000!important}
[${stateMarker}="failed"]{background:color-mix(in srgb,#d64b3f 9%,transparent)!important;box-shadow:inset 3px 0 0 #d64b3f!important}
[${stateMarker}="cancelled"]{background:color-mix(in srgb,#4b7bd6 9%,transparent)!important;box-shadow:inset 3px 0 0 #4b7bd6!important}
[${marker}]{position:relative}
[${marker}]>:not([data-buddy-resume]){visibility:hidden}
[data-buddy-resume]{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:3px;border:0;border-radius:5px;background:transparent;color:#b66a00;cursor:pointer}
[${stateMarker}="failed"] [data-buddy-resume]{color:#c73b31}
[${stateMarker}="cancelled"] [data-buddy-resume]{color:#3569bd}
[data-buddy-resume]:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
[data-buddy-resume]:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[data-buddy-resume]:disabled{opacity:.6;cursor:wait}
[data-buddy-recovery-error]{position:fixed;bottom:20px;left:16px;z-index:1000;max-width:min(360px,calc(100vw - 32px));padding:10px 12px;border:1px solid currentColor;border-radius:8px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,inherit);font:12px/1.5 system-ui;overflow-wrap:anywhere}
[data-buddy-recovery-error]:empty{display:none}
`;

export function installSidebarContinuation(options: {
  queue: InterruptedQueue;
  getClient(hostId: string): RendererModelClient | null;
  getLocale(): "zh-CN" | "en";
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  const error = document.createElement("div");
  error.dataset.buddyRecoveryError = "";
  error.setAttribute("role", "alert");
  document.head.append(styles);
  document.body.append(error);
  const mounted = new Map<
    HTMLElement,
    { slot: HTMLElement; button: HTMLButtonElement; key: string; client: RendererModelClient }
  >();
  let disposed = false;
  let scheduled = false;
  const chinese = () => options.getLocale() === "zh-CN";
  const keyFor = (hostId: string, thread: InterruptedThread) =>
    JSON.stringify([hostId, thread.threadId, thread.turnId]);
  const nativeThreadId = (hostId: string, row: HTMLElement): string | null => {
    const threadId = threadIdFromSidebarRowElement(row);
    if (!threadId) return null;
    const hostPrefix = `${hostId}:`;
    return threadId.startsWith(hostPrefix) ? threadId.slice(hostPrefix.length) : threadId;
  };
  const clear = (row: HTMLElement) => {
    const entry = mounted.get(row);
    if (!entry) return;
    entry.button.remove();
    entry.slot.removeAttribute(marker);
    mounted.delete(row);
  };
  const clearRow = (row: HTMLElement) => {
    clear(row);
    row.removeAttribute(recoverableMarker);
    row.removeAttribute(stateMarker);
  };
  const decorate = (row: HTMLElement, running: boolean, status: RecoveryStatus | undefined) => {
    row.toggleAttribute(recoverableMarker, !running && status !== undefined);
    const state = running ? "running" : status;
    if (state && row.getAttribute(stateMarker) !== state) row.setAttribute(stateMarker, state);
    else if (!state) row.removeAttribute(stateMarker);
  };
  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };
  const resume = async (hostId: string, thread: InterruptedThread, client: RendererModelClient) => {
    if (options.getClient(hostId) !== client || options.queue.isPending(thread)) return;
    error.textContent = "";
    try {
      await options.queue.resume(thread);
    } catch (failure) {
      if (disposed || options.getClient(hostId) !== client) return;
      error.textContent = `${chinese() ? "恢复失败" : "Could not resume"}: ${failure instanceof Error ? failure.message : String(failure)}`;
    } finally {
      schedule();
    }
  };
  function scan(): void {
    scheduled = false;
    if (disposed) return;
    const snapshots = new Map<string, Map<string, InterruptedThread>>();
    const rows = new Set(document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR));
    for (const row of mounted.keys()) {
      if (!rows.has(row)) clearRow(row);
    }
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const threadId = hostId ? nativeThreadId(hostId, row) : null;
      const client = hostId ? options.getClient(hostId) : null;
      if (!hostId || !threadId || !client) {
        clearRow(row);
        continue;
      }
      let threads = snapshots.get(hostId);
      if (!threads) {
        threads = new Map(options.queue.list(hostId).map((entry) => [entry.threadId, entry]));
        snapshots.set(hostId, threads);
      }
      const thread = threads.get(threadId);
      decorate(row, false, thread?.status);
      const title = row.querySelector("[data-thread-title-trigger]");
      const slot = title?.previousElementSibling;
      // 仅接管已验证的标题前状态槽，结构变化时不猜测其他按钮的位置。
      if (
        !thread ||
        !client.buddyContinue ||
        !(slot instanceof HTMLElement) ||
        !slot.matches("div.w-4.shrink-0")
      ) {
        clear(row);
        continue;
      }
      const key = keyFor(hostId, thread);
      let entry = mounted.get(row);
      if (
        entry?.key !== key ||
        entry.client !== client ||
        entry.slot !== slot ||
        entry.button.parentElement !== slot
      ) {
        clear(row);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.buddyResume = "";
        button.append(createElement(RefreshCw, { width: 14, height: 14, "aria-hidden": "true" }));
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (
            row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) !== hostId ||
            nativeThreadId(hostId, row) !== thread.threadId
          )
            return;
          void resume(hostId, thread, client);
        });
        // 状态按钮支持键盘，但不触发父行的打开会话或拖拽操作。
        button.addEventListener("keydown", (event) => event.stopPropagation());
        button.addEventListener("keyup", (event) => event.stopPropagation());
        button.addEventListener("pointerdown", (event) => event.stopPropagation());
        slot.setAttribute(marker, "");
        slot.append(button);
        entry = { slot, button, key, client };
        mounted.set(row, entry);
      }
      const busy = options.queue.isPending(thread);
      const statusLabel = busy
        ? chinese()
          ? "正在处理会话…"
          : "Processing conversation…"
        : chinese()
          ? thread.status === "failed"
            ? "会话执行失败，点击恢复"
            : thread.status === "cancelled"
              ? "会话已取消，点击恢复"
              : "会话已中断，点击恢复"
          : thread.status === "failed"
            ? "Conversation failed. Click to resume"
            : thread.status === "cancelled"
              ? "Conversation cancelled. Click to resume"
              : "Conversation interrupted. Click to resume";
      if (entry.button.disabled !== busy) entry.button.disabled = busy;
      if (entry.button.title !== statusLabel) {
        entry.button.title = statusLabel;
        entry.button.setAttribute("aria-label", statusLabel);
      }
    }
  }
  const refresh = () => schedule();
  const stopQueue = options.queue.subscribe(schedule);
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: [SIDEBAR_THREAD_HOST_ID_ATTRIBUTE, SIDEBAR_THREAD_ID_ATTRIBUTE],
    test: (record) => mutationAffectsElements(record, SIDEBAR_THREAD_ROW_SELECTOR),
    onMutate: () => schedule(),
  });
  // DOM 变化只重画本地队列，不读取历史或按时间重试。
  schedule();
  return {
    refresh,
    dispose() {
      disposed = true;
      stopObserving();
      stopQueue();
      for (const row of document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
        clearRow(row);
      }
      error.remove();
      styles.remove();
    },
  };
}
