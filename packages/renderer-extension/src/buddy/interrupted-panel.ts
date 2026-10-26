import createElement from "lucide/dist/esm/createElement.mjs";
import ChevronDown from "lucide/dist/esm/icons/chevron-down.mjs";
import ChevronRight from "lucide/dist/esm/icons/chevron-right.mjs";
import Play from "lucide/dist/esm/icons/play.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import type { RendererModelClient } from "../renderer-model-client.js";
import type { ModelShortcutView } from "../renderer-model-shortcuts.js";
import { MODEL_FAVORITES_CHANGED, readModelFavorites } from "../renderer-model-favorites.js";
import { createRecoveryHeader } from "./recovery-header.js";
import type { InterruptedQueue, InterruptedQueueEntry } from "./interrupted-queue.js";

type InterruptedThread = InterruptedQueueEntry;
const messages = {
  "zh-CN": {
    heading: "中断队列",
    empty: "中断队列为空。",
    loading: "正在补录历史中断…",
    refresh: "补录历史中断",
    collapse: "收起中断队列",
    expand: "展开中断队列",
    resume: "恢复",
    resuming: "正在恢复…",
    resumeAll: "一键恢复所有",
    resumeAllHint: "按顺序恢复当前连接下列表中的所有中断会话。",
    resumeWithModel: "以某模型 ID 继续",
    resumeWithModelHint: "复用当前模型选择；指定模型 ID 可避免自动选模导致再次中断。",
    resumeFailed: "恢复失败",
    view: "查看会话",
    opening: "正在打开…",
    viewHint: "在当前窗口打开这条会话的历史。",
    viewFailed: "打开会话失败",
    unavailable: "当前连接不支持会话恢复。",
    waiting: "连接状态尚未确认，暂时无法恢复会话。",
    unreadable: "条会话历史暂时无法读取",
    failed: "失败",
    interrupted: "已中断",
    cancelled: "已取消",
  },
  en: {
    heading: "Interrupted queue",
    empty: "The interruption queue is empty.",
    loading: "Importing interrupted history…",
    refresh: "Import interrupted history",
    collapse: "Collapse interrupted queue",
    expand: "Expand interrupted queue",
    resume: "Resume",
    resuming: "Resuming…",
    resumeAll: "Resume all",
    resumeAllHint: "Resume all interrupted conversations listed on this connection, one by one.",
    resumeWithModel: "Resume with model ID",
    resumeWithModelHint:
      "Reuse current model picker; specifying a model ID avoids repeated interruptions from auto selection.",
    resumeFailed: "Resume failed",
    view: "Open",
    opening: "Opening…",
    viewHint: "Open this conversation in the current window.",
    viewFailed: "Could not open conversation",
    unavailable: "Conversation recovery is unavailable on this connection.",
    waiting: "Waiting for connection status before allowing conversation recovery.",
    unreadable: "conversation histories could not be read",
    failed: "Failed",
    interrupted: "Interrupted",
    cancelled: "Cancelled",
  },
};

const keyFor = (thread: InterruptedThread) => JSON.stringify([thread.threadId, thread.turnId]);
const errorMessage = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

function session(client: RendererModelClient | null, hostId: string | null = null) {
  return {
    client,
    hostId,
    threads: [] as InterruptedThread[],
    pending: new Set<string>(),
    viewing: new Set<string>(),
    failures: new Map<string, string>(),
    loading: false,
    batch: false,
    total: null as number | null,
    completed: 0,
    succeeded: 0,
    unreadable: 0,
    error: "",
    modelView: null as ModelShortcutView | null,
    harnessId: "",
  };
}

