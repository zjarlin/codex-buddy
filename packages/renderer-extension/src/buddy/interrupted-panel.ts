import createElement from "lucide/dist/esm/createElement.mjs";
import Play from "lucide/dist/esm/icons/play.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import type { RendererModelClient } from "../renderer-model-client.js";
import { RendererMethodUnavailableError } from "../renderer-request-sender.js";
import type { ModelShortcutView } from "../renderer-model-shortcuts.js";
import { readModelFavorites } from "../renderer-model-favorites.js";

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
    resumeWithModel: "以某模型 ID 继续",
    resumeWithModelHint: "复用当前模型选择；指定模型 ID 可避免自动选模导致再次中断。",
    resumeFailed: "恢复失败",
    unavailable: "当前连接不支持会话恢复。",
    waiting: "连接状态尚未确认，暂时无法恢复会话。",
    unavailableHint:
      "请确认当前连接已接入支持会话恢复的 codexhost；SSH 会话需在远端启用后重新连接。",
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
    resumeWithModel: "Resume with model ID",
    resumeWithModelHint:
      "Reuse current model picker; specifying a model ID avoids repeated interruptions from auto selection.",
    resumeFailed: "Resume failed",
    unavailable: "Conversation recovery is unavailable on this connection.",
    waiting: "Waiting for connection status before allowing conversation recovery.",
    unavailableHint:
      "Check that this connection runs codexhost with conversation recovery; for SSH, enable it on the remote machine and reconnect.",
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
    unavailable: false,
    error: "",
    modelView: null as ModelShortcutView | null,
    harnessId: "",
  };
}

export function createInterruptedPanel(getLocale: () => "zh-CN" | "en") {
  const chinese = () => getLocale() === "zh-CN";
  const root = document.createElement("div");
  root.className = "buddy-recovery-panel";
  let state = session(null);
  let privateMode = false;
  let disposed = false;
  let epoch = 0;
  let fingerprint = "";

  const current = (target: typeof state) => !disposed && state === target;
  const canResume = (target: typeof state) =>
    current(target) && !privateMode && !target.unavailable;

  async function refresh(force = false): Promise<void> {
    const target = state;
    if (
      document.hidden ||
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
      if (current(target)) {
        target.unavailable ||= failure instanceof RendererMethodUnavailableError;
        target.error = errorMessage(failure);
      }
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
      target.unavailable ||= failure instanceof RendererMethodUnavailableError;
      target.failures.set(key, errorMessage(failure));
    } finally {
      target.pending.delete(key);
      if (current(target)) render();
    }
  }

  async function resumeAll(modelId?: string): Promise<void> {
    const target = state;
    if (!canResume(target) || target.batch || target.loading || target.pending.size > 0) return;
    const candidates = [...target.threads];
    const startedAtEpoch = epoch;
    target.batch = true;
    render();
    try {
      // 只处理点击时的列表；逐条提交，切换连接或开启隐私后停止剩余请求。
      // TODO: wire modelId into buddyContinue when Host supports per-resume model override.
      void modelId;
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
      state.unavailable,
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
    if (
      privateMode ||
      state.unavailable ||
      !state.client?.buddyInterrupted ||
      !state.client.buddyContinue
    ) {
      note(privateMode ? m.private : state.client ? m.unavailable : m.waiting);
      if (state.unavailable && !privateMode) note(m.unavailableHint);
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
    all.dataset.buddyResumeAll = "";
    all.append(createElement(Play, { width: 14, height: 14, "aria-hidden": "true" }));
    all.append(`${state.batch ? m.resuming : m.resumeAll} (${state.threads.length})`);
    all.disabled =
      state.loading || state.batch || state.pending.size > 0 || state.threads.length === 0;
    all.addEventListener("click", () => {
      void resumeAll();
    });
    const modelResume = document.createElement("div");
    modelResume.className = "buddy-interrupted-model-resume";
    const modelSelect = document.createElement("select");
    modelSelect.className = "buddy-select";
    modelSelect.title = m.resumeWithModelHint;
    modelSelect.setAttribute("aria-label", m.resumeWithModel);
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = m.resumeWithModel;
    modelSelect.append(defaultOption);
    const view = state.modelView;
    const favorites =
      view && state.harnessId ? readModelFavorites(state.harnessId) : new Set<string>();
    const catalog = new Map(view?.models.map((model) => [model.id, model.label] as const) ?? []);
    const candidates = [...favorites]
      .map((id) => ({ id, label: catalog.get(id) ?? id }))
      .concat(
        (view?.models ?? [])
          .filter((model) => !favorites.has(model.id))
          .map((model) => ({ id: model.id, label: model.label })),
      );
    for (const candidate of candidates) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.label;
      option.title = candidate.id;
      modelSelect.append(option);
    }
    const customOption = document.createElement("option");
    customOption.value = "__custom__";
    customOption.textContent = chinese() ? "手动输入模型 ID…" : "Enter model ID…";
    modelSelect.append(customOption);
    modelSelect.disabled =
      state.loading || state.batch || state.pending.size > 0 || state.threads.length === 0;
    const modelInput = document.createElement("input");
    modelInput.type = "search";
    modelInput.className = "buddy-interrupted-model-input";
    modelInput.placeholder = chinese() ? "粘贴或输入模型 ID" : "Paste or type a model ID";
    modelInput.setAttribute("aria-label", m.resumeWithModel);
    modelInput.hidden = true;
    modelInput.disabled = modelSelect.disabled;
    const applyModel = document.createElement("button");
    applyModel.type = "button";
    applyModel.dataset.buddyResumeWithModel = "";
    applyModel.textContent = chinese() ? "应用" : "Apply";
    applyModel.disabled = true;
    const updateApplyState = () => {
      const value =
        modelSelect.value === "__custom__" ? modelInput.value.trim() : modelSelect.value;
      applyModel.disabled = !value || modelSelect.disabled;
    };
    modelSelect.addEventListener("change", () => {
      if (modelSelect.value === "__custom__") {
        modelInput.hidden = false;
        modelInput.focus();
      } else {
        modelInput.hidden = true;
        modelInput.value = "";
      }
      updateApplyState();
    });
    modelInput.addEventListener("input", updateApplyState);
    applyModel.addEventListener("click", () => {
      const value =
        modelSelect.value === "__custom__" ? modelInput.value.trim() : modelSelect.value;
      if (!value || applyModel.disabled) return;
      void resumeAll(value);
    });
    modelResume.append(modelSelect, modelInput, applyModel);
    toolbar.append(reload, all, modelResume);
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
    update(
      client: RendererModelClient | null,
      privacy: boolean,
      modelView?: ModelShortcutView | null,
      harnessId?: string,
    ) {
      if (disposed) return;
      if (client !== state.client) {
        state = session(client);
        epoch += 1;
      }
      if (privacy !== privateMode) {
        privateMode = privacy;
        epoch += 1;
      }
      if (modelView !== undefined) state.modelView = modelView;
      if (harnessId !== undefined) state.harnessId = harnessId;
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
