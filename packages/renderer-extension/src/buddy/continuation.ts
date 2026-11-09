import createElement from "lucide/dist/esm/createElement.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import {
  INTERRUPTED_BACKGROUND_RECONCILE_INTERVAL_MS,
  INTERRUPTED_DISCOVERY_INTERVAL_MS,
  INTERRUPTED_RECONCILE_INTERVAL_MS,
  type InterruptedQueue,
  type InterruptedQueueEntry,
} from "./interrupted-queue.js";
import type { RendererModelClient } from "../renderer-model-client.js";
import { sidebarThreadNativeStatus } from "../renderer-sidebar-thread-status.js";
import { createVisiblePoll } from "../renderer-visible-poll.js";
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
const activeAttribute = "data-app-action-sidebar-thread-active";
// 侧栏后台核对：逐行核对已经渲染的行，另外按更低频率让 Host 全量发现一次。
// 官方三角说明界面已经提示需要处理，转圈则可能是“客户端以为还在跑、Host 早已停下
// 且不会再发终态”，两者都要核对；侧栏被过滤、折叠或根本没滚到的会话不会渲染成行，
// 只靠逐行扫描永远发现不了，因此还需要一条不依赖 DOM 的发现通道。
const BACKGROUND_POLL_MS = 30_000;
const BACKGROUND_CONCURRENCY = 3;
// 每轮只新增少量核对，避免一次重扫把所有可见行同时打给 Host。
const BACKGROUND_ATTENTION_BUDGET = 8;
const BACKGROUND_IDLE_BUDGET = 6;
// 空闲行没有“需要处理”的界面信号，抽样按固定节奏推进，避免 DOM 变动放大请求。
const BACKGROUND_IDLE_SPACING_MS = 60_000;
// 三角说明用户已经看到异常，核对最勤；残留转圈其次；其余空闲行最慢。
// 未读（蓝点）只是“结果已交付”，不算异常，落回空闲抽样。
const ATTENTION_RECONCILE_MS = INTERRUPTED_RECONCILE_INTERVAL_MS;
const RUNNING_RECONCILE_MS = 60_000;
const IDLE_RECONCILE_MS = INTERRUPTED_BACKGROUND_RECONCILE_INTERVAL_MS;
// 全量发现的轮询周期与队列自身的限流一致，可见时才会真正发出请求。
const DISCOVERY_POLL_MS = INTERRUPTED_DISCOVERY_INTERVAL_MS;
interface BackgroundCheck {
  hostId: string;
  threadId: string;
  intervalMs: number;
  /** 三角或转圈：界面看起来还没结束，优先核对并可占用本轮的紧急名额。 */
  urgent: boolean;
}
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
  getActiveThread?(): { hostId: string; threadId: string } | null;
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
  let backgroundInFlight = 0;
  // 本轮扫出的待核对行；每轮重扫时重建，避免累积已消失的行。
  let backgroundQueue: BackgroundCheck[] = [];
  // 受并发限制尚未发出的行，等槽位空出后继续，不丢到下个轮询周期。
  const backgroundWaiting = new Map<string, BackgroundCheck>();
  // 轮转游标：每轮从上次停下的行继续抽样，避免总是核对列表最上面的几条。
  let backgroundCursor = 0;
  let discoveryCursor = 0;
  let idleSampledAt = Date.now();
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
    backgroundQueue = [];
    const active = options.getActiveThread?.() ?? null;
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
      // 补查该会话，覆盖客户端闪退或重连期间错过的终态通知。选中行立即核对；
      // 未打开的行在后台按间隔核对，否则“停下但没收到终态”的会话永远不进队列。
      if (!thread) {
        const selected = active
          ? active.hostId === hostId && active.threadId === threadId
          : row.getAttribute(activeAttribute) === "true";
        if (selected) {
          void options.queue.reconcile(hostId, threadId);
        } else {
          const native = sidebarThreadNativeStatus(row);
          // 转圈不代表还在运行：客户端可能一直没收到终态，只能靠核对确认；
          // 其余空闲行按低频抽样，保证闪退或漏掉终态时也能被发现。
          backgroundQueue.push({
            hostId,
            threadId,
            intervalMs: native.error
              ? ATTENTION_RECONCILE_MS
              : native.running
                ? RUNNING_RECONCILE_MS
                : IDLE_RECONCILE_MS,
            urgent: native.error || native.running,
          });
        }
      }
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
    runBackground();
  }
  // 全量发现独立于 DOM：侧栏被过滤、折叠或滚动不到时，那些会话根本没有行，
  // 逐行扫描永远看不到它们。这里按 Host 轮转，每次只发一个 Host 的请求。
  function discoverAll(): void {
    if (disposed || document.hidden) return;
    const hosts = options.queue.hosts();
    if (hosts.length === 0) return;
    const index = discoveryCursor % hosts.length;
    const hostId = hosts[index];
    discoveryCursor = (index + 1) % hosts.length;
    if (hostId === undefined) return;
    if (!options.getClient(hostId)?.buddyInterrupted) return;
    void options.queue.discover(hostId);
  }
  // 侧栏后台核对：先排三角/转圈的行，再按游标轮转抽样空闲行。
  // 请求并发受限，其余行留在等待队列里由槽位释放后继续发出。
  function runBackground(): void {
    if (disposed || document.hidden) return;
    const rows = backgroundQueue;
    backgroundQueue = [];
    if (rows.length > 0) {
      const attention = rows.filter((item) => item.urgent);
      const idle = rows.filter((item) => !item.urgent);
      const chosen = attention.slice(0, BACKGROUND_ATTENTION_BUDGET);
      const now = Date.now();
      if (idle.length > 0 && now - idleSampledAt >= BACKGROUND_IDLE_SPACING_MS) {
        idleSampledAt = now;
        const start = backgroundCursor % idle.length;
        const take = Math.min(idle.length, BACKGROUND_IDLE_BUDGET);
        for (let offset = 0; offset < take; offset += 1)
          chosen.push(idle[(start + offset) % idle.length] as (typeof idle)[number]);
        backgroundCursor = start + take;
      }
      for (const item of chosen)
        backgroundWaiting.set(JSON.stringify([item.hostId, item.threadId]), item);
    }
    // 侧栏里已经消失的行不再补查，避免等待队列一直保留过期会话。
    const live = new Set(rows.map((item) => JSON.stringify([item.hostId, item.threadId])));
    for (const key of backgroundWaiting.keys()) if (!live.has(key)) backgroundWaiting.delete(key);
    pumpBackground();
  }
  function pumpBackground(): void {
    if (disposed || document.hidden) return;
    for (const [key, item] of backgroundWaiting) {
      if (backgroundInFlight >= BACKGROUND_CONCURRENCY) return;
      backgroundWaiting.delete(key);
      backgroundInFlight += 1;
      void options.queue
        .reconcile(item.hostId, item.threadId, { intervalMs: item.intervalMs })
        .finally(() => {
          backgroundInFlight -= 1;
          pumpBackground();
        });
    }
  }

  const refresh = () => schedule();
  const stopQueue = options.queue.subscribe(schedule);
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: [
      SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
      SIDEBAR_THREAD_ID_ATTRIBUTE,
      activeAttribute,
    ],
    test: (record) => mutationAffectsElements(record, SIDEBAR_THREAD_ROW_SELECTOR),
    onMutate: () => schedule(),
  });
  // DOM 变化只重画本地队列；窗口可见时按周期重扫已挂载的行交给队列核对。
  // 另外单独按更低频率做全量发现，覆盖从来没有渲染成行的会话。
  const poll = createVisiblePoll(document, BACKGROUND_POLL_MS, schedule);
  const discovery = createVisiblePoll(document, DISCOVERY_POLL_MS, discoverAll);
  poll.setActive(true);
  discovery.setActive(true);
  schedule();
  discoverAll();
  return {
    refresh,
    dispose() {
      disposed = true;
      backgroundWaiting.clear();
      poll.dispose();
      discovery.dispose();
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
