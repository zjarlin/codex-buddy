import type {
  GitCommitDetail,
  GitLogResult,
  GitWorkspaceStatus,
  HostThreadId,
} from "@codexhost/shared-contracts";

import type { RendererGitContext } from "./settings/git-page.js";

export const GIT_SIDEBAR_ROOT_ATTRIBUTE = "data-codexhost-git-sidebar";
export const GIT_SIDEBAR_RAIL_ATTRIBUTE = "data-codexhost-git-sidebar-rail";
export const GIT_SIDEBAR_PANEL_ATTRIBUTE = "data-codexhost-git-sidebar-panel";
export const GIT_SIDEBAR_PROJECTS_ATTRIBUTE = "data-codexhost-git-sidebar-projects";
export const GIT_SIDEBAR_COMMITS_ATTRIBUTE = "data-codexhost-git-sidebar-commits";
export const GIT_SIDEBAR_FILES_ATTRIBUTE = "data-codexhost-git-sidebar-files";
export const GIT_SIDEBAR_TERMINAL_ATTRIBUTE = "data-codexhost-git-sidebar-terminal";
export const GIT_SIDEBAR_LOG_ATTRIBUTE = "data-codexhost-git-sidebar-log";
export const GIT_SIDEBAR_WORKSPACE_ATTRIBUTE = "data-codexhost-git-sidebar-workspace";

const SIDEBAR_THREAD_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_SIDEBAR_HEIGHT = 220;

interface SidebarAnchor {
  container: HTMLElement;
  content: HTMLElement;
}

function isVisible(element: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function sidebarAnchor(document: Document): SidebarAnchor | null {
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
      return { container: candidate, content };
    }
    candidate = candidate.parentElement;
  }
  return null;
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

