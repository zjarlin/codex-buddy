import type { RemoteProject, RemoteProjectsSnapshot } from "@codexhost/shared-contracts";
import { createVisiblePoll } from "./renderer-visible-poll.js";
import {
  remoteProjectCatalog,
  type RemoteProjectCatalogEntry,
} from "./renderer-remote-project-catalog.js";

export interface RendererRemoteProjectsClient {
  inspectRemoteProjects(): Promise<RemoteProjectsSnapshot>;
  syncRemoteProjects(): Promise<RemoteProjectsSnapshot>;
  importRemoteProject(project: RemoteProject): Promise<void>;
}

export interface RendererRemoteProjectsPanel {
  readonly panel: HTMLElement;
  activate(): void;
  deactivate(): void;
  refresh(): void;
  dispose(): void;
}

export const REMOTE_PROJECTS_PANEL_ATTRIBUTE = "data-codexhost-remote-projects-panel";
export const REMOTE_PROJECTS_REFRESH_ATTRIBUTE = "data-codexhost-remote-projects-refresh";
export const REMOTE_PROJECTS_SYNC_ATTRIBUTE = "data-codexhost-remote-projects-sync";
export const REMOTE_PROJECTS_IMPORT_ATTRIBUTE = "data-codexhost-remote-projects-import";

function button(document: Document, text: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  return element;
}

function section(document: Document, title: string): HTMLElement {
  const element = document.createElement("section");
  element.className = "codexhost-remote-projects-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  element.append(heading);
  return element;
}

function empty(document: Document, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "codexhost-remote-projects-empty";
  element.textContent = text;
  return element;
}

