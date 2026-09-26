import createElement from "lucide/dist/esm/createElement.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import { hostThreadIdSchema, type BuddyInterrupted } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "../renderer-sidebar-agent-icons.js";

type InterruptedThread = BuddyInterrupted["threads"][number];
const marker = "data-buddy-sidebar-recovery";
const activeAttribute = "data-app-action-sidebar-thread-active";

// 覆盖原生状态槽的视觉内容，卸载时保留 React 管理的原始节点。
const style = `
[${marker}]{position:relative}
[${marker}]>:not([data-buddy-resume]){visibility:hidden}
[data-buddy-resume]{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:3px;border:0;border-radius:5px;background:transparent;color:var(--color-token-text-warning,#b77b20);cursor:pointer}
[data-buddy-resume]:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
[data-buddy-resume]:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[data-buddy-resume]:disabled{opacity:.6;cursor:wait}
[data-buddy-recovery-error]{position:fixed;bottom:20px;left:16px;z-index:1000;max-width:min(360px,calc(100vw - 32px));padding:10px 12px;border:1px solid currentColor;border-radius:8px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,inherit);font:12px/1.5 system-ui;overflow-wrap:anywhere}
[data-buddy-recovery-error]:empty{display:none}
`;

export function installSidebarContinuation(options: {
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
  const hosts = new Map<
    string,
    {
      client: RendererModelClient;
      threads: Map<string, InterruptedThread>;
      pending: boolean;
      updatedAt: number;
    }
  >();
  const mounted = new Map<
    HTMLElement,
    { slot: HTMLElement; button: HTMLButtonElement; key: string }
  >();
  const pending = new Set<string>();
  const continued = new Set<string>();
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
  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };
  const load = async (hostId: string, state: NonNullable<ReturnType<typeof hosts.get>>) => {
    if (state.pending || !state.client.buddyStatus || !state.client.buddyInterrupted) return;
    state.pending = true;
    state.updatedAt = Date.now();
    try {
      const snapshot = await state.client.buddyStatus();
      if (disposed || hosts.get(hostId) !== state) return;
      if (!snapshot.settings.enabled || snapshot.settings.privateMode) {
        state.threads.clear();
        return;
      }
      const result = await state.client.buddyInterrupted();
      const ownership = result.threads.length
        ? await state.client.listThreadOwnership({
            threadIds: result.threads.map((thread) => hostThreadIdSchema.parse(thread.threadId)),
          })
        : { threads: [] };
      if (disposed || hosts.get(hostId) !== state) return;
      const native = new Set<string>(
        ownership.threads
          .filter((thread) => thread.owner === "codex")
          .map((thread) => thread.threadId),
      );
      state.threads = new Map(
        result.threads
          .filter((thread) => native.has(thread.threadId))
          .map((thread) => [thread.threadId, thread]),
      );
    } catch (failure) {
      if (disposed || hosts.get(hostId) !== state) return;
      state.threads.clear();
      // 后台发现失败不弹窗打断用户；实际点击的续接错误通过 alert 显示。
      console.warn("[codexhost] Sidebar continuation discovery failed", failure);
    } finally {
      state.pending = false;
      schedule();
    }
  };
  const resume = async (hostId: string, thread: InterruptedThread, client: RendererModelClient) => {
    const key = keyFor(hostId, thread);
    if (!client.buddyContinue) return;
    if (pending.has(key) || continued.has(key) || options.getClient(hostId) !== client) return;
    pending.add(key);
    error.textContent = "";
    schedule();
    try {
      await client.buddyContinue(thread.threadId, thread.turnId);
      if (disposed || options.getClient(hostId) !== client) return;
      continued.add(key);
      hosts.get(hostId)?.threads.delete(thread.threadId);
    } catch (failure) {
      if (disposed || options.getClient(hostId) !== client) return;
      error.textContent = `${chinese() ? "恢复失败，可点击状态图标重试" : "Could not resume. Click the status icon to retry"}: ${failure instanceof Error ? failure.message : String(failure)}`;
    } finally {
      pending.delete(key);
      schedule();
    }
  };
  function scan(): void {
    scheduled = false;
    if (disposed) return;
    const visibleHosts = new Set<string>();
    const rows = [...document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)];
    for (const row of mounted.keys()) {
      if (!rows.includes(row)) clear(row);
    }
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const threadId = hostId ? nativeThreadId(hostId, row) : null;
      const client = hostId ? options.getClient(hostId) : null;
      if (
        !hostId ||
        !threadId ||
        !client?.buddyStatus ||
        !client.buddyInterrupted ||
        !client.buddyContinue
      ) {
        clear(row);
        continue;
      }
      visibleHosts.add(hostId);
      let state = hosts.get(hostId);
      if (!state || state.client !== client) {
        state = { client, threads: new Map(), pending: false, updatedAt: 0 };
        hosts.set(hostId, state);
      }
      if (!state.pending && Date.now() - state.updatedAt >= 15_000) void load(hostId, state);
      const thread = state.threads.get(threadId);
      const title = row.querySelector("[data-thread-title-trigger]");
      const slot = title?.previousElementSibling;
      // 仅接管已验证的标题前状态槽，结构变化时不猜测其他按钮的位置。
      if (
        !thread ||
        row.getAttribute(activeAttribute) === "true" ||
        !(slot instanceof HTMLElement) ||
        !slot.matches("div.w-4.shrink-0") ||
        continued.has(keyFor(hostId, thread))
      ) {
        clear(row);
        continue;
      }
      const key = keyFor(hostId, thread);
      let entry = mounted.get(row);
      if (entry?.key !== key || entry.slot !== slot || entry.button.parentElement !== slot) {
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
            threadIdFromSidebarRowElement(row) !== thread.threadId ||
            row.getAttribute(activeAttribute) === "true"
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
        entry = { slot, button, key };
        mounted.set(row, entry);
      }
      const busy = pending.has(key);
      const label = busy
        ? chinese()
          ? "正在恢复会话…"
          : "Resuming conversation…"
        : chinese()
          ? "会话已中断，点击恢复"
          : "Conversation interrupted. Click to resume";
      entry.button.disabled = busy;
      if (entry.button.title !== label) {
        entry.button.title = label;
        entry.button.setAttribute("aria-label", label);
      }
    }
    for (const hostId of hosts.keys()) {
      if (!visibleHosts.has(hostId)) hosts.delete(hostId);
    }
  }
  const refresh = () => {
    for (const state of hosts.values()) state.updatedAt = 0;
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
      SIDEBAR_THREAD_ID_ATTRIBUTE,
      activeAttribute,
    ],
  });
  const timer = window.setInterval(schedule, 1500);
  window.addEventListener("focus", refresh);
  schedule();
  return {
    refresh,
    dispose() {
      disposed = true;
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      for (const row of mounted.keys()) clear(row);
      hosts.clear();
      pending.clear();
      continued.clear();
      error.remove();
      styles.remove();
    },
  };
}
