import createElement from "lucide/dist/esm/createElement.mjs";
import Play from "lucide/dist/esm/icons/play.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";

type InterruptedThread = BuddyInterrupted["threads"][number];
const messages = {
  "zh-CN": {
    heading: "最近中断会话",
    empty: "暂无最近中断会话。",
    loading: "正在读取最近中断会话…",
    refresh: "刷新中断会话",
    resume: "恢复",
    resuming: "正在恢复…",
    resumeAll: "全部继续",
    resumeFailed: "恢复失败",
    unavailable: "当前连接不支持会话恢复。",
    private: "隐私模式下不能续接普通会话。",
    unreadable: "条会话历史暂时无法读取",
    failed: "失败",
    interrupted: "已中断",
    cancelled: "已取消",
  },
  en: {
    heading: "Recent interrupted conversations",
    empty: "No recently interrupted conversations.",
    loading: "Loading recently interrupted conversations…",
    refresh: "Refresh interrupted conversations",
    resume: "Resume",
    resuming: "Resuming…",
    resumeAll: "Resume all",
    resumeFailed: "Resume failed",
    unavailable: "Conversation recovery is unavailable on this connection.",
    private: "Ordinary conversations cannot resume in private mode.",
    unreadable: "conversation histories could not be read",
    failed: "Failed",
    interrupted: "Interrupted",
    cancelled: "Cancelled",
  },
};

const keyFor = (thread: InterruptedThread) => JSON.stringify([thread.threadId, thread.turnId]);
const errorMessage = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

function session(client: RendererModelClient | null) {
  return {
    client,
    threads: [] as InterruptedThread[],
    pending: new Set<string>(),
    continued: new Set<string>(),
    failures: new Map<string, string>(),
    loading: false,
    batch: false,
    updatedAt: 0,
    unreadable: 0,
    error: "",
  };
}