export function createRendererRemoteProjectsPanel(options: {
  ownerDocument: Document;
  container: ShadowRoot | HTMLElement;
  getClient(): RendererRemoteProjectsClient | null;
  importProject(project: RemoteProject): Promise<void>;
  signal?: AbortSignal;
}): RendererRemoteProjectsPanel {
  const document = options.ownerDocument;
  const listenerOptions = options.signal ? { signal: options.signal } : undefined;
  const panel = document.createElement("section");
  panel.className = "codexhost-remote-projects-panel";
  panel.setAttribute(REMOTE_PROJECTS_PANEL_ATTRIBUTE, "v1");
  panel.hidden = true;
  const style = document.createElement("style");
  style.textContent = `
    .codexhost-remote-projects-panel { position:absolute; inset:0 0 0 38px; display:flex; min-width:0; flex-direction:column; overflow:hidden; color:var(--text-primary,inherit); background:var(--surface-primary,inherit); pointer-events:auto; }
    .codexhost-remote-projects-panel[hidden] { display:none; }
    .codexhost-remote-projects-head { display:flex; min-height:38px; align-items:center; gap:6px; padding:5px 7px 5px 11px; border-bottom:1px solid var(--border-default,color-mix(in srgb,currentColor 12%,transparent)); }
    .codexhost-remote-projects-head strong { min-width:0; flex:1; overflow:hidden; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-remote-projects-head button, .codexhost-remote-projects-row button { min-height:26px; padding:3px 7px; color:inherit; background:transparent; border:1px solid var(--border-default,color-mix(in srgb,currentColor 18%,transparent)); border-radius:4px; cursor:pointer; font-size:10px; }
    .codexhost-remote-projects-head button:hover:not(:disabled), .codexhost-remote-projects-row button:hover:not(:disabled) { background:color-mix(in srgb,currentColor 9%,transparent); }
    .codexhost-remote-projects-body { display:flex; min-height:0; flex:1; overflow:auto; flex-direction:column; padding:9px 11px; gap:12px; }
    .codexhost-remote-projects-section { display:grid; gap:6px; }
    .codexhost-remote-projects-section h3 { margin:0; font-size:10px; font-weight:600; text-transform:uppercase; opacity:.58; }
    .codexhost-remote-projects-account { display:flex; min-width:0; align-items:center; gap:6px; padding:7px 8px; border:1px solid var(--border-default,color-mix(in srgb,currentColor 14%,transparent)); border-radius:5px; font-size:11px; }
    .codexhost-remote-projects-account strong { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-remote-projects-account span { flex:none; font-size:9px; opacity:.58; }
    .codexhost-remote-projects-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:start; gap:8px; padding:8px 0; border-top:1px solid var(--border-default,color-mix(in srgb,currentColor 8%,transparent)); }
    .codexhost-remote-projects-copy { display:grid; min-width:0; gap:2px; }
    .codexhost-remote-projects-copy strong, .codexhost-remote-projects-copy span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-remote-projects-copy strong { font-size:11px; }
    .codexhost-remote-projects-copy span { font-size:9px; opacity:.58; }
    .codexhost-remote-projects-row input { margin:5px 0 0; }
    .codexhost-remote-projects-row button { margin-top:1px; }
    .codexhost-remote-projects-notice { min-height:16px; margin:0; color:var(--text-link,inherit); font-size:10px; line-height:1.4; overflow-wrap:anywhere; }
    .codexhost-remote-projects-notice[data-state="error"] { color:var(--color-text-danger,#ef4444); }
    .codexhost-remote-projects-notice[data-state="success"] { color:var(--green,#3fa66a); }
    .codexhost-remote-projects-empty { margin:0; font-size:11px; opacity:.58; }
  `;
  const head = document.createElement("div");
  head.className = "codexhost-remote-projects-head";
  const title = document.createElement("strong");
  title.textContent = "主机共享项目";
  const refresh = button(document, "刷新");
  refresh.setAttribute(REMOTE_PROJECTS_REFRESH_ATTRIBUTE, "v1");
  const sync = button(document, "同步当前身份");
  sync.setAttribute(REMOTE_PROJECTS_SYNC_ATTRIBUTE, "v1");
  const importSelectedButton = button(document, "恢复已选");
  importSelectedButton.setAttribute(REMOTE_PROJECTS_IMPORT_ATTRIBUTE, "selected");
  head.append(title, refresh, sync, importSelectedButton);
  const body = document.createElement("div");
  body.className = "codexhost-remote-projects-body";
  const account = document.createElement("div");
  account.className = "codexhost-remote-projects-account";
  const accountName = document.createElement("strong");
  const accountId = document.createElement("span");
  account.append(accountName, accountId);
  const projects = section(document, "可恢复项目");
  const projectList = document.createElement("div");
  projects.append(projectList);
  const notice = document.createElement("p");
  notice.className = "codexhost-remote-projects-notice";
  notice.setAttribute("role", "status");
  body.append(account, projects, notice);
  panel.append(style, head, body);
  options.container.append(panel);

  let active = false;
  let disposed = false;
  let busy = false;
  let polling = false;
  let generation = 0;
  let snapshot: RemoteProjectsSnapshot | null = null;
  let catalog: RemoteProjectCatalogEntry[] = [];

  const setNotice = (message: string, state: "info" | "success" | "error" = "info"): void => {
    notice.textContent = message;
    notice.dataset.state = state;
  };
  const setBusy = (value: boolean): void => {
    busy = value;
    for (const control of panel.querySelectorAll<HTMLButtonElement>("button")) {
      control.disabled = value;
    }
  };
  const selectedProjects = (): Set<string> =>
    new Set(
      [...projectList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(
        (input) => input.value,
      ),
    );

  const render = (next: RemoteProjectsSnapshot): void => {
    const selected = selectedProjects();
    snapshot = next;
    catalog = remoteProjectCatalog(next);
    accountName.textContent = next.account.label;
    accountId.textContent = next.account.id;
    projectList.replaceChildren();
    if (catalog.length === 0) {
      projectList.append(empty(document, "这台主机还没有已同步身份。先点击「同步当前身份」。"));
    }
    for (const entry of catalog) {
      const project = entry.project;
      const row = document.createElement("div");
      row.className = "codexhost-remote-projects-row";
      const select = document.createElement("input");
      select.type = "checkbox";
      select.value = project.key;
      select.checked = selected.has(project.key);
      select.setAttribute("aria-label", `选择 ${project.name}`);
      const copy = document.createElement("div");
      copy.className = "codexhost-remote-projects-copy";
      const name = document.createElement("strong");
      name.textContent = project.name;
      const roots = document.createElement("span");
      roots.textContent = project.roots.join(" · ");
      roots.title = roots.textContent;
      const threads = document.createElement("span");
      threads.textContent = `${project.threads.length} 个会话 · ${entry.accountLabels.join(" / ")}`;
      copy.append(name, roots, threads);
      const importButton = button(document, "恢复");
      importButton.setAttribute(REMOTE_PROJECTS_IMPORT_ATTRIBUTE, project.key);
      importButton.addEventListener(
        "click",
        () => {
          if (busy || disposed) return;
          setBusy(true);
          setNotice(`正在恢复 ${project.name}…`);
          void options
            .importProject(project)
            .then(() => {
              if (!disposed) setNotice(`${project.name} 已恢复。`, "success");
            })
            .catch((error: unknown) => {
              if (!disposed)
                setNotice(error instanceof Error ? error.message : String(error), "error");
            })
            .finally(() => {
              if (!disposed) setBusy(false);
            });
        },
        listenerOptions,
      );
      row.append(select, copy, importButton);
      projectList.append(row);
    }
    setBusy(busy);
  };

  const inspect = async (silent = false): Promise<void> => {
    if (!active || disposed || polling) return;
    const client = options.getClient();
    if (!client) {
      if (!silent) setNotice("当前 Host 未提供共享项目接口。", "error");
      return;
    }
    polling = true;
    const requestGeneration = ++generation;
    try {
      const next = await client.inspectRemoteProjects();
      if (active && !disposed && requestGeneration === generation) render(next);
    } catch (error) {
      if (!silent && active && requestGeneration === generation)
        setNotice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      polling = false;
    }
  };

  const syncCurrent = async (): Promise<void> => {
    const client = options.getClient();
    if (!client || busy || disposed) return;
    setBusy(true);
    setNotice("正在同步当前身份的项目…");
    try {
      render(await client.syncRemoteProjects());
      setNotice("当前身份的项目已同步。", "success");
    } catch (error) {
      if (!disposed) setNotice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (!disposed) setBusy(false);
    }
  };

  const importSelected = async (): Promise<void> => {
    const client = options.getClient();
    if (!client || busy || disposed || !snapshot) return;
    const selected = selectedProjects();
    const projects = catalog
      .filter((entry) => selected.has(entry.project.key))
      .map((entry) => entry.project);
    if (projects.length === 0) {
      setNotice("先选择要恢复的项目。", "error");
      return;
    }
    setBusy(true);
    setNotice(`正在恢复 ${projects.length} 个项目…`);
    try {
      for (const project of projects) await options.importProject(project);
      setNotice(`已恢复 ${projects.length} 个项目。`, "success");
    } catch (error) {
      if (!disposed) setNotice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (!disposed) setBusy(false);
    }
  };

  refresh.addEventListener("click", () => void inspect(), listenerOptions);
  sync.addEventListener("click", () => void syncCurrent(), listenerOptions);
  importSelectedButton.addEventListener("click", () => void importSelected(), listenerOptions);
  const poll = createVisiblePoll(document, 5_000, () => void inspect(true));
  options.signal?.addEventListener("abort", () => poll.dispose(), { once: true });

  return {
    panel,
    activate() {
      if (disposed || active) return;
      active = true;
      poll.setActive(true);
      panel.hidden = false;
      setNotice("正在读取主机共享项目…");
      void inspect();
    },
    deactivate() {
      active = false;
      poll.setActive(false);
      panel.hidden = true;
    },
    refresh() {
      if (active) void inspect();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      generation += 1;
      poll.dispose();
      panel.remove();
    },
  };
}
