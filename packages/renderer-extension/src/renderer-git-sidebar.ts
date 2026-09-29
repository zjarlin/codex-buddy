import {
  createGitRepositorySelector,
  type GitRepositoryClient,
} from "./renderer-git-repositories.js";
import type {
  GitCommitParams,
  GitMessageGenerateParams,
  GitMessageModel,
  GitStageParams,
  GitSubmoduleUpdateParams,
  GitWorkspaceParams,
  GitWorkspaceStatus,
  GitSyncResult,
  HostThreadId,
} from "@codexhost/shared-contracts";
import { gitButtonLoadingStyles } from "./renderer-git-loading.js";
import { RendererGitCache } from "./renderer-git-cache.js";
import { openNativeGitReview, runNativeWorkspaceCommand } from "./renderer-native-workspace.js";
import {
  createRendererProjectSyncPanel,
  type RendererProjectSyncClient,
} from "./renderer-project-sync-panel.js";

export interface RendererGitClient extends Partial<GitRepositoryClient> {
  inspectGitStatus(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  stageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus>;
  unstageGitPaths(input: GitStageParams): Promise<GitWorkspaceStatus>;
  commitGit(input: GitCommitParams): Promise<{
    commit: string | null;
    pushed: boolean;
    output: string;
    status: GitWorkspaceStatus;
  }>;
  pushGit(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  fetchGit?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  syncGit?(input: GitWorkspaceParams): Promise<GitSyncResult>;
  continueGitMerge?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  abortGitMerge?(input: GitWorkspaceParams): Promise<GitWorkspaceStatus>;
  listGitMessageModels(input: GitWorkspaceParams): Promise<{
    models: GitMessageModel[];
    defaultModel: string | null;
  }>;
  generateGitMessage(input: GitMessageGenerateParams): Promise<{ message: string; model: string }>;
  listGitSubmodules?(
    input: GitWorkspaceParams,
  ): Promise<{ submodules: { path: string; status: string }[] }>;
  updateGitSubmodule?(input: GitSubmoduleUpdateParams): Promise<GitWorkspaceStatus>;
}

export interface RendererGitContext {
  hostId: string | null;
  repository?: string | undefined;
  threadId: HostThreadId | null;
  client: RendererGitClient | null;
}

export const GIT_SIDEBAR_ROOT_ATTRIBUTE = "data-codexhost-git-sidebar";
export const GIT_SIDEBAR_RAIL_ATTRIBUTE = "data-codexhost-git-sidebar-rail";
export const GIT_SIDEBAR_PANEL_ATTRIBUTE = "data-codexhost-git-sidebar-panel";
export const GIT_SIDEBAR_PROJECTS_ATTRIBUTE = "data-codexhost-git-sidebar-projects";
export const GIT_SIDEBAR_DEVICES_ATTRIBUTE = "data-codexhost-git-sidebar-devices";
export const GIT_SIDEBAR_COMMITS_ATTRIBUTE = "data-codexhost-git-sidebar-commits";
export const GIT_SIDEBAR_CHANGES_TAB_ATTRIBUTE = "data-codexhost-git-sidebar-changes-tab";
export const GIT_SIDEBAR_STAGED_TAB_ATTRIBUTE = "data-codexhost-git-sidebar-staged-tab";
export const GIT_SIDEBAR_FILES_ATTRIBUTE = "data-codexhost-git-sidebar-files";
export const GIT_SIDEBAR_TERMINAL_ATTRIBUTE = "data-codexhost-git-sidebar-terminal";
export const GIT_SIDEBAR_TREE_ATTRIBUTE = "data-codexhost-git-sidebar-tree";
export const GIT_SIDEBAR_STAGE_ATTRIBUTE = "data-codexhost-git-sidebar-stage";
export const GIT_SIDEBAR_UNSTAGE_ATTRIBUTE = "data-codexhost-git-sidebar-unstage";
export const GIT_SIDEBAR_STAGE_ALL_ATTRIBUTE = "data-codexhost-git-sidebar-stage-all";
export const GIT_SIDEBAR_MESSAGE_ATTRIBUTE = "data-codexhost-git-sidebar-message";
export const GIT_SIDEBAR_MODEL_ATTRIBUTE = "data-codexhost-git-sidebar-model";
export const GIT_SIDEBAR_GENERATE_ATTRIBUTE = "data-codexhost-git-sidebar-generate";
export const GIT_SIDEBAR_COMMIT_ATTRIBUTE = "data-codexhost-git-sidebar-commit";
export const GIT_SIDEBAR_COMMIT_PUSH_ATTRIBUTE = "data-codexhost-git-sidebar-commit-push";
export const GIT_SIDEBAR_PUSH_ATTRIBUTE = "data-codexhost-git-sidebar-push";
export const GIT_SIDEBAR_SYNC_ATTRIBUTE = "data-codexhost-git-sidebar-sync";
export const GIT_SIDEBAR_CONFLICT_ATTRIBUTE = "data-codexhost-git-sidebar-conflict";
export const GIT_SIDEBAR_MERGE_CONTINUE_ATTRIBUTE = "data-codexhost-git-sidebar-merge-continue";
export const GIT_SIDEBAR_MERGE_ABORT_ATTRIBUTE = "data-codexhost-git-sidebar-merge-abort";

const SIDEBAR_THREAD_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
const APP_SIDEBAR_SELECTOR = "#app-shell-sidebar";
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_SIDEBAR_HEIGHT = 220;
const pathJoin = (workspace: string, relative: string): string => {
  const separator = workspace.includes("\\") && !workspace.includes("/") ? "\\" : "/";
  return `${workspace.replace(/[\\/]+$/u, "")}${separator}${relative.replace(/^[\\/]+/u, "").replace(/[\\/]+/gu, separator)}`;
};
const OFFICIAL_PANEL_LABELS = {
  files: [
    /^(?:显示\/隐藏文件树|切换文件树显示|文件树)$/u,
    /^(?:show or hide file tree|toggle file tree)$/iu,
  ],
  terminal: [/^切换底部面板显示$/u, /^show or hide bottom panel$/iu, /^toggle bottom panel$/iu],
} as const;

type OfficialPanel = keyof typeof OFFICIAL_PANEL_LABELS;

interface SidebarAnchor {
  container: HTMLElement;
  content: HTMLElement;
  containerStyle: { position: string };
  contentStyle: { height: string; minHeight: string; paddingLeft: string };
}

type GitChange = GitWorkspaceStatus["changes"][number];

interface GitDirectory {
  name: string;
  path: string;
  directories: Map<string, GitDirectory>;
  changes: GitChange[];
  count: number;
}

function buildGitTree(changes: readonly GitChange[]): GitDirectory {
  const root: GitDirectory = { name: "", path: "", directories: new Map(), changes: [], count: 0 };
  for (const change of changes) {
    const parts = change.path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) continue;
    root.count += 1;
    let directory = root;
    for (const part of parts) {
      let child = directory.directories.get(part);
      if (!child) {
        child = {
          name: part,
          path: directory.path ? `${directory.path}/${part}` : part,
          directories: new Map(),
          changes: [],
          count: 0,
        };
        directory.directories.set(part, child);
      }
      child.count += 1;
      directory = child;
    }
    directory.changes.push(change);
  }
  return root;
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

function gitChangeStatus(
  change: GitChange,
  action: "stage" | "unstage",
): {
  code: string;
  label: string;
} {
  if (change.conflicted) return { code: "!", label: "冲突" };
  if (change.untracked) return { code: "U", label: "未跟踪" };
  if (action === "unstage") return { code: "S", label: "已暂存" };
  const code = change.workTreeStatus !== " " ? change.workTreeStatus : change.indexStatus;
  const labels: Record<string, string> = {
    A: "新增",
    D: "删除",
    M: "已修改",
    R: "重命名",
    C: "复制",
  };
  return { code: code === " " ? "M" : code, label: labels[code] ?? "已修改" };
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
  syncContext(): void;
  refresh(): void;
  dispose(): void;
}

interface RepositoryGroup {
  path: string | undefined;
  primary: boolean;
  status: GitWorkspaceStatus | null;
  loading: boolean;
  error: string | null;
}

export function installRendererGitSidebar(options: {
  getContext(): RendererGitContext;
  getProjectSyncClient?(): RendererProjectSyncClient | null;
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
    ${gitButtonLoadingStyles}
    :host { display:block; position:absolute; z-index:4; inset:0; min-width:0; min-height:0; pointer-events:none; }
    .codexhost-git-shell { display:contents; color:var(--text-primary,inherit); }
    .codexhost-git-rail { position:absolute; z-index:2; inset:0 auto 0 0; display:flex; width:38px; flex-direction:column; align-items:center; gap:6px; padding:8px 3px; background:var(--surface-primary,transparent); border-right:1px solid var(--border-default, color-mix(in srgb,currentColor 14%,transparent)); pointer-events:auto; }
    .codexhost-git-rail button { display:grid; place-items:center; width:28px; height:28px; padding:0; color:inherit; background:transparent; border:0; border-radius:6px; cursor:pointer; opacity:.68; }
    .codexhost-git-rail button:hover, .codexhost-git-rail button[aria-current="page"] { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-panel { position:absolute; inset:0 0 0 38px; display:flex; min-width:0; flex-direction:column; overflow:hidden; background:var(--surface-primary,inherit); pointer-events:auto; }
    .codexhost-git-panel[hidden], .codexhost-git-head[hidden], .codexhost-git-branch[hidden], .codexhost-git-conflict[hidden], .codexhost-git-projects[hidden], .codexhost-git-workspace[hidden], .codexhost-git-commit-box[hidden], .codexhost-git-modules[hidden] { display:none; }
    .codexhost-git-head { display:flex; align-items:center; min-height:38px; gap:4px; padding:5px 8px; font-size:12px; font-weight:600; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-git-heading { min-width:0; flex:1; padding-left:4px; }
    .codexhost-git-project { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
    .codexhost-git-heading span { display:block; margin-top:2px; font-size:10px; font-weight:400; opacity:.6; }
    .codexhost-git-head button { min-height:28px; padding:3px 8px; color:inherit; background:transparent; border:0; border-radius:5px; cursor:pointer; }
    .codexhost-git-head button:hover, .codexhost-git-head button[aria-selected="true"] { background:color-mix(in srgb,currentColor 10%,transparent); }
    .codexhost-git-head button:disabled { cursor:default; opacity:.4; }
    .codexhost-git-branch { display:flex; gap:8px; padding:7px 10px; color:inherit; font-size:11px; opacity:.7; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-conflict { display:flex; align-items:center; gap:8px; padding:6px 10px; color:inherit; font-size:11px; line-height:1.35; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); background:color-mix(in srgb,currentColor 7%,transparent); }
    .codexhost-git-conflict-text { min-width:0; flex:1; }
    .codexhost-git-conflict-actions { display:flex; flex:none; gap:4px; }
    .codexhost-git-conflict-actions button { min-height:22px; padding:2px 8px; color:inherit; background:transparent; border:1px solid color-mix(in srgb,currentColor 24%,transparent); border-radius:5px; cursor:pointer; font-size:11px; }
    .codexhost-git-conflict-actions button:hover:not(:disabled) { background:color-mix(in srgb,currentColor 12%,transparent); }
    .codexhost-git-conflict-actions button:disabled { cursor:default; opacity:.4; }
    .codexhost-git-workspace { display:flex; min-height:0; flex:1; flex-direction:column; }
    .codexhost-git-status-tabs { display:flex; align-items:center; min-height:32px; padding:2px 5px; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 9%,transparent)); }
    .codexhost-git-status-tab { display:flex; align-items:center; min-height:26px; gap:4px; padding:3px 7px; color:inherit; background:transparent; border:0; border-radius:5px; cursor:pointer; font-size:11px; opacity:.65; }
    .codexhost-git-status-tab:hover, .codexhost-git-status-tab[aria-selected="true"] { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-status-tab[aria-selected="true"] { font-weight:600; }
    .codexhost-git-status-tab span { min-width:14px; color:inherit; font-size:10px; text-align:right; opacity:.58; }
    .codexhost-git-tree-toggle { display:grid; place-items:center; width:26px; height:26px; margin-left:auto; padding:0; color:inherit; background:transparent; border:0; border-radius:5px; cursor:pointer; opacity:.62; }
    .codexhost-git-tree-toggle:hover, .codexhost-git-tree-toggle[aria-pressed="true"] { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-list { display:flex; min-height:0; flex:1; overflow:auto; flex-direction:column; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 9%,transparent)); }
    .codexhost-git-directory { box-sizing:border-box; display:grid; flex:none; grid-template-columns:16px minmax(0,1fr) auto; align-items:center; height:24px; gap:4px; width:100%; padding:0 8px; color:inherit; text-align:left; background:transparent; border:0; cursor:pointer; font-size:11px; }
    .codexhost-git-directory:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
    .codexhost-git-directory-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
    .codexhost-git-directory-count { color:inherit; font-size:10px; opacity:.5; }
    .codexhost-git-change { box-sizing:border-box; display:grid; flex:none; grid-template-columns:minmax(0,1fr) 16px 22px; align-items:center; gap:4px; height:24px; padding:0 6px 0 10px; color:inherit; text-align:left; background:transparent; border:0; cursor:pointer; font-size:11px; }
    .codexhost-git-change:hover, .codexhost-git-change[aria-selected="true"] { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-change span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-git-status { min-width:16px; font-size:10px; font-weight:600; text-align:right; opacity:.72; }
    .codexhost-git-change-action { display:grid; place-items:center; width:22px; height:22px; padding:0; color:inherit; background:transparent; border:0; border-radius:4px; cursor:pointer; opacity:.62; }
    .codexhost-git-change-action:hover:not(:disabled) { background:color-mix(in srgb,currentColor 10%,transparent); opacity:1; }
    .codexhost-git-change-action[data-action="stage"] { color:#2e7d32; }
    .codexhost-git-change-action[data-action="unstage"] { color:color-mix(in srgb,currentColor 58%,transparent); opacity:.58; }
    .codexhost-git-change-action:disabled { opacity:.25; }
    .codexhost-git-empty { margin:0; padding:14px 10px; font-size:11px; opacity:.58; }
    .codexhost-git-modules { flex:none; max-height:32%; overflow:auto; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-modules-title { padding:6px 9px; color:inherit; font-size:10px; font-weight:600; opacity:.58; }
    .codexhost-git-submodule { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:6px 8px 6px 18px; border-top:1px solid var(--border-default, color-mix(in srgb,currentColor 7%,transparent)); font-size:11px; }
    .codexhost-git-submodule button { padding:2px 6px; color:inherit; background:transparent; border:1px solid currentColor; border-radius:4px; cursor:pointer; }
    .codexhost-git-repository-groups { display:flex; min-height:0; flex:none; max-height:45%; overflow:auto; flex-direction:column; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-git-repository-group { display:flex; min-height:0; flex-direction:column; border-top:1px solid var(--border-default,color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-git-repository-header { display:flex; min-height:30px; align-items:center; gap:6px; padding:4px 8px; color:inherit; background:transparent; border:0; cursor:pointer; text-align:left; font-size:11px; }
    .codexhost-git-repository-header:hover { background:color-mix(in srgb,currentColor 7%,transparent); }
    .codexhost-git-repository-name { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
    .codexhost-git-repository-meta { flex:none; color:inherit; font-size:9px; opacity:.58; white-space:nowrap; }
    .codexhost-git-repository-body { display:flex; min-height:0; flex-direction:column; }
    .codexhost-git-repository-changes { display:flex; min-height:0; flex-direction:column; overflow:auto; border-top:1px solid var(--border-default,color-mix(in srgb,currentColor 7%,transparent)); }
    .codexhost-git-repository-change { box-sizing:border-box; display:grid; flex:none; grid-template-columns:minmax(0,1fr) 16px 22px; align-items:center; gap:4px; min-height:24px; padding:0 6px 0 10px; color:inherit; background:transparent; cursor:pointer; font-size:11px; }
    .codexhost-git-repository-change:hover { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-repository-change > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-git-repository-commit { display:grid; gap:5px; padding:7px 8px; border-top:1px solid var(--border-default,color-mix(in srgb,currentColor 8%,transparent)); }
    .codexhost-git-repository-error { margin:0; padding:8px 10px; color:var(--text-link,inherit); font-size:10px; line-height:1.4; }
    .codexhost-git-commit-box { display:grid; flex:none; gap:6px; padding:8px 9px; border-bottom:1px solid var(--border-default, color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-git-message { box-sizing:border-box; width:100%; min-height:64px; max-height:150px; padding:7px 8px; resize:vertical; color:inherit; background:var(--surface-secondary,transparent); border:1px solid var(--border-default, color-mix(in srgb,currentColor 15%,transparent)); border-radius:6px; font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .codexhost-git-commit-model { display:flex; min-width:0; gap:5px; }
    .codexhost-git-commit-model select { min-width:0; flex:1; padding:4px 6px; color:inherit; background:var(--surface-primary,transparent); border:1px solid var(--border-default, color-mix(in srgb,currentColor 15%,transparent)); border-radius:5px; font-size:10px; }
    .codexhost-git-commit-model button, .codexhost-git-commit-actions button { min-height:28px; padding:4px 7px; color:inherit; background:transparent; border:1px solid var(--border-default, color-mix(in srgb,currentColor 15%,transparent)); border-radius:5px; cursor:pointer; font-size:10px; }
    .codexhost-git-commit-model button:hover:not(:disabled), .codexhost-git-commit-actions button:hover:not(:disabled) { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-git-commit-actions { display:flex; flex-wrap:wrap; gap:5px; }
    .codexhost-git-commit-actions button { flex:1; white-space:nowrap; }
    .codexhost-git-commit-actions button:last-child { flex:0 0 auto; }
    .codexhost-git-commit-actions button[data-primary="true"] { color:var(--surface-primary,white); background:var(--text-primary,#111); border-color:transparent; }
    .codexhost-git-notice { min-height:0; margin:0; color:var(--text-link,inherit); font-size:10px; line-height:1.4; overflow-wrap:anywhere; }
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
  const devices = iconButton(document, "设备", "M4 5.5h16v11H4zM8.5 20h7M12 16.5V20");
  devices.setAttribute(GIT_SIDEBAR_DEVICES_ATTRIBUTE, "v1");
  const files = iconButton(document, "文件浏览器", "M4 5.5h6l1.5 2H20v11H4zM4 10h16");
  files.setAttribute(GIT_SIDEBAR_FILES_ATTRIBUTE, "v1");
  const terminal = iconButton(document, "终端", "M5 6l5 5-5 5M12 17h7");
  terminal.setAttribute(GIT_SIDEBAR_TERMINAL_ATTRIBUTE, "v1");
  rail.append(projects, commits, devices, files, terminal);
  const panel = document.createElement("div");
  panel.className = "codexhost-git-panel";
  panel.setAttribute(GIT_SIDEBAR_PANEL_ATTRIBUTE, "v1");
  panel.hidden = true;
  const head = document.createElement("div");
  head.className = "codexhost-git-head";
  const heading = document.createElement("div");
  heading.className = "codexhost-git-heading";
  const projectName = document.createElement("strong");
  projectName.className = "codexhost-git-project";
  projectName.setAttribute("data-codexhost-git-sidebar-project", "v1");
  const headText = document.createElement("span");
  headText.textContent = "提交";
  heading.append(projectName, headText);
  const refresh = iconButton(document, "刷新", "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6");
  const review = iconButton(document, "审查", "M4 4h16v16H4zM12 4v16M7 8h2M15 12h2");
  head.append(heading, review, refresh);
  const branch = document.createElement("div");
  branch.className = "codexhost-git-branch";
  // 冲突/合并进行中横幅：说明当前处于合并态并提供继续或中止；仅在有操作时显示。
  const conflictBanner = document.createElement("div");
  conflictBanner.className = "codexhost-git-conflict";
  conflictBanner.hidden = true;
  conflictBanner.setAttribute(GIT_SIDEBAR_CONFLICT_ATTRIBUTE, "v1");
  const conflictText = document.createElement("span");
  conflictText.className = "codexhost-git-conflict-text";
  const conflictActions = document.createElement("div");
  conflictActions.className = "codexhost-git-conflict-actions";
  const mergeContinue = document.createElement("button");
  mergeContinue.type = "button";
  mergeContinue.textContent = "解决并继续";
  mergeContinue.setAttribute(GIT_SIDEBAR_MERGE_CONTINUE_ATTRIBUTE, "v1");
  const mergeAbort = document.createElement("button");
  mergeAbort.type = "button";
  mergeAbort.textContent = "中止合并";
  mergeAbort.setAttribute(GIT_SIDEBAR_MERGE_ABORT_ATTRIBUTE, "v1");
  conflictActions.append(mergeContinue, mergeAbort);
  conflictBanner.append(conflictText, conflictActions);
  const workspace = document.createElement("div");
  workspace.className = "codexhost-git-workspace";
  const statusTabs = document.createElement("div");
  statusTabs.className = "codexhost-git-status-tabs";
  const changesTab = document.createElement("button");
  changesTab.type = "button";
  changesTab.className = "codexhost-git-status-tab";
  changesTab.setAttribute(GIT_SIDEBAR_CHANGES_TAB_ATTRIBUTE, "v1");
  const changesLabel = document.createElement("span");
  const changesCount = document.createElement("span");
  changesTab.append(changesLabel, changesCount);
  const stagedTab = document.createElement("button");
  stagedTab.type = "button";
  stagedTab.className = "codexhost-git-status-tab";
  stagedTab.setAttribute(GIT_SIDEBAR_STAGED_TAB_ATTRIBUTE, "v1");
  const stagedLabel = document.createElement("span");
  const stagedCount = document.createElement("span");
  stagedTab.append(stagedLabel, stagedCount);
  const treeToggle = iconButton(
    document,
    "切换目录树",
    "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  );
  treeToggle.className = "codexhost-git-tree-toggle";
  treeToggle.setAttribute(GIT_SIDEBAR_TREE_ATTRIBUTE, "v1");
  treeToggle.setAttribute("aria-pressed", "false");
  statusTabs.append(changesTab, stagedTab, treeToggle);
  const list = document.createElement("div");
  list.className = "codexhost-git-list";
  const submoduleList = document.createElement("div");
  submoduleList.className = "codexhost-git-modules";
  const submoduleTitle = document.createElement("div");
  submoduleTitle.className = "codexhost-git-modules-title";
  submoduleTitle.textContent = "模块";
  submoduleList.append(submoduleTitle);
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
  const sync = document.createElement("button");
  sync.type = "button";
  sync.textContent = "拉取并同步";
  sync.setAttribute(GIT_SIDEBAR_SYNC_ATTRIBUTE, "v1");
  commitActions.append(stageAll, commit, commitPush, push, sync);
  const notice = document.createElement("p");
  notice.className = "codexhost-git-notice";
  notice.hidden = true;
  commitBox.append(message, modelRow, commitActions, notice);
  const repositoryGroupsRoot = document.createElement("div");
  repositoryGroupsRoot.className = "codexhost-git-repository-groups";
  repositoryGroupsRoot.hidden = true;
  workspace.append(statusTabs, list, submoduleList, repositoryGroupsRoot);
  const projectSyncView = createRendererProjectSyncPanel({
    ownerDocument: document,
    container: shadow,
    getClient: () => options.getProjectSyncClient?.() ?? null,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const warnings = document.createElement("p");
  warnings.className = "codexhost-git-notice";
  warnings.style.padding = "6px 9px";
  warnings.style.whiteSpace = "pre-line";
  warnings.setAttribute("role", "status");
  warnings.setAttribute("data-codexhost-git-warnings", "v1");
  warnings.hidden = true;
  panel.append(head, branch, warnings, conflictBanner, commitBox, workspace);
  shell.append(rail, panel);
  shadow.append(style, shell);

  let anchor: SidebarAnchor | null = null;
  let view: "projects" | "commits" | "devices" = "projects";
  let current: GitWorkspaceStatus | null = null;
  let workspaceRead = false;
  let repositoryGroups: RepositoryGroup[] = [];
  let selectedChange: string | null = null;
  let changeTab: "changes" | "staged" = "changes";
  let treeView = true;
  const expandedDirectories = new Set<string>();
  const expandedRepositories = new Set<string>();
  const repositoryMessages = new Map<string, string>();
  let expansionRevision = 0;
  let renderedList: {
    status: GitWorkspaceStatus | null;
    workspaceRead: boolean;
    tab: string;
    tree: boolean;
    expansion: number;
  } | null = null;
  const cache = new RendererGitCache();
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  refresh.dataset.gitAction = "refresh";
  stageAll.dataset.gitAction = "stage-all";
  generate.dataset.gitAction = "generate";
  commit.dataset.gitAction = "commit";
  commitPush.dataset.gitAction = "commit-push";
  push.dataset.gitAction = "push";
  sync.dataset.gitAction = "sync";
  mergeContinue.dataset.gitAction = "merge-continue";
  mergeAbort.dataset.gitAction = "merge-abort";
  let selectedRepository: string | undefined;
  const requestKey = (request: RendererGitContext): string =>
    JSON.stringify([request.threadId, request.repository]);
  const pending = new WeakMap<RendererGitClient, Map<string, string>>();
  const pendingAction = (): string | undefined => {
    const request = context();
    return request.client && request.threadId
      ? pending.get(request.client)?.get(requestKey(request))
      : undefined;
  };
  const isBusy = (): boolean => pendingAction() !== undefined;
  const beginAction = (request: RendererGitContext, action: string): void => {
    if (!request.client || !request.threadId) return;
    let actions = pending.get(request.client);
    if (!actions) {
      actions = new Map();
      pending.set(request.client, actions);
    }
    actions.set(requestKey(request), action);
  };
  const finishAction = (request: RendererGitContext, repositoriesOnly = false): void => {
    if (!request.client || !request.threadId) return;
    pending.get(request.client)?.delete(requestKey(request));
    if (disposed) return;
    const active = context();
    if (
      active.client === request.client &&
      active.threadId === request.threadId &&
      active.repository === request.repository
    ) {
      current = cache.peekStatus(request.client, request.threadId, request.repository) ?? current;
      if (!modelsLoaded) void loadModels();
      if (repositoriesOnly) {
        renderRepositoryCards(repositoryGroups.filter((group) => !group.primary));
        updateBusy();
      } else {
        render();
      }
    }
  };
  let modelsLoaded = false;
  let generation = 0;
  let disposed = false;
  let reviewGeneration = 0;
  let activeContext = options.getContext();
  let contextGeneration = 0;
  const cancelReview = (): void => {
    reviewGeneration += 1;
    selectedChange = null;
    if (notice.textContent === "正在打开官方审查…") {
      setNotice("");
    }
  };

  const context = () => {
    const next = options.getContext();
    const matches =
      next.threadId === activeContext.threadId &&
      next.hostId === activeContext.hostId &&
      next.client === activeContext.client;
    return {
      ...(matches ? next : { threadId: null, hostId: null, client: null }),
      ...(selectedRepository ? { repository: selectedRepository } : {}),
      generation: contextGeneration,
    };
  };
  const contextFor = (repository: string | undefined) => {
    const next = options.getContext();
    const matches =
      next.threadId === activeContext.threadId &&
      next.hostId === activeContext.hostId &&
      next.client === activeContext.client;
    return {
      ...(matches ? next : { threadId: null, hostId: null, client: null }),
      ...(repository ? { repository } : {}),
      generation: contextGeneration,
    };
  };
  const isCurrentRequest = (request: ReturnType<typeof context>): boolean => {
    const active = options.getContext();
    return (
      !disposed &&
      request.generation === contextGeneration &&
      request.threadId === active.threadId &&
      request.hostId === active.hostId &&
      request.client === active.client
    );
  };
  const resetGitView = (): void => {
    contextGeneration += 1;
    generation += 1;
    cancelReview();
    workspaceRead = false;
    current =
      activeContext.client && activeContext.threadId
        ? cache.peekStatus(activeContext.client, activeContext.threadId, selectedRepository)
        : null;
    modelsLoaded = false;
    model.replaceChildren();
    message.value = "";
    changeTab = "changes";
    expandedDirectories.clear();
    expansionRevision += 1;
    setNotice("");
    render();
  };
  const syncContext = (): boolean => {
    const next = options.getContext();
    repositorySelector.syncContext();
    if (
      next.threadId === activeContext.threadId &&
      next.hostId === activeContext.hostId &&
      next.client === activeContext.client
    )
      return false;
    activeContext = next;
    selectedRepository = undefined;
    resetGitView();
    return true;
  };

  const syncOfficialPanelState = (): void => {
    for (const [panel, button] of [
      ["terminal", terminal],
      ["files", files],
    ] as const) {
      const target = officialPanelButton(document, panel);
      button.setAttribute("aria-pressed", String(target?.getAttribute("aria-pressed") === "true"));
      button.title =
        target || panel === "files"
          ? (button.getAttribute("aria-label") ?? "")
          : `${button.getAttribute("aria-label") ?? ""}（不可用）`;
    }
  };

  const renderRepositoryCards = (childGroups: RepositoryGroup[]): void => {
    repositoryGroupsRoot.replaceChildren();
    repositoryGroupsRoot.hidden = childGroups.length === 0;
    for (const group of childGroups) {
      const card = document.createElement("section");
      card.className = "codexhost-git-repository-group";
      card.dataset.repository = group.path;
      const header = document.createElement("button");
      header.type = "button";
      header.className = "codexhost-git-repository-header";
      const repositoryName = group.path?.split(/[/\\]/u).filter(Boolean).at(-1) ?? "子模块";
      header.setAttribute("aria-label", `展开子模块 ${repositoryName}`);
      const name = document.createElement("span");
      name.className = "codexhost-git-repository-name";
      name.textContent = repositoryName;
      name.title = group.path ?? "";
      const meta = document.createElement("span");
      meta.className = "codexhost-git-repository-meta";
      meta.textContent = group.loading
        ? "读取中…"
        : group.error
          ? "读取失败"
          : group.status?.branch
            ? `${group.status.branch} · ${group.status.changes.length} 项变更 · ${group.status.ahead}↑ ${group.status.behind}↓`
            : "未初始化";
      header.append(name, meta);
      header.addEventListener(
        "click",
        () => {
          const repository = group.path ?? "";
          if (expandedRepositories.has(repository)) expandedRepositories.delete(repository);
          else expandedRepositories.add(repository);
          renderRepositoryCards(childGroups);
        },
        listenerOptions,
      );
      card.append(header);
      if (!expandedRepositories.has(group.path ?? "")) {
        header.setAttribute("aria-expanded", "false");
        repositoryGroupsRoot.append(card);
        continue;
      }
      header.setAttribute("aria-expanded", "true");
      const body = document.createElement("div");
      body.className = "codexhost-git-repository-body";
      if (group.error) {
        const error = document.createElement("p");
        error.className = "codexhost-git-repository-error";
        error.textContent = group.error;
        body.append(error);
      } else {
        const changes = document.createElement("div");
        changes.className = "codexhost-git-repository-changes";
        const groupChanges = group.status?.changes ?? [];
        if (!group.status) {
          const empty = document.createElement("p");
          empty.className = "codexhost-git-empty";
          empty.textContent = "尚未读取子模块状态。";
          changes.append(empty);
        } else if (!groupChanges.length) {
          const empty = document.createElement("p");
          empty.className = "codexhost-git-empty";
          empty.textContent = "没有待提交的变更";
          changes.append(empty);
        } else {
          for (const change of groupChanges) {
            const row = document.createElement("div");
            row.className = "codexhost-git-repository-change";
            row.dataset.path = change.path;
            row.dataset.repository = group.path;
            row.title = change.path;
            const copy = document.createElement("span");
            copy.textContent = change.path;
            const status = document.createElement("span");
            status.className = "codexhost-git-status";
            status.textContent = change.staged ? "S" : change.untracked ? "U" : "M";
            const stage = iconButton(
              document,
              change.staged ? "取消暂存" : "暂存",
              change.staged ? "M5 12h14" : "M12 5v14M5 12h14",
            );
            stage.className = "codexhost-git-change-action";
            stage.disabled = isBusy();
            stage.addEventListener("click", (event) => {
              event.stopPropagation();
              void updateStaged(change.path, !change.staged, group.path);
            });
            row.append(copy, status, stage);
            row.addEventListener(
              "click",
              () => void openDiff(change.path, group.path),
              listenerOptions,
            );
            changes.append(row);
          }
        }
        body.append(changes);
        const commit = document.createElement("div");
        commit.className = "codexhost-git-repository-commit";
        const message = document.createElement("textarea");
        message.className = "codexhost-git-message";
        message.rows = 2;
        message.placeholder = "填写提交消息；AI 生成后仍可编辑。";
        message.setAttribute("aria-label", `${name.textContent} 提交消息`);
        message.value = repositoryMessages.get(group.path ?? "") ?? "";
        message.addEventListener("input", () => {
          repositoryMessages.set(group.path ?? "", message.value);
          updateBusy();
        });
        const actions = document.createElement("div");
        actions.className = "codexhost-git-commit-actions";
        const stageAll = document.createElement("button");
        stageAll.type = "button";
        stageAll.textContent = "全部暂存";
        stageAll.disabled =
          isBusy() || !group.status?.changes.some((change) => !change.conflicted && !change.staged);
        stageAll.addEventListener("click", () => {
          if (!group.path || !group.status) return;
          const paths = group.status.changes
            .filter((change) => !change.conflicted && !change.staged)
            .map((change) => change.path);
          if (paths.length) void stagePaths(group.path, paths);
        });
        const commitButton = document.createElement("button");
        commitButton.type = "button";
        commitButton.textContent = "提交";
        commitButton.dataset.primary = "true";
        commitButton.disabled = isBusy() || !group.status?.changes.length;
        commitButton.addEventListener("click", () => void submit(false, group.path, message.value));
        const pushButton = document.createElement("button");
        pushButton.type = "button";
        pushButton.textContent = "推送";
        pushButton.disabled = isBusy() || !group.status;
        pushButton.addEventListener("click", () => {
          if (group.path) void pushRepository(group.path);
        });
        actions.append(stageAll, commitButton, pushButton);
        commit.append(message, actions);
        body.append(commit);
      }
      card.append(body);
      repositoryGroupsRoot.append(card);
    }
  };

  const stagePaths = async (repository: string, paths: string[]): Promise<void> => {
    const request = contextFor(repository);
    if (!request.threadId || !request.client || isBusy() || paths.length === 0) return;
    generation += 1;
    beginAction(request, "stage-all");
    setNotice("");
    render();
    try {
      const status = await request.client.stageGitPaths({
        threadId: request.threadId,
        ...(repository ? { repository } : {}),
        paths,
      });
      cache.update(request.client, request.threadId, status, repository);
      if (!isCurrentRequest(request)) return;
      const group = repositoryGroups.find((entry) => entry.path === repository);
      if (group) group.status = status;
      setNotice("已暂存全部变更。");
    } catch (error) {
      if (isCurrentRequest(request))
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      finishAction(request);
    }
  };

  const pushRepository = async (repository: string): Promise<void> => {
    const request = contextFor(repository);
    if (!request.threadId || !request.client || isBusy()) return;
    generation += 1;
    beginAction(request, "push");
    setNotice("正在推送…");
    render();
    try {
      const status = await request.client.pushGit({
        threadId: request.threadId,
        ...(repository ? { repository } : {}),
      });
      cache.update(request.client, request.threadId, status, repository);
      if (!isCurrentRequest(request)) return;
      const group = repositoryGroups.find((entry) => entry.path === repository);
      if (group) group.status = status;
      setNotice("已推送。");
    } catch (error) {
      if (isCurrentRequest(request))
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      finishAction(request, true);
    }
  };

  const render = (repositoriesOnly = false): void => {
    if (!anchor) return;
    anchor.content.hidden = view !== "projects";
    panel.hidden = view === "projects";
    if (view === "projects") projects.setAttribute("aria-current", "page");
    else projects.removeAttribute("aria-current");
    if (view === "devices") devices.setAttribute("aria-current", "page");
    else devices.removeAttribute("aria-current");
    if (view === "commits") commits.setAttribute("aria-current", "page");
    else commits.removeAttribute("aria-current");
    if (view === "projects") {
      projectSyncView.deactivate();
      syncOfficialPanelState();
      updateBusy();
      return;
    }
    if (view === "devices") {
      anchor.content.hidden = true;
      panel.hidden = true;
      projectSyncView.activate();
      syncOfficialPanelState();
      return;
    }
    projectSyncView.deactivate();
    head.hidden = false;
    branch.hidden = false;
    headText.textContent = "提交";
    const workspacePath = current?.workspace ?? "";
    projectName.textContent = workspacePath
      ? (workspacePath.split(/[/\\]/u).filter(Boolean).at(-1) ?? workspacePath)
      : context().threadId
        ? workspaceRead
          ? "未检测到工作区"
          : "正在读取项目…"
        : "未选择项目";
    projectName.title = workspacePath;
    workspace.hidden = false;
    commitBox.hidden = false;
    branch.textContent = current?.branch
      ? `${current.branch} · ${current.ahead}↑ ${current.behind}↓`
      : context().threadId
        ? "未检测到工作区"
        : "未选择项目";
    warnings.textContent = current?.warnings?.join("\n") ?? "";
    warnings.hidden = !warnings.textContent;
    const operation = current?.operation ?? null;
    const conflicts = current?.conflicts ?? [];
    conflictBanner.hidden = operation === null;
    if (operation !== null) {
      const label = operation === "rebase" ? "变基" : "合并";
      conflictText.textContent =
        conflicts.length > 0
          ? `${label}进行中：${conflicts.length} 个冲突文件待解决。把冲突交给 AI 解决后回到此处继续。`
          : `${label}进行中：冲突已解决，可继续完成${label}。`;
      mergeContinue.disabled = isBusy() || conflicts.length > 0;
      mergeAbort.disabled = isBusy();
    }
    if (
      !repositoriesOnly &&
      renderedList?.status === current &&
      renderedList.workspaceRead === workspaceRead &&
      renderedList.tab === changeTab &&
      renderedList.tree === treeView &&
      renderedList.expansion === expansionRevision
    ) {
      updateBusy();
      return;
    }
    if (!repositoriesOnly) {
      renderedList = {
        status: current,
        workspaceRead,
        tab: changeTab,
        tree: treeView,
        expansion: expansionRevision,
      };
      list.replaceChildren();
      submoduleList.replaceChildren(submoduleTitle);
    }
    repositoryGroupsRoot.replaceChildren();
    const childGroups = repositoryGroups.filter((group) => !group.primary);
    repositoryGroupsRoot.hidden = childGroups.length === 0;
    const entries = current?.changes ?? [];
    const unstaged = entries.filter((change) => !change.staged || change.unstaged);
    const staged = entries.filter((change) => change.staged);
    const activeChanges = changeTab === "staged" ? staged : unstaged;
    changesLabel.textContent = "变更";
    stagedLabel.textContent = "已暂存";
    changesCount.textContent = String(unstaged.length);
    stagedCount.textContent = String(staged.length);
    changesTab.setAttribute("aria-selected", String(changeTab === "changes"));
    stagedTab.setAttribute("aria-selected", String(changeTab === "staged"));
    treeToggle.setAttribute("aria-pressed", String(treeView));
    submoduleList.hidden = !treeView;
    const renderChange = (
      change: GitChange,
      container: HTMLElement,
      action: "stage" | "unstage",
      displayPath = change.path,
    ): void => {
      const row = document.createElement("div");
      row.className = "codexhost-git-change";
      row.dataset.path = change.path;
      row.setAttribute("aria-selected", String(selectedChange === change.path));
      row.title = change.originalPath ? `${change.originalPath} → ${change.path}` : change.path;
      const name = document.createElement("span");
      name.textContent = change.submodule ? `${displayPath} · 子模块` : displayPath;
      const status = document.createElement("span");
      status.className = "codexhost-git-status";
      const statusInfo = gitChangeStatus(change, action);
      status.textContent = statusInfo.code;
      status.title = statusInfo.label;
      status.setAttribute("aria-label", statusInfo.label);
      const actionButton = iconButton(
        document,
        action === "stage" ? "暂存" : "取消暂存",
        action === "stage" ? "M12 5v14M5 12h14" : "M5 12h14",
      );
      actionButton.className = "codexhost-git-change-action";
      actionButton.dataset.action = action;
      actionButton.dataset.gitAction = `${action}:${change.path}`;
      actionButton.disabled = isBusy();
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
    const renderDirectory = (
      directory: GitDirectory,
      container: HTMLElement,
      depth: number,
    ): void => {
      const children = [...directory.directories.values()].sort((left, right) =>
        left.name.localeCompare(right.name, "zh-CN", { numeric: true }),
      );
      for (const child of children) {
        const collapsed = !expandedDirectories.has(child.path);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "codexhost-git-directory";
        row.title = child.path;
        row.style.paddingLeft = `${8 + depth * 12}px`;
        row.setAttribute("aria-expanded", String(!collapsed));
        const icon = document.createElement("span");
        icon.textContent = collapsed ? "▸" : "▾";
        const name = document.createElement("span");
        name.className = "codexhost-git-directory-name";
        name.textContent = child.name;
        const badge = document.createElement("span");
        badge.className = "codexhost-git-directory-count";
        badge.textContent = String(child.count);
        row.append(icon, name, badge);
        row.addEventListener(
          "click",
          () => {
            if (collapsed) expandedDirectories.add(child.path);
            else expandedDirectories.delete(child.path);
            expansionRevision += 1;
            render();
          },
          listenerOptions,
        );
        container.append(row);
        if (!collapsed) renderDirectory(child, container, depth + 1);
      }
      const changes = [...directory.changes].sort((left, right) =>
        (left.originalPath ?? left.path).localeCompare(right.originalPath ?? right.path, "zh-CN", {
          numeric: true,
        }),
      );
      for (const change of changes) {
        const action = changeTab === "staged" ? "unstage" : "stage";
        const displayPath = directory.path
          ? change.path.slice(directory.path.length + 1)
          : change.path;
        renderChange(change, container, action, displayPath);
      }
    };
    if (!workspaceRead && context().threadId) {
      const loading = document.createElement("p");
      loading.className = "codexhost-git-empty";
      loading.textContent = "正在读取项目…";
      list.append(loading);
    } else if (!activeChanges.length) {
      const empty = document.createElement("p");
      empty.className = "codexhost-git-empty";
      empty.textContent = changeTab === "staged" ? "没有已暂存文件" : "没有待提交的变更";
      list.append(empty);
    } else if (treeView) {
      renderDirectory(buildGitTree(activeChanges), list, 0);
    } else {
      for (const change of activeChanges) {
        renderChange(change, list, changeTab === "staged" ? "unstage" : "stage");
      }
    }
    for (const submodule of current?.submodules ?? []) {
      const row = document.createElement("div");
      row.className = "codexhost-git-submodule";
      const copy = document.createElement("span");
      copy.textContent = `${submodule.path} · ${submodule.status}`;
      const update = document.createElement("button");
      update.type = "button";
      update.textContent = submodule.status === "uninitialized" ? "初始化" : "更新";
      update.dataset.gitAction = `submodule:${submodule.path}`;
      update.dataset.current = String(submodule.status === "current");
      update.disabled =
        isBusy() || submodule.status === "current" || !context().client?.updateGitSubmodule;
      update.addEventListener(
        "click",
        () => void updateSubmodule(submodule.path, submodule.status === "uninitialized"),
        listenerOptions,
      );
      row.append(copy, update);
      submoduleList.append(row);
    }
    renderRepositoryCards(childGroups);
    syncOfficialPanelState();
    updateBusy();
  };

  const openDiff = async (pathValue: string, repository = selectedRepository): Promise<void> => {
    const request = contextFor(repository);
    if (!request.threadId || !request.hostId) return;
    const requestGeneration = ++reviewGeneration;
    const isCurrent = () => isCurrentRequest(request) && requestGeneration === reviewGeneration;
    selectedChange = pathValue;
    render();
    setNotice("正在打开官方审查…");
    try {
      const result = await openNativeGitReview(
        document,
        {
          threadId: request.threadId,
          hostId: request.hostId,
          ...(repository ? { repository } : {}),
          path: pathValue,
          staged: changeTab === "staged",
        },
        isCurrent,
      );
      if (isCurrent()) {
        setNotice(
          result === "path-unavailable" ? `已打开官方审查，请在文件树中选择 ${pathValue}。` : "",
        );
      }
    } catch (error) {
      if (isCurrent()) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const setNotice = (value: string): void => {
    notice.textContent = value;
    notice.hidden = value.length === 0;
  };

  const repositorySelector = createGitRepositorySelector({
    getContext: options.getContext,
    onSelect(repository) {
      if (selectedRepository === repository) return;
      selectedRepository = repository;
      resetGitView();
      void load();
    },
    onNotice: setNotice,
  });
  head.after(repositorySelector.root);

  const syncNotice = (result: GitSyncResult): string => {
    switch (result.strategy) {
      case "up-to-date":
        return "远端没有新的提交，已是最新。";
      case "fast-forward":
        return `已快进合入远端 ${result.behind} 个提交。`;
      case "merged":
        return `已合并远端 ${result.behind} 个提交。`;
      case "conflict":
        return `同步产生冲突，${result.conflicts.length} 个文件需要解决；交给 AI 解决后在本面板继续合并。`;
    }
  };

  function updateBusy(): void {
    const client = context().client;
    const hasCommittable = current?.changes.some((change) => !change.conflicted) ?? false;
    stageAll.disabled =
      isBusy() || !client || !(current?.changes.some((change) => !change.conflicted) ?? false);
    generate.disabled = isBusy() || !client || !modelsLoaded || !model.value;
    commit.disabled = isBusy() || !client || !hasCommittable;
    commitPush.disabled = commit.disabled;
    push.disabled = isBusy() || !client;
    sync.disabled = isBusy() || !client?.syncGit;
    model.disabled = isBusy() || !modelsLoaded;
    refresh.disabled = isBusy() || !client;
    mergeContinue.disabled =
      isBusy() || !client?.continueGitMerge || (current?.conflicts?.length ?? 0) > 0;
    mergeAbort.disabled = isBusy() || !client?.abortGitMerge;
    repositorySelector.setBusy(isBusy());
    for (const button of shadow.querySelectorAll<HTMLButtonElement>("button[data-git-action]")) {
      button.setAttribute("aria-busy", String(button.dataset.gitAction === pendingAction()));
    }
    for (const row of list.querySelectorAll<HTMLElement>(".codexhost-git-change")) {
      row.setAttribute("aria-selected", String(row.dataset.path === selectedChange));
      const action = row.querySelector<HTMLButtonElement>("button");
      if (action) action.disabled = isBusy() || !client;
    }
    for (const button of submoduleList.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled =
        isBusy() || !client?.updateGitSubmodule || button.dataset.current === "true";
    }
  }

  const loadModels = async (): Promise<void> => {
    const request = context();
    if (!request.threadId || !request.client) return;
    try {
      const result = await cache.models(request.client, request.threadId, request.repository);
      if (!isCurrentRequest(request)) return;
      model.replaceChildren();
      for (const item of result.models.filter((candidate) => candidate.eligible)) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.recommended ? "★ " : ""}${item.label}`;
        model.append(option);
      }
      if (result.defaultModel) model.value = result.defaultModel;
      modelsLoaded = model.childElementCount > 0;
      if (!modelsLoaded) setNotice("没有可用的提交消息模型");
    } catch (error) {
      if (!isCurrentRequest(request)) return;
      modelsLoaded = false;
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (isCurrentRequest(request)) updateBusy();
    }
  };

  const updateStaged = async (
    pathValue: string,
    stage: boolean,
    repository = selectedRepository,
  ): Promise<void> => {
    const request = contextFor(repository);
    if (!request.threadId || !request.client || isBusy()) return;
    generation += 1;
    beginAction(request, stage ? `stage:${pathValue}` : `unstage:${pathValue}`);
    setNotice("");
    render();
    try {
      const status = await (stage ? request.client.stageGitPaths : request.client.unstageGitPaths)({
        threadId: request.threadId,
        ...(request.repository ? { repository: request.repository } : {}),
        paths: [pathValue],
      });
      cache.update(request.client, request.threadId, status, request.repository);
      if (!isCurrentRequest(request)) return;
      if (repository === selectedRepository) current = status;
      const group = repositoryGroups.find((entry) => entry.path === repository);
      if (group) group.status = status;
      setNotice(stage ? "已暂存文件。" : "已取消暂存。");
    } catch (error) {
      if (!isCurrentRequest(request)) return;
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      finishAction(request);
    }
  };

  const submit = async (
    pushAfterCommit: boolean,
    repository = selectedRepository,
    commitMessage = message.value,
  ): Promise<void> => {
    const request = contextFor(repository);
    if (isBusy()) return;
    if (!request.threadId || !request.client) {
      setNotice("未选择可用的 Git 工作区。");
      render();
      return;
    }
    if (!commitMessage.trim()) {
      setNotice("请填写提交消息，或先使用 AI 生成。");
      render();
      return;
    }
    const status =
      repository === selectedRepository
        ? current
        : (repositoryGroups.find((group) => group.path === repository)?.status ?? null);
    const stagedPaths =
      status?.changes
        .filter((change) => change.staged && !change.conflicted)
        .map((change) => change.path) ?? [];
    const paths =
      stagedPaths.length > 0
        ? stagedPaths
        : (status?.changes.filter((change) => !change.conflicted).map((change) => change.path) ??
          []);
    if (paths.length === 0) {
      setNotice("没有可提交的变更。");
      render();
      return;
    }
    generation += 1;
    beginAction(request, pushAfterCommit ? "commit-push" : "commit");
    setNotice(
      pushAfterCommit
        ? `正在提交${stagedPaths.length > 0 ? "已暂存" : "当前"}变更并推送…`
        : `正在提交${stagedPaths.length > 0 ? "已暂存" : "当前"}变更…`,
    );
    render();
    try {
      if (stagedPaths.length === 0) {
        const staged = await request.client.stageGitPaths({
          threadId: request.threadId,
          ...(request.repository ? { repository: request.repository } : {}),
          paths,
        });
        cache.update(request.client, request.threadId, staged, request.repository);
        if (isCurrentRequest(request)) {
          if (repository === selectedRepository) current = staged;
          const group = repositoryGroups.find((entry) => entry.path === repository);
          if (group) group.status = staged;
        }
      }
      if (!isCurrentRequest(request)) return;
      const result = await request.client.commitGit({
        threadId: request.threadId,
        ...(request.repository ? { repository: request.repository } : {}),
        message: commitMessage,
        // 已显式暂存目标文件；提交索引，避免 pathspec 提交绕过暂存区语义。
        paths: [],
        push: pushAfterCommit,
      });
      cache.update(request.client, request.threadId, result.status, request.repository);
      if (!isCurrentRequest(request)) return;
      if (repository === selectedRepository) current = result.status;
      const group = repositoryGroups.find((entry) => entry.path === repository);
      if (group) group.status = result.status;
      cancelReview();
      expandedDirectories.clear();
      expansionRevision += 1;
      message.value = "";
      repositoryMessages.set(repository ?? "", "");
      const pushed = pushAfterCommit || result.pushed;
      const commitLabel = result.commit ? ` (${result.commit})` : "";
      setNotice((pushed ? `已提交${commitLabel}并推送。` : `已提交${commitLabel}。`).trim());
    } catch (error) {
      if (!isCurrentRequest(request)) return;
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      finishAction(request);
    }
  };

  const load = async (force = false): Promise<void> => {
    syncContext();
    if (disposed || view === "devices" || isBusy()) return;
    const request = context();
    if (!request.threadId || !request.client) {
      workspaceRead = false;
      current = null;
      repositoryGroups = [];
      render();
      return;
    }
    const requestGeneration = ++generation;
    workspaceRead = false;
    if (force) cache.invalidate(request.client);
    current = cache.peekStatus(request.client, request.threadId, request.repository);
    repositoryGroups = [
      {
        path: request.repository,
        primary: true,
        status: current,
        loading: true,
        error: null,
      },
    ];
    beginAction(request, "refresh");
    render();
    try {
      const client = request.client;
      const threadId = request.threadId;
      const status = await cache.status(client, threadId, request.repository);
      if (!isCurrentRequest(request) || requestGeneration !== generation) return;
      workspaceRead = true;
      current = status;
      const submodules: RepositoryGroup[] = status.submodules.map((submodule) => {
        const child = pathJoin(status.workspace, submodule.path);
        return {
          path: child,
          primary: false,
          status: cache.peekStatus(client, threadId, child),
          loading: submodule.status !== "uninitialized",
          error: null,
        };
      });
      repositoryGroups = [
        { path: request.repository, primary: true, status, loading: false, error: null },
        ...submodules,
      ];
      render();
      await Promise.all(
        submodules.map(async (group) => {
          if (!group.loading || !group.path) return;
          try {
            const childStatus = await cache.status(client, threadId, group.path);
            if (isCurrentRequest(request) && requestGeneration === generation) {
              group.status = childStatus;
            }
          } catch (error) {
            if (isCurrentRequest(request) && requestGeneration === generation) {
              group.error = error instanceof Error ? error.message : String(error);
            }
          } finally {
            if (isCurrentRequest(request) && requestGeneration === generation) {
              group.loading = false;
              render(true);
            }
          }
        }),
      );
    } catch (error) {
      if (!isCurrentRequest(request) || requestGeneration !== generation) return;
      workspaceRead = true;
      current = null;
      repositoryGroups = [];
      setNotice(error instanceof Error ? error.message : String(error));
      render();
    } finally {
      finishAction(request, true);
    }
  };

  const updateSubmodule = async (pathValue: string, initialize: boolean): Promise<void> => {
    const request = context();
    const client = request.client;
    const threadId = request.threadId as HostThreadId | null;
    const update = client?.updateGitSubmodule;
    if (!threadId || !update || isBusy()) return;
    generation += 1;
    beginAction(request, `submodule:${pathValue}`);
    updateBusy();
    render();
    try {
      const status = await update({
        threadId,
        path: pathValue,
        init: initialize,
        ...(request.repository ? { repository: request.repository } : {}),
      });
      if (client) cache.update(client, threadId, status, request.repository);
      if (!isCurrentRequest(request)) return;
      current = status;
    } catch (error) {
      if (isCurrentRequest(request))
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      finishAction(request);
    }
  };

  projects.addEventListener(
    "click",
    () => {
      cancelReview();
      view = "projects";
      render();
    },
    listenerOptions,
  );
  changesTab.addEventListener(
    "click",
    () => {
      cancelReview();
      changeTab = "changes";
      render();
    },
    listenerOptions,
  );
  stagedTab.addEventListener(
    "click",
    () => {
      cancelReview();
      changeTab = "staged";
      render();
    },
    listenerOptions,
  );
  treeToggle.addEventListener(
    "click",
    () => {
      treeView = !treeView;
      render();
    },
    listenerOptions,
  );
  commits.addEventListener(
    "click",
    () => {
      cancelReview();
      view = "commits";
      render();
      void load();
    },
    listenerOptions,
  );
  devices.addEventListener(
    "click",
    () => {
      cancelReview();
      view = "devices";
      render();
      projectSyncView.refresh();
    },
    listenerOptions,
  );
  files.addEventListener(
    "click",
    () => {
      cancelReview();
      view = "projects";
      render();
      const target = officialPanelButton(document, "files");
      if (target) target.click();
      else runNativeWorkspaceCommand(document, "toggleFileTreePanel");
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
  review.addEventListener("click", () => void openDiff(""), listenerOptions);
  refresh.addEventListener(
    "click",
    () => {
      if (isBusy()) return;
      cancelReview();
      setNotice("");
      void load(true);
    },
    listenerOptions,
  );
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
      if (!request.threadId || !request.client || !current || isBusy()) return;
      const paths = current.changes
        .filter((change) => !change.conflicted && (!change.staged || change.unstaged))
        .map((change) => change.path);
      if (!paths.length) return;
      generation += 1;
      beginAction(request, "stage-all");
      setNotice("");
      render();
      void request.client
        .stageGitPaths({
          threadId: request.threadId,
          ...(request.repository ? { repository: request.repository } : {}),
          paths,
        })
        .then((status) => {
          if (request.client && request.threadId)
            cache.update(request.client, request.threadId, status, request.repository);
          if (!isCurrentRequest(request)) return;
          current = status;
          setNotice("已暂存全部变更。");
        })
        .catch((error) => {
          if (isCurrentRequest(request))
            setNotice(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          finishAction(request);
        });
    },
    listenerOptions,
  );
  generate.addEventListener(
    "click",
    () => {
      const request = context();
      if (!request.threadId || !request.client || !model.value || isBusy()) return;
      generation += 1;
      beginAction(request, "generate");
      setNotice("正在生成提交消息…");
      render();
      void request.client
        .generateGitMessage({
          threadId: request.threadId,
          ...(request.repository ? { repository: request.repository } : {}),
          model: model.value,
          paths:
            current?.changes.filter((change) => change.staged).map((change) => change.path) ?? [],
        })
        .then((result) => {
          if (!isCurrentRequest(request)) return;
          message.value = result.message;
          setNotice(`已使用 ${result.model} 生成提交消息。`);
        })
        .catch((error) => {
          if (isCurrentRequest(request))
            setNotice(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          finishAction(request);
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
      if (!request.threadId || !request.client || isBusy()) return;
      generation += 1;
      beginAction(request, "push");
      setNotice("正在推送…");
      render();
      void request.client
        .pushGit({
          threadId: request.threadId,
          ...(request.repository ? { repository: request.repository } : {}),
        })
        .then((status) => {
          if (request.client && request.threadId)
            cache.update(request.client, request.threadId, status, request.repository);
          if (!isCurrentRequest(request)) return;
          current = status;
          cancelReview();
          expandedDirectories.clear();
          expansionRevision += 1;
          setNotice("已推送。");
        })
        .catch((error) => {
          if (isCurrentRequest(request))
            setNotice(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          finishAction(request);
        });
    },
    listenerOptions,
  );

  // 拉取并同步：远端有新提交时快进或合并；发生冲突时保留合并态并提示交给 AI 解决。
  sync.addEventListener(
    "click",
    () => {
      const request = context();
      const client = request.client;
      if (!request.threadId || !client?.syncGit || isBusy()) return;
      generation += 1;
      beginAction(request, "sync");
      setNotice("正在拉取并同步…");
      render();
      void client
        .syncGit({
          threadId: request.threadId,
          ...(request.repository ? { repository: request.repository } : {}),
        })
        .then((result) => {
          if (client && request.threadId)
            cache.update(client, request.threadId, result.status, request.repository);
          if (!isCurrentRequest(request)) return;
          current = result.status;
          cancelReview();
          expandedDirectories.clear();
          expansionRevision += 1;
          setNotice(syncNotice(result));
        })
        .catch((error) => {
          if (isCurrentRequest(request))
            setNotice(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          finishAction(request);
        });
    },
    listenerOptions,
  );

  const finishOperation = async (
    run: () => Promise<GitWorkspaceStatus>,
    pending: string,
    done: string,
    action: string,
  ): Promise<void> => {
    const request = context();
    const client = request.client;
    if (!request.threadId || !client || isBusy()) return;
    generation += 1;
    beginAction(request, action);
    setNotice(pending);
    render();
    try {
      const status = await run();
      cache.update(client, request.threadId, status, request.repository);
      if (!isCurrentRequest(request)) return;
      current = status;
      cancelReview();
      expandedDirectories.clear();
      expansionRevision += 1;
      setNotice(done);
    } catch (error) {
      if (isCurrentRequest(request))
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      finishAction(request);
    }
  };
  mergeContinue.addEventListener(
    "click",
    () => {
      const client = context().client;
      const threadId = context().threadId;
      const continueMerge = client?.continueGitMerge;
      if (!continueMerge || !threadId) return;
      void finishOperation(
        () =>
          continueMerge.call(client, {
            threadId,
            ...(selectedRepository ? { repository: selectedRepository } : {}),
          }),
        "正在完成合并…",
        "合并已完成。",
        "merge-continue",
      );
    },
    listenerOptions,
  );
  mergeAbort.addEventListener(
    "click",
    () => {
      const client = context().client;
      const threadId = context().threadId;
      const abortMerge = client?.abortGitMerge;
      if (!abortMerge || !threadId) return;
      void finishOperation(
        () =>
          abortMerge.call(client, {
            threadId,
            ...(selectedRepository ? { repository: selectedRepository } : {}),
          }),
        "正在中止…",
        "已中止合并。",
        "merge-abort",
      );
    },
    listenerOptions,
  );

  const mount = (): void => {
    if (disposed) return;
    const next = sidebarAnchor(document);
    if (!next) {
      cancelReview();
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
  const warmCache = (): void => {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => void load(), 250);
  };
  warmCache();
  return {
    syncContext() {
      if (syncContext()) {
        if (view === "projects") warmCache();
        else void load();
      }
    },
    refresh() {
      syncContext();
      if (view === "devices") projectSyncView.refresh();
      if (view !== "projects" && view !== "devices") void load();
    },
    dispose() {
      disposed = true;
      clearTimeout(warmTimer);
      cache.clear();
      observer.disconnect();
      projectSyncView.dispose();
      repositorySelector.dispose();
      if (anchor) restoreSidebarAnchor(anchor);
      root.remove();
      anchor = null;
    },
  };
}
