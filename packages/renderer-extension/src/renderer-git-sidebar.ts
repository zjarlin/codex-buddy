import type {
  GitCommitParams,
  GitCommitDetail,
  GitCommitDetailParams,
  GitCommitDiffParams,
  GitDiffParams,
  GitDiffResult,
  GitLogParams,
  GitLogResult,
  GitMessageGenerateParams,
  GitMessageModel,
  GitStageParams,
  GitSubmoduleUpdateParams,
  GitWorkspaceParams,
  GitWorkspaceStatus,
  HostThreadId,
} from "@codexhost/shared-contracts";

export interface RendererGitClient {
  inspectGitStatus(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  inspectGitDiff(input: GitDiffParams): Promise<GitDiffResult>;
  stageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus>;
  unstageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus>;
  commitGit(input: GitCommitParams): Promise<{
    commit: string | null;
    pushed: boolean;
    output: string;
    status: GitWorkspaceStatus;
  }>;
  pushGit(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  listGitMessageModels(input: GitWorkspaceParams): Promise<{
    models: GitMessageModel[];
    defaultModel: string | null;
  }>;
  generateGitMessage(input: GitMessageGenerateParams): Promise<{ message: string; model: string }>;
  listGitSubmodules?(
    input: GitWorkspaceParams,
  ): Promise<{ submodules: { path: string; status: string }[] }>;
  updateGitSubmodule?(input: GitSubmoduleUpdateParams): Promise<GitWorkspaceStatus>;
  inspectGitLog?(input: GitLogParams): Promise<GitLogResult>;
  inspectGitCommit?(input: GitCommitDetailParams): Promise<GitCommitDetail>;
  inspectGitCommitDiff?(input: GitCommitDiffParams): Promise<GitDiffResult>;
}

export interface RendererGitContext {
  threadId: HostThreadId | null;
  client: RendererGitClient | null;
}

export const GIT_SIDEBAR_ROOT_ATTRIBUTE = "data-codexhost-git-sidebar";
export const GIT_SIDEBAR_RAIL_ATTRIBUTE = "data-codexhost-git-sidebar-rail";
export const GIT_SIDEBAR_PANEL_ATTRIBUTE = "data-codexhost-git-sidebar-panel";
export const GIT_SIDEBAR_PROJECTS_ATTRIBUTE = "data-codexhost-git-sidebar-projects";
export const GIT_SIDEBAR_COMMITS_ATTRIBUTE = "data-codexhost-git-sidebar-commits";
export const GIT_SIDEBAR_FILES_ATTRIBUTE = "data-codexhost-git-sidebar-files";
export const GIT_SIDEBAR_LOG_ATTRIBUTE = "data-codexhost-git-sidebar-log";
export const GIT_SIDEBAR_TERMINAL_ATTRIBUTE = "data-codexhost-git-sidebar-terminal";
export const GIT_SIDEBAR_STAGE_ATTRIBUTE = "data-codexhost-git-sidebar-stage";
export const GIT_SIDEBAR_UNSTAGE_ATTRIBUTE = "data-codexhost-git-sidebar-unstage";
export const GIT_SIDEBAR_STAGE_ALL_ATTRIBUTE = "data-codexhost-git-sidebar-stage-all";
export const GIT_SIDEBAR_MESSAGE_ATTRIBUTE = "data-codexhost-git-sidebar-message";
export const GIT_SIDEBAR_MODEL_ATTRIBUTE = "data-codexhost-git-sidebar-model";
export const GIT_SIDEBAR_GENERATE_ATTRIBUTE = "data-codexhost-git-sidebar-generate";
export const GIT_SIDEBAR_COMMIT_ATTRIBUTE = "data-codexhost-git-sidebar-commit";
export const GIT_SIDEBAR_COMMIT_PUSH_ATTRIBUTE = "data-codexhost-git-sidebar-commit-push";
export const GIT_SIDEBAR_PUSH_ATTRIBUTE = "data-codexhost-git-sidebar-push";

const SIDEBAR_THREAD_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
const APP_SIDEBAR_SELECTOR = "#app-shell-sidebar";
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_SIDEBAR_HEIGHT = 220;
const OFFICIAL_PANEL_LABELS = {
  files: [/^显示\/隐藏侧边面板$/u, /^show or hide side panel$/iu, /^toggle side panel$/iu],
  terminal: [/^切换底部面板显示$/u, /^show or hide bottom panel$/iu, /^toggle bottom panel$/iu],
} as const;

type OfficialPanel = keyof typeof OFFICIAL_PANEL_LABELS;

interface SidebarAnchor {
  container: HTMLElement;
  content: HTMLElement;
  containerStyle: { position: string };
  contentStyle: { height: string; minHeight: string; paddingLeft: string };
}

function isVisible(element: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function sidebarAnchor(document: Document): SidebarAnchor | null {
  const appSidebar = document.querySelector<HTMLElement>(APP_SIDEBAR_SELECTOR);
  if (appSidebar) {
    const content = [...appSidebar.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute(GIT_SIDEBAR_ROOT_ATTRIBUTE),
    );
    if (content) return createSidebarAnchor(appSidebar, content);
  }

  const row = [...document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].find(
    isVisible,
  );
  if (!row) return null;
  let candidate: HTMLElement | null = row.parentElement;
  while (candidate && candidate !== document.body) {
    const bounds = candidate.getBoundingClientRect();
    if (
      bounds.width >= MIN_SIDEBAR_WIDTH &&
      bounds.width <= MAX_SIDEBAR_WIDTH &&
      bounds.height >= MIN_SIDEBAR_HEIGHT &&
      isVisible(candidate)
    ) {
      const content = row.parentElement;
      if (!content) return null;
      return createSidebarAnchor(candidate, content);
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function createSidebarAnchor(container: HTMLElement, content: HTMLElement): SidebarAnchor {
  return {
    container,
    content,
    containerStyle: {
      position: container.style.position,
    },
    contentStyle: {
      height: content.style.height,
      minHeight: content.style.minHeight,
      paddingLeft: content.style.paddingLeft,
    },
  };
}

function restoreSidebarAnchor(anchor: SidebarAnchor): void {
  anchor.container.style.position = anchor.containerStyle.position;
  const { contentStyle: content } = anchor;
  anchor.content.style.height = content.height;
  anchor.content.style.minHeight = content.minHeight;
  anchor.content.style.paddingLeft = content.paddingLeft;
}

function iconButton(document: Document, label: string, path: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  button.append(svg);
  return button;
}

function officialPanelButton(document: Document, panel: OfficialPanel): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find((button) => {
      const label = button.getAttribute("aria-label")?.trim() ?? "";
      return OFFICIAL_PANEL_LABELS[panel].some((pattern) => pattern.test(label));
    }) ?? null
  );
}

export interface RendererGitSidebar {
  refresh(): void;
  dispose(): void;
}

export function installRendererGitSidebar(options: {
  getContext(): RendererGitContext;
  ownerDocument?: Document;
  signal?: AbortSignal;
}): RendererGitSidebar {
  const document = options.ownerDocument ?? window.document;
  const listenerOptions: AddEventListenerOptions | undefined = options.signal
    ? { signal: options.signal }
    : undefined;
  const root = document.createElement("div");
  root.setAttribute(GIT_SIDEBAR_ROOT_ATTRIBUTE, "v1");
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { display:block; position:absolute; z-index:4; inset:0; min-width:0; min-height:0; pointer-events:none; }
    .codexhost-git-shell { display:contents; color:var(--text-primary,inherit); }
    .codexhost-git-rail { position:absolute; z-index:2; inset:0 auto 0 0; display:flex; width:38px; flex-direction:column; align-items:center; gap:6px; padding:8px 3px; background:var(--surface-primary,transparent); border-right:1px solid var(--border-default, color-mix(in srgb,currentColor 14%,transparent)); pointer-events:auto; }
    .codexhost-git-rail button { display:grid; place-items:center; width:28px; height:28px; padding:0; color:inherit; background:transparent; border:0; border-radius:6px; cursor:pointer; opacity:.68; }
    .codexhost-git-rail button:hover, .codexhost-git-rail button[aria-current="page"] { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-panel { position:absolute; inset:0 0 0 38px; display:flex; min-width:0; flex-direction:column; overflow:hidden; background:var(--surface-primary,inherit); pointer-events:auto; }
    .codexhost-git-panel[hidden], .codexhost-git-projects[hidden], .codexhost-git-workspace[hidden], .codexhost-git-commit-box[hidden], .codexhost-git-log[hidden] { display:none; }
    .codexhost-git-head { display:flex; align-items:center; min-height:38px; gap:4px; padding:5px 8px; font-size:12px; font-weight:600; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-git-head strong { flex:1; padding-left:4px; }
    .codexhost-git-head button { min-height:28px; padding:3px 8px; color:inherit; background:transparent; border:0; border-radius:5px; cursor:pointer; }
    .codexhost-git-head button:hover, .codexhost-git-head button[aria-selected="true"] { background:color-mix(in srgb,currentColor 10%,transparent); }
    .codexhost-git-head button:disabled { cursor:default; opacity:.4; }
    .codexhost-git-branch { display:flex; gap:8px; padding:7px 10px; color:inherit; font-size:11px; opacity:.7; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-workspace { display:flex; min-height:0; flex:1; flex-direction:column; }
    .codexhost-git-section-title { display:flex; align-items:center; min-height:30px; gap:6px; padding:4px 8px; font-size:11px; font-weight:600; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 8%,transparent)); }
    .codexhost-git-section-title span:last-child { margin-left:auto; opacity:.55; }
    .codexhost-git-list { display:flex; min-height:0; max-height:34%; overflow:auto; flex-direction:column; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 9%,transparent)); }
    .codexhost-git-list--staged { max-height:22%; }
    .codexhost-git-change { display:grid; grid-template-columns:minmax(0,1fr) auto 22px; align-items:center; gap:5px; min-height:30px; padding:4px 6px 4px 10px; color:inherit; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 7%,transparent)); cursor:pointer; }
    .codexhost-git-change:hover, .codexhost-git-change[aria-selected="true"] { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-change span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-git-status { min-width:14px; font-size:10px; font-weight:700; text-align:right; opacity:.72; }
    .codexhost-git-change-action { display:grid; place-items:center; width:22px; height:22px; padding:0; color:inherit; background:transparent; border:0; border-radius:4px; cursor:pointer; opacity:.62; }
    .codexhost-git-change-action:hover:not(:disabled) { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-change-action:disabled { opacity:.25; }
    .codexhost-git-empty { margin:0; padding:14px 10px; font-size:11px; opacity:.58; }
    .codexhost-git-submodule { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:6px 8px 6px 10px; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); font-size:11px; }
    .codexhost-git-submodule button { padding:2px 6px; color:inherit; background:transparent; border:1px solid currentColor; border-radius:4px; cursor:pointer; }
    .codexhost-git-diff { min-height:80px; max-height:28%; overflow:auto; margin:0; padding:8px 10px; white-space:pre; font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-commit-box { display:grid; flex:none; gap:6px; padding:8px 9px; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-git-message { box-sizing:border-box; width:100%; min-height:64px; max-height:150px; padding:7px 8px; resize:vertical; color:inherit; background:var(--surface-secondary,transparent); border:1px solid var(--border-default, color-mix(in srgb,currentColor 15%,transparent)); border-radius:6px; font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .codexhost-git-commit-model { display:flex; min-width:0; gap:5px; }
    .codexhost-git-commit-model select { min-width:0; flex:1; padding:4px 6px; color:inherit; background:var(--surface-primary,transparent); border:1px solid var(--border-default, color-mix(in srgb,currentColor 15%,transparent)); border-radius:5px; font-size:10px; }
    .codexhost-git-commit-model button, .codexhost-git-commit-actions button { min-height:28px; padding:4px 7px; color:inherit; background:transparent; border:1px solid var(--border-default, color-mix(in srgb,currentColor 15%,transparent)); border-radius:5px; cursor:pointer; font-size:10px; }
    .codexhost-git-commit-model button:hover:not(:disabled), .codexhost-git-commit-actions button:hover:not(:disabled) { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-commit-actions { display:flex; gap:5px; }
    .codexhost-git-commit-actions button { flex:1; white-space:nowrap; }
    .codexhost-git-commit-actions button:last-child { flex:0 0 auto; }
    .codexhost-git-commit-actions button[data-primary="true"] { color:var(--surface-primary,white); background:var(--text-primary,#111); border-color:transparent; }
    .codexhost-git-notice { min-height:0; margin:0; color:var(--text-link,inherit); font-size:10px; line-height:1.4; overflow-wrap:anywhere; }
    .codexhost-git-log { display:grid; grid-template-columns:minmax(120px,.28fr) minmax(210px,.72fr); min-height:0; flex:1; }
    .codexhost-git-log-refs,.codexhost-git-log-commits { min-width:0; overflow:auto; border-right:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-log-detail { grid-column:1/-1; min-height:160px; max-height:48%; overflow:auto; padding:10px; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-log-ref,.codexhost-git-log-commit { display:grid; width:100%; min-height:34px; padding:5px 8px; color:inherit; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 7%,transparent)); cursor:pointer; }
    .codexhost-git-log-ref:hover,.codexhost-git-log-commit:hover,.codexhost-git-log-commit[aria-selected="true"] { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-log-subject { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
    .codexhost-git-log-meta,.codexhost-git-log-detail-meta { overflow:hidden; color:inherit; font-size:10px; opacity:.55; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-git-log-detail h3 { margin:0 0 5px; font-size:12px; }
    .codexhost-git-log-body { white-space:pre-wrap; font-size:11px; line-height:1.55; }
    .codexhost-git-log-file { display:block; width:100%; padding:4px 0; color:inherit; text-align:left; background:transparent; border:0; cursor:pointer; font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .codexhost-git-log-file:hover { color:var(--text-link,inherit); text-decoration:underline; }
    @media (min-width: 720px) { .codexhost-git-log { grid-template-columns:minmax(130px,.2fr) minmax(260px,.8fr) minmax(320px,1.2fr); } .codexhost-git-log-detail { grid-column:auto; max-height:none; border-top:0; border-left:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); } }
  `;
  const shell = document.createElement("div");
  shell.className = "codexhost-git-shell";
  const rail = document.createElement("nav");
  rail.className = "codexhost-git-rail";
  rail.setAttribute(GIT_SIDEBAR_RAIL_ATTRIBUTE, "v1");
  const projects = iconButton(document, "项目", "M3 6.5h6l1.5 2H21v9.5H3z");
  projects.setAttribute(GIT_SIDEBAR_PROJECTS_ATTRIBUTE, "v1");
  projects.setAttribute("aria-current", "page");
  const commits = iconButton(
    document,
    "提交",
    "M5 12h14M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z",
  );
  commits.setAttribute(GIT_SIDEBAR_COMMITS_ATTRIBUTE, "v1");
  const files = iconButton(document, "文件浏览器", "M4 5.5h6l1.5 2H20v11H4zM4 10h16");
  files.setAttribute(GIT_SIDEBAR_FILES_ATTRIBUTE, "v1");
  const logs = iconButton(document, "日志", "M12 7v5l3 2M5.6 5.6A9 9 0 1 1 3 12M3 4v4h4");
  logs.setAttribute(GIT_SIDEBAR_LOG_ATTRIBUTE, "v1");
  const terminal = iconButton(document, "终端", "M5 6l5 5-5 5M12 17h7");
  terminal.setAttribute(GIT_SIDEBAR_TERMINAL_ATTRIBUTE, "v1");
  rail.append(projects, files, commits, logs, terminal);
  const panel = document.createElement("div");
  panel.className = "codexhost-git-panel";
  panel.setAttribute(GIT_SIDEBAR_PANEL_ATTRIBUTE, "v1");
  panel.hidden = true;
  const head = document.createElement("div");
  head.className = "codexhost-git-head";
  const headText = document.createElement("strong");
  headText.textContent = "提交";
  const refresh = iconButton(document, "刷新", "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6");
  head.append(headText, refresh);
  const branch = document.createElement("div");
  branch.className = "codexhost-git-branch";
  const workspace = document.createElement("div");
  workspace.className = "codexhost-git-workspace";
  const changesTitle = document.createElement("div");
  changesTitle.className = "codexhost-git-section-title";
  const changesLabel = document.createElement("span");
  changesLabel.textContent = "变更";
  const changesCount = document.createElement("span");
  changesTitle.append(changesLabel, changesCount);
  const list = document.createElement("div");
  list.className = "codexhost-git-list";
  const stagedTitle = document.createElement("div");
  stagedTitle.className = "codexhost-git-section-title";
  const stagedLabel = document.createElement("span");
  stagedLabel.textContent = "已暂存";
  const stagedCount = document.createElement("span");
  stagedTitle.append(stagedLabel, stagedCount);
  const stagedList = document.createElement("div");
  stagedList.className = "codexhost-git-list codexhost-git-list--staged";
  const submoduleList = document.createElement("div");
  submoduleList.className = "codexhost-git-submodules";
  const diff = document.createElement("pre");
  diff.className = "codexhost-git-diff";
  diff.textContent = "选择文件查看差异";
  const commitBox = document.createElement("div");
  commitBox.className = "codexhost-git-commit-box";
  const message = document.createElement("textarea");
  message.className = "codexhost-git-message";
  message.rows = 3;
  message.placeholder = "填写提交消息；AI 生成后仍可编辑。";
  message.setAttribute(GIT_SIDEBAR_MESSAGE_ATTRIBUTE, "v1");
  message.setAttribute("aria-label", "提交消息");
  const modelRow = document.createElement("div");
  modelRow.className = "codexhost-git-commit-model";
  const model = document.createElement("select");
  model.setAttribute(GIT_SIDEBAR_MODEL_ATTRIBUTE, "v1");
  model.setAttribute("aria-label", "生成提交消息模型");
  const generate = document.createElement("button");
  generate.type = "button";
  generate.textContent = "AI 生成";
  generate.setAttribute(GIT_SIDEBAR_GENERATE_ATTRIBUTE, "v1");
  modelRow.append(model, generate);
  const commitActions = document.createElement("div");
  commitActions.className = "codexhost-git-commit-actions";
  const stageAll = document.createElement("button");
  stageAll.type = "button";
  stageAll.textContent = "全部暂存";
  stageAll.setAttribute(GIT_SIDEBAR_STAGE_ALL_ATTRIBUTE, "v1");
  const commit = document.createElement("button");
  commit.type = "button";
  commit.textContent = "提交";
  commit.setAttribute(GIT_SIDEBAR_COMMIT_ATTRIBUTE, "v1");
  const commitPush = document.createElement("button");
  commitPush.type = "button";
  commitPush.textContent = "提交并推送";
  commitPush.dataset.primary = "true";
  commitPush.setAttribute(GIT_SIDEBAR_COMMIT_PUSH_ATTRIBUTE, "v1");
  const push = document.createElement("button");
  push.type = "button";
  push.textContent = "推送";
  push.setAttribute(GIT_SIDEBAR_PUSH_ATTRIBUTE, "v1");
  commitActions.append(stageAll, commit, commitPush, push);
  const notice = document.createElement("p");
  notice.className = "codexhost-git-notice";
  notice.hidden = true;
  commitBox.append(message, modelRow, commitActions, notice);
  workspace.append(changesTitle, list, stagedTitle, stagedList, submoduleList, diff);
  const logLayout = document.createElement("div");
  logLayout.className = "codexhost-git-log";
  const refs = document.createElement("div");
  refs.className = "codexhost-git-log-refs";
  const commitList = document.createElement("div");
  commitList.className = "codexhost-git-log-commits";
  const detail = document.createElement("div");
  detail.className = "codexhost-git-log-detail";
  logLayout.append(refs, commitList, detail);
  panel.append(head, branch, logLayout, workspace, commitBox);
  shell.append(rail, panel);
  shadow.append(style, shell);

  let anchor: SidebarAnchor | null = null;
  let view: "projects" | "commits" | "log" = "projects";
  let current: GitWorkspaceStatus | null = null;
  let log: GitLogResult | null = null;
  let commitDetail: GitCommitDetail | null = null;
  let selectedChange: string | null = null;
  let selectedCommit: string | null = null;
  let busy = false;
  let modelsLoaded = false;
  let generation = 0;
  let disposed = false;

  const context = (): RendererGitContext => options.getContext();

  const syncOfficialPanelState = (): void => {
    for (const [panel, button] of [
      ["files", files],
      ["terminal", terminal],
    ] as const) {
      const target = officialPanelButton(document, panel);
      button.setAttribute("aria-pressed", String(target?.getAttribute("aria-pressed") === "true"));
      button.title = target
        ? (button.getAttribute("aria-label") ?? "")
        : `${button.getAttribute("aria-label") ?? ""}（不可用）`;
    }
  };

  const render = (): void => {
    if (!anchor) return;
    anchor.content.hidden = view !== "projects";
    panel.hidden = view === "projects";
    if (view === "projects") projects.setAttribute("aria-current", "page");
    else projects.removeAttribute("aria-current");
    if (view === "commits") commits.setAttribute("aria-current", "page");
    else commits.removeAttribute("aria-current");
    if (view === "log") logs.setAttribute("aria-current", "page");
    else logs.removeAttribute("aria-current");
    if (view === "projects") {
      syncOfficialPanelState();
      updateBusy();
      return;
    }
    const showLog = view === "log";
    headText.textContent = showLog ? "日志" : "提交";
    logLayout.hidden = !showLog;
    workspace.hidden = showLog;
    commitBox.hidden = showLog;
    branch.textContent = current?.branch
      ? `${current.branch} · ${current.ahead}↑ ${current.behind}↓`
      : context().threadId
        ? "未检测到工作区"
        : "未选择项目";
    if (showLog) {
      renderLog();
      syncOfficialPanelState();
      updateBusy();
      return;
    }
    list.replaceChildren();
    stagedList.replaceChildren();
    submoduleList.replaceChildren();
    const entries = current?.changes ?? [];
    const unstaged = entries.filter((change) => !change.staged || change.unstaged);
    const staged = entries.filter((change) => change.staged);
    changesCount.textContent = String(unstaged.length);
    stagedCount.textContent = String(staged.length);
    if (!unstaged.length) {
      const empty = document.createElement("p");
      empty.className = "codexhost-git-empty";
      empty.textContent = "没有待提交的变更";
      list.append(empty);
    }
    const renderChange = (
      change: GitWorkspaceStatus["changes"][number],
      container: HTMLElement,
      action: "stage" | "unstage",
    ): void => {
      const row = document.createElement("div");
      row.className = "codexhost-git-change";
      row.setAttribute("aria-selected", String(selectedChange === change.path));
      row.title = change.originalPath ? `${change.originalPath} → ${change.path}` : change.path;
      const name = document.createElement("span");
      name.textContent = change.submodule ? `${change.path} · 子模块` : change.path;
      const status = document.createElement("span");
      status.className = "codexhost-git-status";
      status.textContent = change.conflicted
        ? "!"
        : change.untracked
          ? "U"
          : change.staged
            ? "S"
            : "M";
      const actionButton = iconButton(
        document,
        action === "stage" ? "暂存" : "取消暂存",
        action === "stage" ? "M12 5v14M5 12h14" : "M5 12h14",
      );
      actionButton.className = "codexhost-git-change-action";
      actionButton.disabled = busy;
      actionButton.setAttribute(
        action === "stage" ? GIT_SIDEBAR_STAGE_ATTRIBUTE : GIT_SIDEBAR_UNSTAGE_ATTRIBUTE,
        "v1",
      );
      actionButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void updateStaged(change.path, action === "stage");
      });
      row.append(name, status, actionButton);
      row.addEventListener("click", () => void openDiff(change.path), listenerOptions);
      container.append(row);
    };
    for (const change of unstaged) {
      renderChange(change, list, change.staged ? "unstage" : "stage");
    }
    if (!staged.length) {
      const empty = document.createElement("p");
      empty.className = "codexhost-git-empty";
      empty.textContent = "没有已暂存文件";
      stagedList.append(empty);
    }
    for (const change of staged) {
      renderChange(change, stagedList, "unstage");
    }
    for (const submodule of current?.submodules ?? []) {
      const row = document.createElement("div");
      row.className = "codexhost-git-submodule";
      const copy = document.createElement("span");
      copy.textContent = `${submodule.path} · ${submodule.status}`;
      const update = document.createElement("button");
      update.type = "button";
      update.textContent = submodule.status === "uninitialized" ? "初始化" : "更新";
      update.disabled =
        busy || submodule.status === "current" || !context().client?.updateGitSubmodule;
      update.addEventListener(
        "click",
        () => void updateSubmodule(submodule.path, submodule.status === "uninitialized"),
        listenerOptions,
      );
      row.append(copy, update);
      submoduleList.append(row);
    }
    syncOfficialPanelState();
    updateBusy();
  };

  const selectCommit = async (commit: string): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client?.inspectGitCommit) return;
    selectedCommit = commit;
    detail.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "codexhost-git-empty";
    loading.textContent = "正在加载提交详情…";
    detail.append(loading);
    try {
      const value = await request.client.inspectGitCommit({ threadId: request.threadId, commit });
      if (disposed || selectedCommit !== commit) return;
      commitDetail = value;
      renderLog();
    } catch (error) {
      if (disposed || selectedCommit !== commit) return;
      detail.replaceChildren();
      const failure = document.createElement("p");
      failure.className = "codexhost-git-empty";
      failure.textContent = error instanceof Error ? error.message : String(error);
      detail.append(failure);
    }
  };

  const selectCommitFile = async (commit: string, filePath: string): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client?.inspectGitCommitDiff) return;
    const output = document.createElement("pre");
    output.className = "codexhost-git-diff";
    output.textContent = "正在加载差异…";
    detail.append(output);
    try {
      const result = await request.client.inspectGitCommitDiff({
        threadId: request.threadId,
        commit,
        path: filePath,
      });
      output.textContent = result.diff || "没有差异";
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const renderLog = (): void => {
    refs.replaceChildren();
    commitList.replaceChildren();
    detail.replaceChildren();
    if (!log) {
      const empty = document.createElement("p");
      empty.className = "codexhost-git-empty";
      empty.textContent = "正在加载 Git 日志…";
      commitList.append(empty);
      return;
    }
    const head = document.createElement("button");
    head.type = "button";
    head.className = "codexhost-git-log-ref";
    head.textContent = "HEAD";
    head.title = log.head ?? "";
    refs.append(head);
    for (const ref of log.refs.filter((value) => value.kind !== "head" && value.kind !== "tag")) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "codexhost-git-log-ref";
      row.textContent = ref.name.replace(/^refs\/(?:heads|remotes)\//u, "");
      row.title = ref.name;
      refs.append(row);
    }
    for (const commit of log.commits) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "codexhost-git-log-commit";
      row.setAttribute("aria-selected", String(selectedCommit === commit.commit));
      const subject = document.createElement("span");
      subject.className = "codexhost-git-log-subject";
      subject.textContent = commit.subject;
      const meta = document.createElement("span");
      meta.className = "codexhost-git-log-meta";
      meta.textContent = `${commit.shortCommit} · ${commit.authorName}`;
      row.append(subject, meta);
      row.addEventListener("click", () => void selectCommit(commit.commit), listenerOptions);
      commitList.append(row);
    }
    if (!commitDetail) return;
    const title = document.createElement("h3");
    title.textContent = commitDetail.commit.subject;
    const meta = document.createElement("p");
    meta.className = "codexhost-git-log-detail-meta";
    meta.textContent = `${commitDetail.commit.shortCommit} · ${commitDetail.commit.authorName} <${commitDetail.commit.authorEmail}> · ${commitDetail.commit.authoredAt}`;
    const body = document.createElement("p");
    body.className = "codexhost-git-log-body";
    body.textContent = commitDetail.body;
    detail.append(title, meta, body);
    for (const file of commitDetail.files) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "codexhost-git-log-file";
      row.textContent = `${file.status} ${file.path}${file.additions === null ? "" : ` +${file.additions} -${file.deletions ?? 0}`}`;
      row.addEventListener(
        "click",
        () => {
          if (commitDetail) void selectCommitFile(commitDetail.commit.commit, file.path);
        },
        listenerOptions,
      );
      detail.append(row);
    }
  };

  const openDiff = async (pathValue: string): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client) return;
    selectedChange = pathValue;
    render();
    diff.textContent = "正在加载差异…";
    try {
      const result = await request.client.inspectGitDiff({
        threadId: request.threadId,
        path: pathValue,
      });
      if (!disposed && selectedChange === pathValue) {
        diff.textContent = result.diff || "没有差异";
      }
    } catch (error) {
      if (!disposed && selectedChange === pathValue) {
        diff.textContent = error instanceof Error ? error.message : String(error);
      }
    }
  };

  const setNotice = (value: string): void => {
    notice.textContent = value;
    notice.hidden = value.length === 0;
  };

  function updateBusy(): void {
    const client = context().client;
    const hasCommittable = current?.changes.some((change) => !change.conflicted) ?? false;
    stageAll.disabled =
      busy || !client || !(current?.changes.some((change) => !change.conflicted) ?? false);
    generate.disabled = busy || !client || !modelsLoaded || !model.value;
    commit.disabled = busy || !client || !hasCommittable;
    commitPush.disabled = commit.disabled;
    push.disabled = busy || !client;
    model.disabled = busy || !modelsLoaded;
    refresh.disabled = busy;
  }

  const loadModels = async (): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client) return;
    try {
      const result = await request.client.listGitMessageModels({ threadId: request.threadId });
      model.replaceChildren();
      for (const item of result.models.filter((candidate) => candidate.eligible)) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.label} · ${item.tier}`;
        model.append(option);
      }
      if (result.defaultModel) model.value = result.defaultModel;
      modelsLoaded = model.childElementCount > 0;
      if (!modelsLoaded) setNotice("没有可用的提交消息模型");
    } catch (error) {
      modelsLoaded = false;
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      updateBusy();
    }
  };

  const reloadWorkspace = async (): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client) return;
    current = await request.client.inspectGitStatus({ threadId: request.threadId });
    render();
  };

  const updateStaged = async (pathValue: string, stage: boolean): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client || busy) return;
    busy = true;
    setNotice("");
    render();
    try {
      await (stage ? request.client.stageGitPaths : request.client.unstageGitPaths)({
        threadId: request.threadId,
        paths: [pathValue],
      });
      await reloadWorkspace();
      setNotice(stage ? "已暂存文件。" : "已取消暂存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
      render();
    }
  };

  const submit = async (pushAfterCommit: boolean): Promise<void> => {
    const request = context();
    if (busy) return;
    if (!request.threadId || !request.client) {
      setNotice("未选择可用的 Git 工作区。");
      render();
      return;
    }
    if (!message.value.trim()) {
      setNotice("请填写提交消息，或先使用 AI 生成。");
      render();
      return;
    }
    const stagedPaths =
      current?.changes
        .filter((change) => change.staged && !change.conflicted)
        .map((change) => change.path) ?? [];
    const paths =
      stagedPaths.length > 0
        ? stagedPaths
        : (current?.changes.filter((change) => !change.conflicted).map((change) => change.path) ??
          []);
    if (paths.length === 0) {
      setNotice("没有可提交的变更。");
      render();
      return;
    }
    busy = true;
    setNotice(
      pushAfterCommit
        ? `正在提交${stagedPaths.length > 0 ? "已暂存" : "当前"}变更并推送…`
        : `正在提交${stagedPaths.length > 0 ? "已暂存" : "当前"}变更…`,
    );
    render();
    try {
      if (stagedPaths.length === 0) {
        await request.client.stageGitPaths({ threadId: request.threadId, paths });
      }
      const result = await request.client.commitGit({
        threadId: request.threadId,
        message: message.value,
        // Commit the index after explicitly staging the selected paths.
        // Passing paths here would use Git's pathspec commit mode and bypass
        // the index semantics that the two-stage UI exposes to the user.
        paths: [],
        push: pushAfterCommit,
      });
      current = result.status;
      message.value = "";
      log = null;
      commitDetail = null;
      selectedCommit = null;
      busy = false;
      render();
      await load(true);
      const pushed = pushAfterCommit || result.pushed;
      const commitLabel = result.commit ? ` (${result.commit})` : "";
      setNotice((pushed ? `已提交${commitLabel}并推送。` : `已提交${commitLabel}。`).trim());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
      render();
    }
  };

  const load = async (force = false): Promise<void> => {
    if (disposed || view === "projects" || (busy && !force)) return;
    const request = context();
    if (!request.threadId || !request.client) {
      current = null;
      render();
      return;
    }
    const requestGeneration = ++generation;
    busy = true;
    try {
      const [status, history] = await Promise.all([
        request.client.inspectGitStatus({ threadId: request.threadId }),
        request.client.inspectGitLog
          ? request.client.inspectGitLog({ threadId: request.threadId, limit: 200 })
          : Promise.resolve(null),
      ]);
      if (disposed || requestGeneration !== generation) return;
      current = status;
      log = history;
      if (!modelsLoaded) void loadModels();
      if (view === "log" && history?.commits[0] && selectedCommit === null) {
        await selectCommit(history.commits[0].commit);
      }
      busy = false;
      updateBusy();
      render();
      const first = status.changes[0];
      if (view === "commits" && first && selectedChange === null) await openDiff(first.path);
    } catch (error) {
      if (disposed || requestGeneration !== generation) return;
      current = null;
      diff.textContent = error instanceof Error ? error.message : String(error);
      busy = false;
      updateBusy();
      render();
    } finally {
      busy = false;
      updateBusy();
    }
  };

  const updateSubmodule = async (pathValue: string, initialize: boolean): Promise<void> => {
    const request = context();
    const client = request.client;
    const threadId = request.threadId as HostThreadId | null;
    const update = client?.updateGitSubmodule;
    if (!threadId || !update) return;
    busy = true;
    updateBusy();
    render();
    try {
      await update({ threadId, path: pathValue, init: initialize });
      await load(true);
    } finally {
      busy = false;
      updateBusy();
      render();
    }
  };

  projects.addEventListener(
    "click",
    () => {
      view = "projects";
      generation += 1;
      render();
    },
    listenerOptions,
  );
  commits.addEventListener(
    "click",
    () => {
      view = "commits";
      render();
      void load();
    },
    listenerOptions,
  );
  logs.addEventListener(
    "click",
    () => {
      view = "log";
      render();
      void load();
    },
    listenerOptions,
  );
  files.addEventListener(
    "click",
    () => {
      officialPanelButton(document, "files")?.click();
      syncOfficialPanelState();
    },
    listenerOptions,
  );
  terminal.addEventListener(
    "click",
    () => {
      officialPanelButton(document, "terminal")?.click();
      syncOfficialPanelState();
    },
    listenerOptions,
  );
  refresh.addEventListener("click", () => void load(), listenerOptions);
  message.addEventListener(
    "input",
    () => {
      setNotice("");
      updateBusy();
    },
    listenerOptions,
  );
  stageAll.addEventListener(
    "click",
    () => {
      const request = context();
      if (!request.threadId || !request.client || !current || busy) return;
      const paths = current.changes
        .filter((change) => !change.conflicted && (!change.staged || change.unstaged))
        .map((change) => change.path);
      if (!paths.length) return;
      busy = true;
      setNotice("");
      render();
      void request.client
        .stageGitPaths({ threadId: request.threadId, paths })
        .then(async () => {
          await reloadWorkspace();
          setNotice("已暂存全部变更。");
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          busy = false;
          render();
        });
    },
    listenerOptions,
  );
  generate.addEventListener(
    "click",
    () => {
      const request = context();
      if (!request.threadId || !request.client || !model.value || busy) return;
      busy = true;
      setNotice("正在生成提交消息…");
      render();
      void request.client
        .generateGitMessage({
          threadId: request.threadId,
          model: model.value,
          paths:
            current?.changes.filter((change) => change.staged).map((change) => change.path) ?? [],
        })
        .then((result) => {
          message.value = result.message;
          setNotice(`已使用 ${result.model} 生成提交消息。`);
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          busy = false;
          render();
        });
    },
    listenerOptions,
  );
  commit.addEventListener("click", () => void submit(false), listenerOptions);
  commitPush.addEventListener("click", () => void submit(true), listenerOptions);
  push.addEventListener(
    "click",
    () => {
      const request = context();
      if (!request.threadId || !request.client || busy) return;
      busy = true;
      setNotice("正在推送…");
      render();
      void request.client
        .pushGit({ threadId: request.threadId })
        .then(async () => {
          await reloadWorkspace();
          await load(true);
          setNotice("已推送。");
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          busy = false;
          render();
        });
    },
    listenerOptions,
  );

  const mount = (): void => {
    if (disposed) return;
    const next = sidebarAnchor(document);
    if (!next) {
      if (anchor) restoreSidebarAnchor(anchor);
      root.remove();
      anchor = null;
      return;
    }
    if (
      anchor?.container === next.container &&
      anchor.content === next.content &&
      root.parentElement === next.container
    ) {
      return;
    }
    if (anchor) restoreSidebarAnchor(anchor);
    root.remove();
    anchor = next;
    next.container.style.position = "relative";
    next.content.style.height = "100%";
    next.content.style.minHeight = "0";
    next.content.style.paddingLeft = "38px";
    next.container.append(root);
    render();
  };

  const observer = new MutationObserver(() => {
    mount();
    syncOfficialPanelState();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "aria-pressed"],
  });
  mount();
  return {
    refresh() {
      if (view !== "projects") void load();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      if (anchor) restoreSidebarAnchor(anchor);
      root.remove();
      anchor = null;
    },
  };
}
