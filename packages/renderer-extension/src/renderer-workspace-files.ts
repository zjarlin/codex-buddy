import type {
  HostThreadId,
  WorkspaceFileEntry,
  WorkspaceFileReadParams,
  WorkspaceFileReadResult,
  WorkspaceFilesListParams,
  WorkspaceFilesListResult,
} from "@codexhost/shared-contracts";

export interface RendererWorkspaceFilesClient {
  listWorkspaceFiles?(input: WorkspaceFilesListParams): Promise<WorkspaceFilesListResult>;
  readWorkspaceFile?(input: WorkspaceFileReadParams): Promise<WorkspaceFileReadResult>;
}

export interface RendererWorkspaceFilesContext {
  threadId: HostThreadId | null;
  client: RendererWorkspaceFilesClient | null;
}

export interface RendererWorkspaceFilesView {
  readonly panel: HTMLElement;
  activate(): void;
  deactivate(): void;
  refresh(): void;
  dispose(): void;
}

export const WORKSPACE_FILES_PANEL_ATTRIBUTE = "data-codexhost-workspace-files-panel";
export const WORKSPACE_FILE_ENTRY_ATTRIBUTE = "data-codexhost-workspace-file-entry";
export const WORKSPACE_FILE_REFRESH_ATTRIBUTE = "data-codexhost-workspace-file-refresh";
export const WORKSPACE_FILE_PREVIEW_ATTRIBUTE = "data-codexhost-workspace-file-preview";
export const WORKSPACE_FILE_PREVIEW_CLOSE_ATTRIBUTE = "data-codexhost-workspace-file-preview-close";

const MAIN_SURFACE_SELECTOR = '[data-app-shell-main-surface="default"]';
const APP_HEADER_SELECTOR = 'header[data-pip-obstacle="app-shell-header"]';

interface DirectoryState {
  expanded: boolean;
  loading: boolean;
  entries: WorkspaceFileEntry[];
  error: string | null;
  truncated: boolean;
}

function iconButton(ownerDocument: Document, label: string, pathValue: string): HTMLButtonElement {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shape = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", pathValue);
  svg.append(shape);
  button.append(svg);
  return button;
}