function dispatchHostAction(type: "toggle-file-tree-panel" | "toggle-terminal"): void {
  window.dispatchEvent(
    new CustomEvent("codexhost:host-message", {
      bubbles: true,
      composed: true,
      detail: { type },
    }),
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
    :host { display:block; position:absolute; inset:0; width:auto; min-width:0; height:100%; pointer-events:none; }
    .codexhost-git-shell { display:contents; color:var(--text-primary,inherit); }
    .codexhost-git-rail { position:absolute; z-index:2; inset:0 auto 0 0; display:flex; width:34px; flex-direction:column; align-items:center; gap:6px; padding:8px 3px; border-right:1px solid var(--border-default, color-mix(in srgb,currentColor 14%,transparent)); pointer-events:auto; }
    .codexhost-git-rail button { display:grid; place-items:center; width:28px; height:28px; padding:0; color:inherit; background:transparent; border:0; border-radius:6px; cursor:pointer; opacity:.68; }
    .codexhost-git-rail button:hover, .codexhost-git-rail button[aria-current="page"] { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-panel { position:absolute; inset:0 0 0 34px; min-width:0; overflow:auto; background:var(--surface-primary,inherit); pointer-events:auto; }
    .codexhost-git-panel[hidden], .codexhost-git-projects[hidden] { display:none; }
    .codexhost-git-head { display:flex; align-items:center; min-height:38px; gap:8px; padding:6px 10px; font-size:12px; font-weight:600; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-git-head button { margin-left:auto; }
    .codexhost-git-branch { display:flex; gap:8px; padding:7px 10px; color:inherit; font-size:11px; opacity:.7; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-list { display:flex; flex-direction:column; }
    .codexhost-git-change { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; min-height:34px; padding:5px 8px 5px 10px; color:inherit; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 8%,transparent)); cursor:pointer; }
    .codexhost-git-change:hover, .codexhost-git-change[aria-selected="true"] { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-change span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-git-status { min-width:14px; font-size:10px; font-weight:700; text-align:right; opacity:.72; }
    .codexhost-git-empty { margin:0; padding:14px 10px; font-size:11px; opacity:.58; }
    .codexhost-git-submodule { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:6px 8px 6px 10px; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); font-size:11px; }
    .codexhost-git-submodule button { padding:2px 6px; color:inherit; background:transparent; border:1px solid currentColor; border-radius:4px; cursor:pointer; }
    .codexhost-git-diff { position:sticky; top:0; max-height:46%; overflow:auto; margin:0; padding:10px; white-space:pre; font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
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
  const projects = iconButton(document, "项目", "M3 6.5h6l1.5 2H21v9.5H3z");
  projects.setAttribute(GIT_SIDEBAR_PROJECTS_ATTRIBUTE, "v1");
  projects.setAttribute("aria-current", "page");
  const commits = iconButton(
    document,
    "提交",
    "M5 12h14M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z",
  );
  commits.setAttribute(GIT_SIDEBAR_COMMITS_ATTRIBUTE, "v1");
  const files = iconButton(document, "文件", "M4 5.5h6l1.5 2H20v11H4zM4 10h16");
  files.setAttribute(GIT_SIDEBAR_FILES_ATTRIBUTE, "v1");
  const terminal = iconButton(document, "终端", "M5 6l5 5-5 5M12 17h7");
  terminal.setAttribute(GIT_SIDEBAR_TERMINAL_ATTRIBUTE, "v1");
  rail.append(projects, files, commits, terminal);
  const panel = document.createElement("div");
  panel.className = "codexhost-git-panel";
  panel.setAttribute(GIT_SIDEBAR_PANEL_ATTRIBUTE, "v1");
  panel.hidden = true;
  const head = document.createElement("div");
  head.className = "codexhost-git-head";
  const headText = document.createElement("span");
  headText.textContent = "提交";
  const refresh = iconButton(document, "刷新", "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6");
  const logMode = document.createElement("button");
  logMode.type = "button";
  logMode.textContent = "日志";
  logMode.setAttribute(GIT_SIDEBAR_LOG_ATTRIBUTE, "v1");
  const workspaceMode = document.createElement("button");
  workspaceMode.type = "button";
  workspaceMode.textContent = "工作区";
  workspaceMode.setAttribute(GIT_SIDEBAR_WORKSPACE_ATTRIBUTE, "v1");
  head.append(headText, logMode, workspaceMode, refresh);
  const branch = document.createElement("div");
  branch.className = "codexhost-git-branch";
  const list = document.createElement("div");
  list.className = "codexhost-git-list";
  const submoduleList = document.createElement("div");
  submoduleList.className = "codexhost-git-submodules";
  const diff = document.createElement("pre");
  diff.className = "codexhost-git-diff";
  diff.textContent = "选择文件查看差异";
  const logLayout = document.createElement("div");
  logLayout.className = "codexhost-git-log";
  const refs = document.createElement("div");
  refs.className = "codexhost-git-log-refs";
  const commitList = document.createElement("div");
  commitList.className = "codexhost-git-log-commits";
  const detail = document.createElement("div");
  detail.className = "codexhost-git-log-detail";
  logLayout.append(refs, commitList, detail);
  panel.append(head, branch, logLayout, list, submoduleList, diff);
  shell.append(rail, panel);
  shadow.append(style, shell);

  let anchor: SidebarAnchor | null = null;
  let view: "projects" | "commits" = "projects";
  let current: GitWorkspaceStatus | null = null;
  let log: GitLogResult | null = null;
  let commitDetail: GitCommitDetail | null = null;
  let commitMode: "log" | "workspace" = "log";
  let selected: string | null = null;
  let busy = false;
  let generation = 0;
  let disposed = false;

  const context = (): RendererGitContext => options.getContext();

  const render = (): void => {
    if (!anchor) return;
    anchor.content.hidden = view === "commits";
    panel.hidden = view === "projects";
    if (view === "projects") projects.setAttribute("aria-current", "page");
    else projects.removeAttribute("aria-current");
    if (view === "commits") commits.setAttribute("aria-current", "page");
    else commits.removeAttribute("aria-current");
    if (view === "projects") return;
    const showLog = commitMode === "log";
    logLayout.hidden = !showLog;
    list.hidden = showLog;
    submoduleList.hidden = showLog;
    diff.hidden = showLog;
    logMode.setAttribute("aria-selected", String(showLog));
    workspaceMode.setAttribute("aria-selected", String(!showLog));
    branch.textContent = current?.branch
      ? `${current.branch} · ${current.ahead}↑ ${current.behind}↓`
      : context().threadId
        ? "未检测到工作区"
        : "未选择项目";
    if (showLog) {
      renderLog();
      return;
    }
    list.replaceChildren();
    submoduleList.replaceChildren();
    const entries = current?.changes ?? [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "codexhost-git-empty";
      empty.textContent = "没有待提交的变更";
      list.append(empty);
    }
    for (const change of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "codexhost-git-change";
      row.setAttribute("aria-selected", String(selected === change.path));
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
      row.append(name, status);
      row.addEventListener("click", () => void openDiff(change.path), listenerOptions);
      list.append(row);
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
  };

  const selectCommit = async (commit: string): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client?.inspectGitCommit) return;
    selected = commit;
    detail.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "codexhost-git-empty";
    loading.textContent = "正在加载提交详情…";
    detail.append(loading);
    try {
      const value = await request.client.inspectGitCommit({ threadId: request.threadId, commit });
      if (disposed || selected !== commit) return;
      commitDetail = value;
      renderLog();
    } catch (error) {
      if (disposed || selected !== commit) return;
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
      row.setAttribute("aria-selected", String(selected === commit.commit));
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
    selected = pathValue;
    render();
    diff.textContent = "正在加载差异…";
    try {
      const result = await request.client.inspectGitDiff({
        threadId: request.threadId,
        path: pathValue,
      });
      if (!disposed && selected === pathValue) diff.textContent = result.diff || "没有差异";
    } catch (error) {
      if (!disposed && selected === pathValue) {
        diff.textContent = error instanceof Error ? error.message : String(error);
      }
    }
  };

  const load = async (): Promise<void> => {
    if (disposed || view !== "commits" || busy) return;
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
      if (commitMode === "log" && history?.commits[0] && selected === null) {
        await selectCommit(history.commits[0].commit);
      }
      busy = false;
      render();
      const first = status.changes[0];
      if (first) await openDiff(first.path);
    } catch (error) {
      if (disposed || requestGeneration !== generation) return;
      current = null;
      diff.textContent = error instanceof Error ? error.message : String(error);
      busy = false;
      render();
    } finally {
      busy = false;
    }
  };

  const updateSubmodule = async (pathValue: string, initialize: boolean): Promise<void> => {
    const request = context();
    const client = request.client;
    const threadId = request.threadId as HostThreadId | null;
    const update = client?.updateGitSubmodule;
    if (!threadId || !update) return;
    busy = true;
    render();
    try {
      await update({ threadId, path: pathValue, init: initialize });
      await load();
    } finally {
      busy = false;
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
  refresh.addEventListener("click", () => void load(), listenerOptions);
  logMode.addEventListener(
    "click",
    () => {
      commitMode = "log";
      render();
    },
    listenerOptions,
  );
  workspaceMode.addEventListener(
    "click",
    () => {
      commitMode = "workspace";
      render();
    },
    listenerOptions,
  );
  files.addEventListener(
    "click",
    () => dispatchHostAction("toggle-file-tree-panel"),
    listenerOptions,
  );
  terminal.addEventListener("click", () => dispatchHostAction("toggle-terminal"), listenerOptions);

  const mount = (): void => {
    if (disposed) return;
    const next = sidebarAnchor(document);
    if (!next) {
      root.remove();
      anchor = null;
      return;
    }
    if (anchor?.container === next.container && root.parentElement === next.container) return;
    anchor = next;
    next.container.style.display = "grid";
    next.container.style.gridTemplateColumns = "34px minmax(0, 1fr)";
    next.container.prepend(root);
    render();
  };

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount();
  return {
    refresh() {
      if (view === "commits") void load();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      root.remove();
    },
  };
}