export function createInterruptedPanel(
  getLocale: () => "zh-CN" | "en",
  queue: InterruptedQueue,
  onResumed?: () => void,
  openThread?: (threadId: string, options: { hostId: string }) => Promise<void>,
) {
  const chinese = () => getLocale() === "zh-CN";
  const root = document.createElement("div");
  root.className = "buddy-recovery-panel";
  let state = session(null);
  let disposed = false;
  let epoch = 0;
  let fingerprint = "";
  // 标题行可折叠：默认展开，收起后隐藏模型 ID 行和列表。
  let collapsed = false;
  let focusToggle = false;
  let selectedModelId = "";
  let customModelId = "";
  const header = createRecoveryHeader(getLocale, () => resumeAll());
  const syncQueue = () => {
    state.threads = state.hostId ? queue.list(state.hostId) : [];
    render();
  };
  const stopQueue = queue.subscribe(syncQueue);
  const favoritesChanged = (): void => render();
  window.addEventListener(MODEL_FAVORITES_CHANGED, favoritesChanged);
  window.addEventListener("storage", favoritesChanged);

  const current = (target: typeof state) => !disposed && state === target;

  // 补录历史只由用户主动点击，不由连接绑定、聚焦或布局更新触发。
  async function refresh(): Promise<boolean> {
    const target = state;
    if (
      !current(target) ||
      !target.hostId ||
      !target.client?.buddyInterrupted ||
      target.loading ||
      target.batch
    ) {
      return false;
    }
    target.loading = true;
    target.error = "";
    render();
    try {
      const unreadable = await queue.importHistory(target.hostId);
      if (!current(target)) return false;
      target.threads = queue.list(target.hostId);
      target.unreadable = unreadable;
      return true;
    } catch (failure) {
      if (current(target)) {
        target.error = errorMessage(failure);
      }
      return false;
    } finally {
      target.loading = false;
      if (current(target)) render();
    }
  }

  async function resume(
    target: typeof state,
    thread: InterruptedThread,
    modelId?: string,
    action: "resume" | "archive" = "resume",
  ): Promise<void> {
    const key = keyFor(thread);
    if (
      !current(target) ||
      !target.client ||
      (action === "resume" && !target.client.buddyContinue) ||
      target.pending.has(key) ||
      queue.isPending(thread)
    ) {
      return;
    }
    target.pending.add(key);
    target.failures.delete(key);
    render();
    try {
      if (action === "archive") {
        await queue.archive(thread);
      } else {
        await queue.resume(thread, modelId);
      }
      target.threads = target.hostId ? queue.list(target.hostId) : [];
      if (current(target) && !target.batch) onResumed?.();
    } catch (failure) {
      target.failures.set(
        key,
        `${action === "archive" ? (chinese() ? "归档失败" : "Archive failed") : messages[getLocale()].resumeFailed}: ${errorMessage(failure)}`,
      );
    } finally {
      target.pending.delete(key);
      if (current(target)) render();
    }
  }

  // 查看会话只做导航：不改动原生历史、不提交回合，也不把记录移出队列。
  async function open(target: typeof state, thread: InterruptedThread): Promise<void> {
    const key = keyFor(thread);
    if (
      !current(target) ||
      !openThread ||
      target.viewing.has(key) ||
      target.pending.has(key) ||
      queue.isPending(thread)
    ) {
      return;
    }
    target.viewing.add(key);
    target.failures.delete(key);
    render();
    try {
      await openThread(thread.threadId, { hostId: thread.hostId });
    } catch (failure) {
      if (current(target))
        target.failures.set(key, `${messages[getLocale()].viewFailed}: ${errorMessage(failure)}`);
    } finally {
      target.viewing.delete(key);
      if (current(target)) render();
    }
  }

  async function resumeAll(modelId?: string): Promise<void> {
    const target = state;
    if (
      !current(target) ||
      target.batch ||
      target.loading ||
      target.pending.size > 0 ||
      target.threads.some(queue.isPending)
    )
      return;
    const candidates = [...target.threads];
    const startedAtEpoch = epoch;
    target.batch = true;
    target.total = candidates.length;
    target.completed = 0;
    target.succeeded = 0;
    render();
    try {
      // 只处理点击时的列表；逐条提交，切换连接或卸载后停止剩余请求。
      for (const thread of candidates) {
        if (!current(target) || epoch !== startedAtEpoch) break;
        await resume(target, thread, modelId);
        target.completed += 1;
        if (!target.failures.has(keyFor(thread))) target.succeeded += 1;
        if (current(target)) render();
      }
    } finally {
      target.batch = false;
      if (current(target)) {
        render();
        if (target.succeeded > 0) onResumed?.();
      }
    }
  }

  function render(): void {
    const m = messages[getLocale()];
    header.update({
      available: Boolean(state.hostId && state.client?.buddyContinue),
      busy:
        state.loading ||
        state.batch ||
        state.pending.size > 0 ||
        state.threads.some(queue.isPending),
      loading: state.loading,
      batch: state.batch,
      count: state.threads.length,
      total: state.total,
      completed: state.completed,
      succeeded: state.succeeded,
      unreadable: state.unreadable,
      error:
        state.error ||
        [...state.failures.values()].join("; ") ||
        (state.hostId ? queue.problem(state.hostId) : ""),
    });
    const favoriteIds = state.harnessId ? [...readModelFavorites(state.harnessId)] : [];
    const signature = JSON.stringify([
      epoch,
      getLocale(),
      Boolean(state.client?.buddyContinue),
      Boolean(state.client?.buddyInterrupted),
      state.threads,
      state.loading,
      state.batch,
      state.error,
      state.unreadable,
      state.hostId ? queue.problem(state.hostId) : "",
      state.threads.map((entry) => queue.isPending(entry)),
      state.modelView,
      state.harnessId,
      favoriteIds,
      [...state.pending],
      [...state.viewing],
      [...state.failures],
      collapsed,
    ]);
    if (fingerprint === signature) return;
    fingerprint = signature;
    const wrapper = document.createElement("div");
    wrapper.className = "buddy-interrupted";
    const toolbar = document.createElement("div");
    toolbar.className = "buddy-interrupted-toolbar";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.dataset.buddyInterruptedToggle = "";
    toggle.className = "buddy-interrupted-heading";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = collapsed ? m.expand : m.collapse;
    toggle.setAttribute("aria-label", collapsed ? m.expand : m.collapse);
    toggle.append(
      createElement(collapsed ? ChevronRight : ChevronDown, {
        width: 14,
        height: 14,
        "aria-hidden": "true",
      }),
    );
    const heading = document.createElement("b");
    heading.textContent = m.heading;
    toggle.append(heading);
    if (collapsed && state.threads.length > 0) {
      const count = document.createElement("span");
      count.className = "buddy-interrupted-count";
      count.textContent = String(state.threads.length);
      toggle.append(count);
    }
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      focusToggle = true;
      render();
    });
    toolbar.append(toggle);
    wrapper.append(toolbar);
    const note = (text: string, failure = false, parent: HTMLElement = wrapper) => {
      const element = document.createElement("div");
      element.className = `buddy-interrupted-note${failure ? " buddy-interrupted-error" : ""}`;
      element.setAttribute("role", "status");
      element.textContent = text;
      parent.append(element);
    };
    // 统一提交渲染结果，用户点击标题行后把焦点交回新的折叠按钮。
    const finish = () => {
      root.replaceChildren(wrapper);
      if (focusToggle) {
        focusToggle = false;
        toggle.focus();
      }
    };
    if (!state.hostId || !state.client) {
      note(state.client ? m.unavailable : m.waiting);
      finish();
      return;
    }
    if (state.loading) note(m.loading);
    if (state.error) note(state.error, true);
    const queueError = state.hostId ? queue.problem(state.hostId) : "";
    if (queueError) note(queueError, true);
    if (state.unreadable > 0) note(`${state.unreadable} ${m.unreadable}`);
    if (!collapsed && !state.loading && state.threads.length === 0 && !state.error) note(m.empty);
    const reload = document.createElement("button");
    reload.type = "button";
    reload.title = m.refresh;
    reload.setAttribute("aria-label", m.refresh);
    reload.append(createElement(RefreshCw, { width: 14, height: 14, "aria-hidden": "true" }));
    reload.disabled = state.loading || state.batch || !state.client.buddyInterrupted;
    reload.addEventListener("click", () => {
      void refresh();
    });
    const all = document.createElement("button");
    all.type = "button";
    all.dataset.buddyResumeAll = "";
    all.title = m.resumeAllHint;
    all.append(createElement(Play, { width: 14, height: 14, "aria-hidden": "true" }));
    all.append(`${state.batch ? m.resuming : m.resumeAll} (${state.threads.length})`);
    all.disabled =
      !state.client.buddyContinue ||
      state.loading ||
      state.batch ||
      state.pending.size > 0 ||
      state.threads.some(queue.isPending) ||
      state.threads.length === 0;
    all.addEventListener("click", () => {
      void resumeAll();
    });
    toolbar.append(reload, all);
    // 收起后只保留标题行、刷新、批量入口和已知提示；模型 ID 行和列表留给展开状态。
    if (collapsed) {
      finish();
      return;
    }
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
    const favorites = new Set(favoriteIds);
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
    const candidateIds = new Set(candidates.map(({ id }) => id));
    modelSelect.value = candidateIds.has(selectedModelId)
      ? selectedModelId
      : customModelId
        ? "__custom__"
        : "";
    modelSelect.disabled =
      state.loading ||
      state.batch ||
      state.pending.size > 0 ||
      state.threads.some(queue.isPending) ||
      state.threads.length === 0;
    const modelInput = document.createElement("input");
    modelInput.type = "search";
    modelInput.className = "buddy-interrupted-model-input";
    modelInput.placeholder = chinese() ? "粘贴或输入模型 ID" : "Paste or type a model ID";
    modelInput.setAttribute("aria-label", m.resumeWithModel);
    modelInput.hidden = modelSelect.value !== "__custom__";
    modelInput.value = customModelId;
    modelInput.disabled = modelSelect.disabled;
    const applyModel = document.createElement("button");
    applyModel.type = "button";
    applyModel.dataset.buddyResumeWithModel = "";
    applyModel.textContent = chinese() ? "应用" : "Apply";
    applyModel.disabled = true;
    const selectedModel = (): string =>
      modelSelect.value === "__custom__" ? modelInput.value.trim() : modelSelect.value.trim();
    const updateApplyState = () => {
      applyModel.disabled = !selectedModel() || modelSelect.disabled;
    };
    modelSelect.addEventListener("change", () => {
      selectedModelId = modelSelect.value === "__custom__" ? "" : modelSelect.value;
      if (modelSelect.value === "__custom__") {
        modelInput.hidden = false;
        modelInput.focus();
      } else {
        modelInput.hidden = true;
        customModelId = "";
        modelInput.value = "";
      }
      updateApplyState();
    });
    modelInput.addEventListener("input", () => {
      customModelId = modelInput.value.trim();
      updateApplyState();
    });
    applyModel.addEventListener("click", () => {
      const value = selectedModel();
      if (!value || applyModel.disabled) return;
      void resumeAll(value);
    });
    modelResume.append(modelSelect, modelInput, applyModel);
    toolbar.append(modelResume);
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
      if (failure) note(failure, true, copy);
      const target = state;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent =
        state.pending.has(key) || queue.isPending(thread)
          ? chinese()
            ? "正在处理…"
            : "Processing…"
          : m.resume;
      button.disabled =
        !state.client.buddyContinue ||
        state.batch ||
        state.pending.has(key) ||
        queue.isPending(thread);
      button.addEventListener("click", () => {
        void resume(target, thread, selectedModel() || undefined);
      });
      const archive = document.createElement("button");
      archive.type = "button";
      archive.textContent = chinese() ? "归档" : "Archive";
      archive.title = chinese()
        ? "归档此会话并移出中断队列"
        : "Archive this chat and remove it from the queue";
      archive.disabled = state.batch || state.pending.has(key) || queue.isPending(thread);
      archive.dataset.buddyArchive = "";
      archive.addEventListener("click", () => {
        void resume(target, thread, undefined, "archive");
      });
      const actions = document.createElement("div");
      actions.className = "buddy-interrupted-actions";
      if (openThread) {
        const view = document.createElement("button");
        view.type = "button";
        view.dataset.buddyOpen = "";
        view.textContent = state.viewing.has(key) ? m.opening : m.view;
        view.title = m.viewHint;
        view.disabled = state.viewing.has(key) || state.pending.has(key) || queue.isPending(thread);
        view.addEventListener("click", () => {
          void open(target, thread);
        });
        actions.append(view);
      }
      actions.append(button, archive);
      item.append(copy, actions);
      list.append(item);
    }
    wrapper.append(list);
    finish();
  }

  return {
    root,
    repositionHeader: header.reposition,
    update(
      client: RendererModelClient | null,
      modelView?: ModelShortcutView | null,
      harnessId?: string,
      hostId: string | null = null,
    ) {
      if (disposed) return;
      if (client !== state.client || hostId !== state.hostId) {
        state = session(client, hostId);
        epoch += 1;
      }
      if (modelView !== undefined) state.modelView = modelView;
      if (harnessId !== undefined) state.harnessId = harnessId;
      syncQueue();
    },
    refresh,
    dispose() {
      disposed = true;
      window.removeEventListener(MODEL_FAVORITES_CHANGED, favoritesChanged);
      window.removeEventListener("storage", favoritesChanged);
      stopQueue();
      header.dispose();
      root.remove();
    },
  };
}