function formatBytes(value: number | null): string {
  if (value === null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function createRendererWorkspaceFilesView(options: {
  ownerDocument: Document;
  container: ShadowRoot | HTMLElement;
  getContext(): RendererWorkspaceFilesContext;
  signal?: AbortSignal;
}): RendererWorkspaceFilesView {
  const document = options.ownerDocument;
  const ownerWindow = document.defaultView ?? window;
  const directories = new Map<string, DirectoryState>();
  const panel = document.createElement("section");
  panel.className = "codexhost-files-panel";
  panel.setAttribute(WORKSPACE_FILES_PANEL_ATTRIBUTE, "v1");
  panel.hidden = true;
  const head = document.createElement("div");
  head.className = "codexhost-files-head";
  const title = document.createElement("strong");
  title.textContent = "文件";
  const workspaceLabel = document.createElement("span");
  workspaceLabel.className = "codexhost-files-workspace";
  const refresh = iconButton(document, "刷新文件浏览器", "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6");
  refresh.setAttribute(WORKSPACE_FILE_REFRESH_ATTRIBUTE, "v1");
  head.append(title, workspaceLabel, refresh);
  const status = document.createElement("div");
  status.className = "codexhost-files-status";
  const tree = document.createElement("div");
  tree.className = "codexhost-files-tree";
  tree.setAttribute("role", "tree");
  panel.append(head, status, tree);

  const preview = document.createElement("div");
  preview.setAttribute(WORKSPACE_FILE_PREVIEW_ATTRIBUTE, "v1");
  const previewShadow = preview.attachShadow({ mode: "open" });
  const previewStyle = document.createElement("style");
  previewStyle.textContent = `
    :host { display:none; position:fixed; z-index:50; overflow:hidden; color:var(--text-primary,#111); background:var(--surface-primary,#fff); border:1px solid var(--border-default,color-mix(in srgb,currentColor 15%,transparent)); box-shadow:0 12px 32px rgb(0 0 0 / 16%); font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif); }
    :host([data-open="true"]) { display:flex; flex-direction:column; }
    .codexhost-preview-head { display:flex; min-height:40px; align-items:center; gap:8px; padding:6px 8px 6px 12px; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 12%,transparent)); background:var(--surface-primary,#fff); }
    .codexhost-preview-title { min-width:0; flex:1; }
    .codexhost-preview-title strong { display:block; overflow:hidden; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-preview-meta { display:flex; gap:8px; color:inherit; font-size:10px; opacity:.58; }
    .codexhost-preview-head button { display:grid; width:28px; height:28px; place-items:center; padding:0; color:inherit; background:transparent; border:0; border-radius:6px; cursor:pointer; }
    .codexhost-preview-head button:hover { background:color-mix(in srgb,currentColor 10%,transparent); }
    .codexhost-preview-note { padding:8px 12px; color:var(--text-link,inherit); font-size:11px; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 10%,transparent)); }
    .codexhost-preview-body { min-height:0; flex:1; margin:0; overflow:auto; padding:14px 16px 28px; color:inherit; background:var(--surface-primary,#fff); font:12px/1.58 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace; tab-size:2; white-space:pre; }
  `;
  const previewHead = document.createElement("div");
  previewHead.className = "codexhost-preview-head";
  const previewTitle = document.createElement("div");
  previewTitle.className = "codexhost-preview-title";
  const previewPath = document.createElement("strong");
  const previewMeta = document.createElement("div");
  previewMeta.className = "codexhost-preview-meta";
  previewTitle.append(previewPath, previewMeta);
  const close = iconButton(document, "关闭文件预览", "M6 6l12 12M18 6L6 18");
  close.setAttribute(WORKSPACE_FILE_PREVIEW_CLOSE_ATTRIBUTE, "v1");
  previewHead.append(previewTitle, close);
  const previewNote = document.createElement("div");
  previewNote.className = "codexhost-preview-note";
  previewNote.hidden = true;
  const previewBody = document.createElement("pre");
  previewBody.className = "codexhost-preview-body";
  previewShadow.append(previewStyle, previewHead, previewNote, previewBody);

  let active = false;
  let disposed = false;
  let previewOpen = false;
  let previewGeneration = 0;
  let treeGeneration = 0;
  let mainSurface: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let frame = 0;

  const context = (): RendererWorkspaceFilesContext => options.getContext();

  const stateFor = (pathValue: string): DirectoryState => {
    let state = directories.get(pathValue);
    if (!state) {
      state = {
        expanded: pathValue === "",
        loading: false,
        entries: [],
        error: null,
        truncated: false,
      };
      directories.set(pathValue, state);
    }
    return state;
  };

  const positionPreview = (): void => {
    frame = 0;
    if (!previewOpen || disposed) return;
    mainSurface = document.querySelector<HTMLElement>(MAIN_SURFACE_SELECTOR);
    const header = document.querySelector<HTMLElement>(APP_HEADER_SELECTOR);
    const mainBounds = mainSurface?.getBoundingClientRect();
    const headerBounds = header?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const left = Math.max(0, mainBounds?.left ?? 0);
    const top = Math.max(0, mainBounds?.top ?? 0, headerBounds?.bottom ?? 0);
    const right = Math.max(left, mainBounds?.right ?? viewportWidth);
    const bottom = Math.max(top, mainBounds?.bottom ?? viewportHeight);
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.width = `${Math.max(0, right - left)}px`;
    preview.style.height = `${Math.max(0, bottom - top)}px`;
  };

  const schedulePreviewPosition = (): void => {
    if (frame) return;
    frame = ownerWindow.requestAnimationFrame(positionPreview);
  };

  const observeMainSurface = (): void => {
    const next = document.querySelector<HTMLElement>(MAIN_SURFACE_SELECTOR);
    if (next === mainSurface) return;
    resizeObserver?.disconnect();
    mainSurface = next;
    if (mainSurface && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedulePreviewPosition);
      resizeObserver.observe(mainSurface);
    }
    schedulePreviewPosition();
  };

  const closePreview = (): void => {
    previewGeneration += 1;
    previewOpen = false;
    preview.removeAttribute("data-open");
    preview.remove();
    close.title = "关闭文件预览";
  };

  const renderPreview = (value: WorkspaceFileReadResult): void => {
    previewPath.textContent = value.path;
    previewMeta.replaceChildren();
    const size = document.createElement("span");
    size.textContent = formatBytes(value.size);
    const readOnly = document.createElement("span");
    readOnly.textContent = "只读";
    previewMeta.append(size, readOnly);
    if (value.binary) {
      previewNote.hidden = false;
      previewNote.textContent = "二进制文件不显示内容。";
      previewBody.textContent = "";
      return;
    }
    if (value.truncated) {
      previewNote.hidden = false;
      previewNote.textContent = "文件较大，仅显示前 1 MiB 内容。";
    } else {
      previewNote.hidden = true;
      previewNote.textContent = "";
    }
    previewBody.textContent = value.content || "文件为空";
  };

  const openPreview = async (entry: WorkspaceFileEntry): Promise<void> => {
    const request = context();
    const read = request.client?.readWorkspaceFile;
    if (!request.threadId || !read) {
      renderFileError("当前 Host 不支持文件读取。");
      return;
    }
    const generation = ++previewGeneration;
    previewOpen = true;
    preview.setAttribute("data-open", "true");
    if (preview.parentElement !== document.body) document.body.append(preview);
    previewPath.textContent = entry.path;
    previewMeta.replaceChildren();
    previewNote.hidden = false;
    previewNote.textContent = "";
    previewBody.textContent = "正在读取文件…";
    observeMainSurface();
    positionPreview();
    try {
      const result = await read({ threadId: request.threadId, path: entry.path });
      if (disposed || generation !== previewGeneration || !previewOpen) return;
      renderPreview(result);
    } catch (error) {
      if (disposed || generation !== previewGeneration || !previewOpen) return;
      previewNote.hidden = false;
      previewNote.textContent = error instanceof Error ? error.message : String(error);
      previewBody.textContent = "";
    }
  };

  const renderFileError = (message: string): void => {
    status.textContent = message;
    status.hidden = false;
  };

  const renderTree = (): void => {
    tree.replaceChildren();
    const renderEntries = (pathValue: string, depth: number): void => {
      const state = stateFor(pathValue);
      if (state.loading) {
        const loading = document.createElement("div");
        loading.className = "codexhost-files-message";
        loading.style.paddingLeft = `${10 + depth * 14}px`;
        loading.textContent = "正在加载…";
        tree.append(loading);
        return;
      }
      if (state.error) {
        const error = document.createElement("div");
        error.className = "codexhost-files-message";
        error.style.paddingLeft = `${10 + depth * 14}px`;
        error.textContent = state.error;
        tree.append(error);
        return;
      }
      for (const entry of state.entries) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "codexhost-files-entry";
        row.setAttribute(WORKSPACE_FILE_ENTRY_ATTRIBUTE, entry.kind);
        row.style.paddingLeft = `${8 + depth * 14}px`;
        row.title = entry.path;
        const marker = document.createElement("span");
        marker.className = "codexhost-files-entry-marker";
        const name = document.createElement("span");
        name.className = "codexhost-files-entry-name";
        name.textContent = entry.name;
        const meta = document.createElement("span");
        meta.className = "codexhost-files-entry-meta";
        if (entry.kind === "directory") {
          const state = stateFor(entry.path);
          row.setAttribute("aria-expanded", String(state.expanded));
          marker.textContent = state.expanded ? "▾" : "▸";
        } else if (entry.kind === "symlink") {
          marker.textContent = "↗";
          meta.textContent = "链接";
        } else {
          marker.textContent = "·";
          meta.textContent = formatBytes(entry.size);
        }
        row.append(marker, name, meta);
        row.addEventListener(
          "click",
          () => {
            if (entry.kind === "directory") {
              const state = stateFor(entry.path);
              state.expanded = !state.expanded;
              if (state.expanded && state.entries.length === 0 && !state.loading) {
                renderTree();
                void loadDirectory(entry.path);
              } else {
                renderTree();
              }
              return;
            }
            void openPreview(entry);
          },
          options.signal ? { signal: options.signal } : undefined,
        );
        tree.append(row);
        if (entry.kind === "directory" && stateFor(entry.path).expanded) {
          renderEntries(entry.path, depth + 1);
        }
      }
      if (state.truncated) {
        const truncated = document.createElement("div");
        truncated.className = "codexhost-files-message";
        truncated.style.paddingLeft = `${10 + depth * 14}px`;
        truncated.textContent = "目录内容过多，仅显示前 5000 项。";
        tree.append(truncated);
      }
    };
    renderEntries("", 0);
  };

  const loadDirectory = async (pathValue: string): Promise<void> => {
    const request = context();
    const list = request.client?.listWorkspaceFiles;
    const state = stateFor(pathValue);
    if (!request.threadId || !list) {
      state.error = "当前 Host 不支持文件浏览。";
      renderFileError(state.error);
      renderTree();
      return;
    }
    const generation = treeGeneration;
    state.loading = true;
    state.error = null;
    renderTree();
    try {
      const result = await list({ threadId: request.threadId, path: pathValue });
      if (disposed || generation !== treeGeneration) return;
      state.entries = result.entries;
      state.truncated = result.truncated;
      state.loading = false;
      workspaceLabel.textContent = result.workspace;
      status.textContent = result.truncated ? "目录内容已截断" : "";
      status.hidden = !result.truncated;
    } catch (error) {
      if (disposed || generation !== treeGeneration) return;
      state.loading = false;
      state.error = error instanceof Error ? error.message : String(error);
      renderFileError(state.error);
    } finally {
      if (!disposed && generation === treeGeneration) renderTree();
    }
  };

  const refreshTree = (): void => {
    treeGeneration += 1;
    directories.clear();
    closePreview();
    status.hidden = true;
    status.textContent = "";
    workspaceLabel.textContent = "";
    void loadDirectory("");
  };

  const onWindowResize = (): void => {
    observeMainSurface();
    schedulePreviewPosition();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && previewOpen) closePreview();
  };
  ownerWindow.addEventListener(
    "resize",
    onWindowResize,
    options.signal ? { signal: options.signal } : undefined,
  );
  document.addEventListener(
    "keydown",
    onKeyDown,
    options.signal ? { signal: options.signal } : undefined,
  );
  close.addEventListener(
    "click",
    closePreview,
    options.signal ? { signal: options.signal } : undefined,
  );
  refresh.addEventListener(
    "click",
    refreshTree,
    options.signal ? { signal: options.signal } : undefined,
  );
  options.container.append(panel);

  return {
    panel,
    activate() {
      if (disposed) return;
      active = true;
      panel.hidden = false;
      if (!directories.has("")) void loadDirectory("");
    },
    deactivate() {
      active = false;
      panel.hidden = true;
      closePreview();
    },
    refresh() {
      if (active) refreshTree();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      treeGeneration += 1;
      closePreview();
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (frame) ownerWindow.cancelAnimationFrame(frame);
      panel.remove();
    },
  };
}