export function createInterruptedPanel(getLocale: () => "zh-CN" | "en") {
  const root = document.createElement("div");
  root.className = "buddy-tab-panel";
  root.dataset.buddyTabPanel = "interrupted";
  let state = session(null);
  let privateMode = false;
  let disposed = false;
  let epoch = 0;
  let fingerprint = "";

  const current = (target: typeof state) => !disposed && state === target;
  const canResume = (target: typeof state) => current(target) && !privateMode;

  async function refresh(force = false): Promise<void> {
    const target = state;
    if (
      !canResume(target) ||
      !target.client?.buddyInterrupted ||
      target.loading ||
      target.batch ||
      (!force && Date.now() - target.updatedAt < 15_000)
    ) {
      return;
    }
    target.loading = true;
    target.updatedAt = Date.now();
    target.error = "";
    render();
    try {
      const result = await target.client.buddyInterrupted();
      if (!canResume(target)) return;
      const running = new Set(result.runningThreadIds);
      target.threads = result.threads.filter(
        (thread) =>
          thread.owner === "codex" &&
          !running.has(thread.threadId) &&
          !target.continued.has(keyFor(thread)),
      );
      target.unreadable = result.unreadable;
    } catch (failure) {
      if (current(target)) target.error = errorMessage(failure);
    } finally {
      target.loading = false;
      if (current(target)) render();
    }
  }

  async function resume(target: typeof state, thread: InterruptedThread): Promise<void> {
    const key = keyFor(thread);
    if (
      !canResume(target) ||
      !target.client?.buddyContinue ||
      target.pending.has(key) ||
      target.continued.has(key)
    ) {
      return;
    }
    target.pending.add(key);
    target.failures.delete(key);
    render();
    try {
      await target.client.buddyContinue(thread.threadId, thread.turnId);
      target.continued.add(key);
      target.threads = target.threads.filter((candidate) => keyFor(candidate) !== key);
    } catch (failure) {
      target.failures.set(key, errorMessage(failure));
    } finally {
      target.pending.delete(key);
      if (current(target)) render();
    }
  }

  async function resumeAll(): Promise<void> {
    const target = state;
    if (!canResume(target) || target.batch || target.loading || target.pending.size > 0) return;
    const candidates = [...target.threads];
    const startedAtEpoch = epoch;
    target.batch = true;
    render();
    try {
      // 只处理点击时的列表；逐条提交，切换连接或开启隐私后停止剩余请求。
      for (const thread of candidates) {
        if (!canResume(target) || epoch !== startedAtEpoch) break;
        await resume(target, thread);
      }
    } finally {
      target.batch = false;
      if (current(target)) render();
    }
  }

  function render(): void {
    const m = messages[getLocale()];
    const signature = JSON.stringify([
      getLocale(),
      privateMode,
      Boolean(state.client?.buddyContinue),
      Boolean(state.client?.buddyInterrupted),
      state.threads,
      state.loading,
      state.batch,
      state.error,
      state.unreadable,
      [...state.pending],
      [...state.failures],
    ]);
    if (fingerprint === signature) return;
    fingerprint = signature;
    const wrapper = document.createElement("div");
    wrapper.className = "buddy-interrupted";
    const heading = document.createElement("b");
    heading.className = "buddy-interrupted-heading";
    heading.textContent = m.heading;
    const toolbar = document.createElement("div");
    toolbar.className = "buddy-interrupted-toolbar";
    toolbar.append(heading);
    wrapper.append(toolbar);
    const note = (text: string, failure = false, parent: HTMLElement = wrapper) => {
      const element = document.createElement("div");
      element.className = `buddy-interrupted-note${failure ? " buddy-interrupted-error" : ""}`;
      element.setAttribute("role", "status");
      element.textContent = text;
      parent.append(element);
    };
    if (privateMode || !state.client?.buddyInterrupted || !state.client.buddyContinue) {
      note(privateMode ? m.private : m.unavailable);
      root.replaceChildren(wrapper);
      return;
    }
    const reload = document.createElement("button");
    reload.type = "button";
    reload.title = m.refresh;
    reload.setAttribute("aria-label", m.refresh);
    reload.append(createElement(RefreshCw, { width: 14, height: 14, "aria-hidden": "true" }));
    reload.disabled = state.loading || state.batch;
    reload.addEventListener("click", () => {
      void refresh(true);
    });
    const all = document.createElement("button");
    all.type = "button";
    all.append(createElement(Play, { width: 14, height: 14, "aria-hidden": "true" }));
    all.append(`${state.batch ? m.resuming : m.resumeAll} (${state.threads.length})`);
    all.disabled =
      state.loading || state.batch || state.pending.size > 0 || state.threads.length === 0;
    all.addEventListener("click", () => {
      void resumeAll();
    });
    toolbar.append(reload, all);
    if (state.loading) note(m.loading);
    if (state.error) note(state.error, true);
    if (state.unreadable > 0) note(`${state.unreadable} ${m.unreadable}`);
    if (!state.loading && state.threads.length === 0 && !state.error) note(m.empty);
    const list = document.createElement("div");
    list.className = "buddy-interrupted-list";
    for (const thread of state.threads) {
      const key = keyFor(thread);
      const item = document.createElement("div");
      item.className = "buddy-interrupted-item";
      const copy = document.createElement("span");
      copy.className = "buddy-interrupted-copy";
      const title = document.createElement("b");
      title.className = "buddy-interrupted-title";
      title.title = thread.title;
      title.textContent = thread.title;
      const status = document.createElement("small");
      status.className = "buddy-interrupted-status";
      status.textContent = m[thread.status];
      copy.append(title, status);
      const failure = state.failures.get(key);
      if (failure) note(`${m.resumeFailed}: ${failure}`, true, copy);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = state.pending.has(key) ? m.resuming : m.resume;
      button.disabled = state.batch || state.pending.has(key);
      const target = state;
      button.addEventListener("click", () => {
        void resume(target, thread);
      });
      item.append(copy, button);
      list.append(item);
    }
    wrapper.append(list);
    root.replaceChildren(wrapper);
  }

  return {
    root,
    update(client: RendererModelClient | null, privacy: boolean) {
      if (disposed) return;
      if (client !== state.client) {
        state = session(client);
        epoch += 1;
      }
      if (privacy !== privateMode) {
        privateMode = privacy;
        epoch += 1;
      }
      render();
      void refresh();
    },
    refresh,
    dispose() {
      disposed = true;
      root.remove();
    },
  };
}
