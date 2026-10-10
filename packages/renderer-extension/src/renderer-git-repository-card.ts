import type { GitWorkspaceStatus } from "@codexhost/shared-contracts";
import {
  gitIconButton,
  gitCommitMenu,
  gitMessagePlaceholder,
  gitRepositoryBranch,
  gitRepositoryIcon,
  renderGitChanges,
} from "./renderer-git-scm.js";

export interface GitRepositoryCardState {
  status: GitWorkspaceStatus | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  expanded: boolean;
  busy: boolean;
  initializing: boolean;
  action?: string | undefined;
  generating: boolean;
  message: string;
  canGenerate: boolean;
  canSync: boolean;
  canContinue: boolean;
  canAbort: boolean;
  tree: boolean;
  expansion: number;
}

// 保留每个仓库的输入框和节点，其他仓库回包时不打断输入或丢失焦点。
export function createGitRepositoryCard(
  document: Document,
  options: {
    repository: string;
    expandedDirectories: Set<string>;
    collapsedSections: Set<string>;
    onToggle(): void;
    onToggleChanges(): void;
    onRefresh(): void;
    onOpen(path: string, staged: boolean): void;
    onStage(path: string, stage: boolean): void;
    onStageAll(stage: boolean): void;
    onMessage(value: string): void;
    onGenerate(): void;
    onCommit(push: boolean, message: string): void;
    onPush(): void;
    onSync(): void;
    onContinue(): void;
    onAbort(): void;
    onInitialize(): void;
    initializeAction?: string | undefined;
  },
) {
  const repositoryName =
    options.repository.split(/[/\\]/u).filter(Boolean).at(-1) ?? options.repository;
  const root = document.createElement("section");
  root.className = "codexhost-git-repository-group";
  root.dataset.repository = options.repository;
  const bar = document.createElement("div");
  bar.className = "codexhost-git-repository-bar";
  const header = document.createElement("button");
  header.type = "button";
  header.className = "codexhost-git-repository-header";
  header.setAttribute("aria-label", `展开仓库 ${repositoryName}`);
  header.title = options.repository;
  const chevron = document.createElement("span");
  const icon = gitRepositoryIcon(document);
  const name = document.createElement("span");
  name.className = "codexhost-git-repository-name";
  name.textContent = repositoryName;
  const meta = document.createElement("span");
  meta.className = "codexhost-git-repository-meta";
  header.append(chevron, icon, name, meta);
  header.addEventListener("click", options.onToggle);
  const toolbar = document.createElement("div");
  toolbar.className = "codexhost-git-repository-toolbar";
  const action = (label: string, path: string, key: string, run: () => void) => {
    const button = gitIconButton(document, label, path);
    button.dataset.gitAction = key;
    button.addEventListener("click", run);
    return button;
  };
  const commit = action("提交", "M20 6 9 17l-5-5", "commit", () =>
    options.onCommit(false, message.value),
  );
  const sync = action(
    "拉取并同步",
    "M20 5v6h-6M4 19v-6h6M5.6 8a7 7 0 0 1 11.6-2L20 11M4 13l2.8 5A7 7 0 0 0 18.4 16",
    "sync",
    options.onSync,
  );
  const refresh = action(
    `刷新 ${repositoryName}`,
    "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
    "refresh",
    options.onRefresh,
  );
  toolbar.append(sync, commit, refresh);
  bar.append(header, toolbar);
  const body = document.createElement("div");
  body.className = "codexhost-git-repository-body";
  const notice = document.createElement("p");
  notice.className = "codexhost-git-repository-error";
  notice.setAttribute("role", "status");
  const commitBox = document.createElement("div");
  commitBox.className = "codexhost-git-repository-commit";
  const message = document.createElement("textarea");
  message.className = "codexhost-git-message";
  message.rows = 2;
  message.setAttribute("aria-label", `${repositoryName} 提交消息`);
  message.addEventListener("input", () => options.onMessage(message.value));
  message.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!commit.disabled) options.onCommit(false, message.value);
    }
  });
  const actions = document.createElement("div");
  actions.className = "codexhost-git-commit-actions";
  const commitPush = document.createElement("button");
  commitPush.type = "button";
  commitPush.textContent = "↑ 提交并推送";
  commitPush.setAttribute("aria-label", "提交并推送");
  commitPush.dataset.primary = "true";
  commitPush.dataset.gitAction = "commit-push";
  commitPush.addEventListener("click", () => options.onCommit(true, message.value));
  const push = action("推送", "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4", "push", options.onPush);
  const generate = action(
    "AI 生成",
    "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z",
    "generate",
    options.onGenerate,
  );
  const commitOnly = action("提交", "M20 6 9 17l-5-5", "commit", () =>
    options.onCommit(false, message.value),
  );
  const commitOptions = gitCommitMenu(document, actions, commitPush, [commitOnly, push]);
  generate.className = "codexhost-git-generate-inline";
  const inputRow = document.createElement("div");
  inputRow.className = "codexhost-git-message-row";
  inputRow.append(message, generate);
  commitBox.append(inputRow, actions);
  const changes = document.createElement("div");
  changes.className = "codexhost-git-repository-changes";
  const stageAll = action("全部暂存", "M12 5v14M5 12h14", "stage-all", () =>
    options.onStageAll(true),
  );
  const unstageAll = action("全部取出", "M5 12h14", "unstage-all", () => options.onStageAll(false));
  const operation = document.createElement("div");
  operation.className = "codexhost-git-conflict";
  const operationText = document.createElement("span");
  const continueMerge = action(
    "解决并继续",
    "M20 6 9 17l-5-5",
    "merge-continue",
    options.onContinue,
  );
  const abort = action("中止合并", "M6 6l12 12M6 18 18 6", "merge-abort", options.onAbort);
  operation.append(operationText, continueMerge, abort);
  const initialize = document.createElement("button");
  initialize.type = "button";
  initialize.textContent = "初始化子模块";
  if (options.initializeAction) initialize.dataset.gitAction = options.initializeAction;
  initialize.addEventListener("click", options.onInitialize);
  body.append(commitBox, notice, initialize, operation, changes);
  root.append(bar, body);
  let previous: GitRepositoryCardState | null = null;
  return {
    root,
    update(state: GitRepositoryCardState) {
      header.setAttribute("aria-expanded", String(state.expanded));
      chevron.textContent = state.expanded ? "▾" : "▸";
      body.hidden = !state.expanded;
      if (!state.expanded) commitOptions.open = false;
      meta.textContent = state.loading
        ? "读取中…"
        : state.error
          ? "读取失败"
          : gitRepositoryBranch(state.status) || (state.initialized ? "" : "未初始化");
      meta.title = state.status
        ? `${state.status.upstream ?? "无上游"} · ${state.status.ahead}↑ ${state.status.behind}↓`
        : (state.error ?? "");
      message.placeholder = gitMessagePlaceholder(state.status);
      if (message.value !== state.message) message.value = state.message;
      notice.hidden = !state.error && Boolean(state.status);
      notice.textContent =
        state.error ??
        (state.loading
          ? "正在读取仓库…"
          : state.initialized
            ? "尚未读取仓库状态。"
            : "子模块尚未初始化。");
      initialize.hidden = state.initialized;
      initialize.disabled = state.busy || state.initializing;
      commitBox.hidden = !state.status;
      const hasChanges = Boolean(state.status?.changes.some((change) => !change.conflicted));
      commit.disabled = state.busy || !hasChanges || Boolean(state.status?.conflicts.length);
      commitOnly.disabled = commit.disabled;
      commitPush.disabled = commit.disabled;
      sync.disabled = state.busy || !state.status || !state.canSync;
      refresh.disabled = state.busy || state.loading || !state.initialized;
      push.disabled = state.busy || !state.status;
      generate.disabled = state.busy || state.generating || !hasChanges || !state.canGenerate;
      stageAll.disabled =
        state.busy ||
        !state.status?.changes.some(
          (change) => !change.conflicted && (!change.staged || change.unstaged),
        );
      unstageAll.disabled = state.busy || !state.status?.changes.some((change) => change.staged);
      operation.hidden = !state.status?.operation;
      operationText.textContent = `${state.status?.operation === "rebase" ? "变基" : "合并"}进行中 · ${state.status?.conflicts.length ?? 0} 个冲突`;
      continueMerge.disabled = state.busy || !state.canContinue;
      abort.disabled = state.busy || !state.canAbort;
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-git-action]")) {
        button.setAttribute("aria-busy", String(button.dataset.gitAction === state.action));
      }
      generate.setAttribute("aria-busy", String(state.generating));
      initialize.setAttribute("aria-busy", String(state.initializing));
      if (
        previous?.status !== state.status ||
        previous?.tree !== state.tree ||
        previous?.expansion !== state.expansion
      ) {
        if (state.status)
          renderGitChanges(document, {
            root: changes,
            status: state.status,
            repository: options.repository,
            tree: state.tree,
            expandedDirectories: options.expandedDirectories,
            collapsedSections: options.collapsedSections,
            stageAll,
            unstageAll,
            isBusy: () => previous?.busy ?? state.busy,
            onToggle: options.onToggleChanges,
            onOpen: options.onOpen,
            onStage: options.onStage,
          });
        else changes.replaceChildren();
      }
      for (const button of changes.querySelectorAll<HTMLButtonElement>(
        ".codexhost-git-change-action",
      )) {
        button.disabled = state.busy;
      }
      changes.hidden = !state.status;
      previous = state;
    },
  };
}
