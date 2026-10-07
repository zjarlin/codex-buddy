import createElement from "lucide/dist/esm/createElement.mjs";
import Folder from "lucide/dist/esm/icons/folder.mjs";
import type { ThreadFoldersConfig, ThreadFoldersState } from "@codexhost/shared-contracts";
import { mutationAffectsElements } from "../renderer-dom-mutations.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import { projectKey, type SidebarProject } from "../project-tabs/model.js";
import { rowProject } from "../project-tabs/native-binding.js";
import { threadFolderMessages } from "./messages.js";
import {
  defaultThreadFolders,
  parseThreadFolders,
  THREAD_FOLDERS_STORAGE_KEY,
  threadFolderProject,
  withThreadFolderAssignment,
  withThreadFolders,
} from "./model.js";
import { threadFoldersStyle } from "./styles.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "../renderer-sidebar-agent-icons.js";

const BAR_ATTRIBUTE = "data-codexhost-thread-folders";
const MOVE_ATTRIBUTE = "data-codexhost-thread-folder-move";
const HIDDEN_ATTRIBUTE = "data-codexhost-thread-folder-hidden";
const CUSTOM_MENU_ATTRIBUTE = "data-codexhost-thread-actions-menu";
const SIDEBAR_SCOPE = "#app-shell-sidebar";
const PROJECT_CONTAINER_SELECTOR = "[data-sidebar-project-container-id][data-sidebar-project-kind]";
const PROJECT_HEADER_SELECTOR = "[data-app-action-sidebar-project-row]";

interface ProjectBarEntry {
  container: HTMLElement;
  bar: HTMLElement;
  signature: string;
}

interface ThreadFoldersClientLike {
  getThreadFolders?(): Promise<ThreadFoldersState>;
  setThreadFolders?(config: ThreadFoldersConfig): Promise<ThreadFoldersState>;
}

interface ThreadFoldersClient {
  getThreadFolders(): Promise<ThreadFoldersState>;
  setThreadFolders(config: ThreadFoldersConfig): Promise<ThreadFoldersState>;
}

export interface ThreadFolderThreadMenu {
  decorate(
    menu: HTMLElement,
    row: HTMLElement,
    hostId: string,
    threadId: string,
    close: () => void,
  ): void;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function openDialog(title: string, onClose: () => void): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("data-codexhost-thread-folder-dialog", "");
  dialog.setAttribute("aria-label", title);
  const heading = document.createElement("h2");
  heading.textContent = title;
  dialog.append(heading);
  const previousFocus = document.activeElement;
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  });
  document.body.append(dialog);
  return dialog;
}

function nativeThreadId(hostId: string, row: HTMLElement): string | null {
  const raw = threadIdFromSidebarRowElement(row);
  if (!raw || raw.startsWith("client-new-thread:")) return null;
  const prefix = `${hostId}:`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function projectForRow(row: HTMLElement): SidebarProject | null {
  const container = row.closest<HTMLElement>(PROJECT_CONTAINER_SELECTOR);
  return container ? rowProject(container) : null;
}

export function installThreadFolders(options: {
  getLocale(): string;
  getClient?(): ThreadFoldersClientLike | null;
}): {
  refresh(): void;
  dispose(): void;
  threadMenu: ThreadFolderThreadMenu;
} {
  const styles = document.createElement("style");
  styles.textContent = threadFoldersStyle;
  document.head.append(styles);
  let config = defaultThreadFolders();
  let failure: unknown = null;
  let revision = 0;
  let loadedClient: ThreadFoldersClient | null = null;
  let loadingClient: ThreadFoldersClient | null = null;
  let hostWrite = Promise.resolve();
  let disposed = false;
  let scheduled = false;
  let dialog: HTMLDialogElement | null = null;
  const bars = new Map<string, ProjectBarEntry>();
  const hiddenRows = new Set<HTMLElement>();
  const storage = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  const readLocal = (): void => {
    const target = storage();
    if (!target) {
      config = defaultThreadFolders();
      failure = null;
      return;
    }
    try {
      config = parseThreadFolders(target.getItem(THREAD_FOLDERS_STORAGE_KEY));
      failure = null;
    } catch (error) {
      config = defaultThreadFolders();
      failure = error;
    }
  };
  readLocal();

  const persistenceClient = (): ThreadFoldersClient | null => {
    const client = options.getClient?.() ?? null;
    return client?.getThreadFolders && client.setThreadFolders
      ? (client as ThreadFoldersClient)
      : null;
  };
  const mirror = (next: ThreadFoldersConfig, requireLocal = false): void => {
    const target = storage();
    if (!target && requireLocal) throw new Error("Browser storage is unavailable");
    try {
      target?.setItem(THREAD_FOLDERS_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      if (requireLocal) throw error;
      failure = error;
    }
    config = next;
  };
  const saveHost = (
    client: ThreadFoldersClient,
    next: ThreadFoldersConfig,
  ): Promise<ThreadFoldersState> => {
    const operation = hostWrite.then(() => client.setThreadFolders(next));
    hostWrite = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
  const persist = async (next: ThreadFoldersConfig): Promise<void> => {
    try {
      const client = persistenceClient();
      if (!client) {
        revision += 1;
        mirror(next, true);
        failure = null;
        refresh();
        return;
      }
      const requestedRevision = ++revision;
      const saved = await saveHost(client, next);
      if (!saved.config)
        throw new Error("Local Host returned an empty Thread folder configuration");
      if (revision === requestedRevision) mirror(saved.config);
      failure = null;
      refresh();
    } catch (error) {
      failure = error;
      refresh();
      throw error;
    }
  };

  const configure = (project: SidebarProject, key: string, create = false): void => {
    if (dialog?.open) return;
    const current = threadFolderProject(config, key);
    const draft = current.folders.map((folder) => ({ ...folder }));
    if (create) draft.push({ id: crypto.randomUUID(), name: "" });
    const m = threadFolderMessages(options.getLocale());
    const folderDialog = openDialog(`${m.title} · ${project.label}`, () => {
      if (dialog === folderDialog) dialog = null;
    });
    dialog = folderDialog;
    const form = document.createElement("form");
    const hint = document.createElement("p");
    hint.textContent = m.hint;
    const rows = document.createElement("div");
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const renderRows = (): void => {
      rows.replaceChildren();
      for (const [index, folder] of draft.entries()) {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = `Folder ${index + 1}`;
        const label = document.createElement("label");
        label.textContent = m.name;
        const input = document.createElement("input");
        input.required = true;
        input.maxLength = 80;
        input.value = folder.name;
        input.addEventListener("input", () => {
          folder.name = input.value;
          input.setCustomValidity("");
        });
        label.append(input);
        const actions = document.createElement("div");
        actions.className = "thread-folder-actions";
        const reorder = (offset: number): void => {
          draft.splice(index, 1);
          draft.splice(index + offset, 0, folder);
          renderRows();
          rows.children[index + offset]?.querySelector("input")?.focus();
        };
        const up = button(m.up, () => reorder(-1));
        up.disabled = index === 0;
        const down = button(m.down, () => reorder(1));
        down.disabled = index === draft.length - 1;
        actions.append(
          up,
          down,
          button(m.remove, () => {
            draft.splice(index, 1);
            renderRows();
            (
              rows.children[Math.min(index, draft.length - 1)]?.querySelector("input") ?? add
            ).focus();
          }),
        );
        fieldset.append(legend, label, actions);
        rows.append(fieldset);
      }
      if (!draft.length) {
        const empty = document.createElement("p");
        empty.textContent = m.empty;
        rows.append(empty);
      }
    };
    const add = button(m.add, () => {
      draft.push({ id: crypto.randomUUID(), name: "" });
      renderRows();
      rows.lastElementChild?.querySelector("input")?.focus();
    });
    const footer = document.createElement("div");
    footer.className = "thread-folder-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = m.save;
    footer.append(
      button(m.cancel, () => folderDialog.close()),
      save,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const folders = draft.map((folder) => ({ ...folder, name: folder.name.trim() }));
      const names = new Set<string>();
      for (const [index, folder] of folders.entries()) {
        const input = rows.children[index]?.querySelector("input");
        if (!folder.name || names.has(folder.name)) {
          if (input) {
            input.setCustomValidity(folder.name ? m.duplicate : m.name);
            input.reportValidity();
          }
          return;
        }
        names.add(folder.name);
      }
      save.disabled = true;
      error.hidden = true;
      void persist(withThreadFolders(config, key, folders)).then(
        () => folderDialog.close(),
        (reason: unknown) => {
          save.disabled = false;
          error.textContent = m.failed + String(reason);
          error.hidden = false;
        },
      );
    });
    renderRows();
    form.append(hint, rows, add, error, footer);
    folderDialog.append(form);
    folderDialog.showModal();
    if (create) rows.lastElementChild?.querySelector("input")?.focus();
  };

  const chooseFolder = (project: SidebarProject, key: string, threadId: string): void => {
    if (dialog?.open) return;
    const current = threadFolderProject(config, key);
    const m = threadFolderMessages(options.getLocale());
    const moveDialog = openDialog(m.moveTitle, () => {
      if (dialog === moveDialog) dialog = null;
    });
    dialog = moveDialog;
    const subject = document.createElement("p");
    subject.textContent = project.label;
    const destinations = document.createElement("div");
    destinations.className = "thread-folder-destinations";
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.hidden = true;
    const currentFolder = current.assignments[threadId] ?? null;
    const choices: Array<{ id: string | null; label: string }> = [
      { id: null, label: m.unassigned },
      ...current.folders.map((folder) => ({ id: folder.id, label: folder.name })),
    ];
    for (const choice of choices) {
      const item = button(choice.label, () => {
        void persist(withThreadFolderAssignment(config, key, threadId, choice.id)).then(
          () => moveDialog.close(),
          (error: unknown) => {
            message.textContent = m.failed + String(error);
            message.hidden = false;
          },
        );
      });
      item.setAttribute("aria-pressed", String(currentFolder === choice.id));
      destinations.append(item);
    }
    const actions = document.createElement("div");
    actions.className = "thread-folder-actions";
    actions.append(
      button(m.cancel, () => moveDialog.close()),
      button(m.manage, () => {
        moveDialog.close();
        dialog = null;
        configure(project, key);
      }),
    );
    moveDialog.append(subject, destinations, message, actions);
    moveDialog.showModal();
  };

  const threadMenu: ThreadFolderThreadMenu = {
    decorate(menu, row, hostId, threadId, close) {
      const project = projectForRow(row);
      if (!project) return;
      const folderThreadId = nativeThreadId(hostId, row);
      const client = persistenceClient();
      if (!folderThreadId || !client) return;
      const m = threadFolderMessages(options.getLocale());
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute(MOVE_ATTRIBUTE, "");
      item.title = m.move;
      item.setAttribute("aria-label", m.move);
      const icon = document.createElement("span");
      icon.style.display = "inline-flex";
      icon.style.alignItems = "center";
      icon.append(createElement(Folder, { width: 15, height: 15, "aria-hidden": "true" }));
      const text = document.createElement("span");
      text.textContent = m.move;
      item.append(icon, text);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        chooseFolder(project, projectKey(project), folderThreadId);
      });
      menu.append(item);
    },
  };

  const collapsed = new Set<string>();
  let contextMenu: HTMLElement | null = null;
  let forwardingNativeMenu = false;
  const closeContextMenu = (): void => {
    contextMenu?.remove();
    contextMenu = null;
  };
  const onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !contextMenu?.contains(event.target)) closeContextMenu();
  };
  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeContextMenu();
  };
  const showContextMenu = (event: MouseEvent, project: SidebarProject, row?: HTMLElement): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeContextMenu();
    const m = threadFolderMessages(options.getLocale());
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-codexhost-folder-context-menu", "");
    const addAction = (label: string, action: () => void): void => {
      const item = button(label, () => {
        closeContextMenu();
        action();
      });
      item.setAttribute("role", "menuitem");
      menu.append(item);
    };
    const key = projectKey(project);
    const hostId = row?.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
    const threadId = row && hostId ? nativeThreadId(hostId, row) : null;
    if (threadId) addAction(m.move, () => chooseFolder(project, key, threadId));
    addAction(m.add, () => configure(project, key, true));
    addAction(m.manage, () => configure(project, key));
    const nativeTarget =
      row ?? bars.get(key)?.container.querySelector<HTMLElement>(PROJECT_HEADER_SELECTOR);
    if (nativeTarget)
      addAction(m.nativeActions, () => {
        forwardingNativeMenu = true;
        try {
          nativeTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          );
        } finally {
          forwardingNativeMenu = false;
        }
      });
    document.body.append(menu);
    contextMenu = menu;
    menu.style.left = `${Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight))}px`;
    menu.querySelector("button")?.focus();
  };
  const onSidebarContextMenu = (event: MouseEvent): void => {
    if (forwardingNativeMenu || !(event.target instanceof Element)) return;
    const target = event.target;
    if (!target.closest(SIDEBAR_SCOPE) || target.closest(`[${CUSTOM_MENU_ATTRIBUTE}]`)) return;
    const container = target.closest<HTMLElement>(PROJECT_CONTAINER_SELECTOR);
    const project = container ? rowProject(container) : null;
    if (!project) return;
    const row = target.closest<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR);
    // 树内会话入口自行处理右键，并保留对应原生会话行。
    if (target.closest("[data-codexhost-folder-thread]")) return;
    showContextMenu(event, project, row ?? undefined);
  };
  document.addEventListener("contextmenu", onSidebarContextMenu, true);
  document.addEventListener("pointerdown", onOutsidePointer, true);
  document.addEventListener("keydown", onMenuKey);

  const renderBar = (project: SidebarProject, entry: ProjectBarEntry): void => {
    const key = projectKey(project);
    const state = threadFolderProject(config, key);
    const m = threadFolderMessages(options.getLocale());
    const rows = [...entry.container.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)];
    const signature = JSON.stringify([
      options.getLocale(),
      project.label,
      state.folders,
      state.assignments,
      rows.map((row) => [
        nativeThreadId(row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local", row),
        row.textContent,
        row.getAttribute("data-app-action-sidebar-thread-active"),
      ]),
      [...collapsed],
      failure ? String(failure) : null,
    ]);
    if (entry.signature === signature) return;
    entry.signature = signature;
    const tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", m.title);
    for (const folder of state.folders) {
      const node = document.createElement("div");
      node.setAttribute("role", "treeitem");
      node.setAttribute("aria-label", folder.name);
      const collapseKey = JSON.stringify([key, folder.id]);
      const expanded = !collapsed.has(collapseKey);
      node.setAttribute("aria-expanded", String(expanded));
      const children = document.createElement("div");
      children.setAttribute("role", "group");
      children.hidden = !expanded;
      const toggle = button("", () => {
        if (collapsed.has(collapseKey)) collapsed.delete(collapseKey);
        else collapsed.add(collapseKey);
        const open = !collapsed.has(collapseKey);
        node.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-expanded", String(open));
        arrow.textContent = open ? "▾" : "▸";
        children.hidden = !open;
      });
      toggle.setAttribute("aria-label", folder.name);
      toggle.setAttribute("aria-expanded", String(expanded));
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = expanded ? "▾" : "▸";
      toggle.append(
        arrow,
        createElement(Folder, { width: 15, height: 15, "aria-hidden": "true" }),
        folder.name,
      );
      for (const row of rows) {
        const id = nativeThreadId(
          row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local",
          row,
        );
        if (!id || state.assignments[id] !== folder.id) continue;
        const title =
          row.querySelector("[data-thread-title]")?.textContent ?? row.textContent ?? id;
        // 不搬动 React 管理的节点；点击时重新查找当前行，兼容原生列表重绘。
        const findRow = (): HTMLElement | undefined =>
          [...entry.container.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].find(
            (candidate) =>
              nativeThreadId(
                candidate.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local",
                candidate,
              ) === id,
          );
        const item = button(title, () => findRow()?.click());
        item.setAttribute("role", "treeitem");
        item.setAttribute("data-codexhost-folder-thread", id);
        item.setAttribute(
          "aria-selected",
          String(row.getAttribute("data-app-action-sidebar-thread-active") === "true"),
        );
        item.addEventListener("contextmenu", (event) => showContextMenu(event, project, findRow()));
        children.append(item);
      }
      node.append(toggle, children);
      tree.append(node);
    }
    const error = document.createElement("span");
    error.setAttribute("role", "alert");
    error.hidden = !failure;
    error.textContent = failure ? `${m.failed}${String(failure)}` : "";
    entry.bar.replaceChildren(tree, error);
    entry.bar.setAttribute("aria-label", `${m.title} · ${project.label}`);
  };

  function refresh(): void {
    scheduled = false;
    if (disposed) return;
    const client = persistenceClient();
    if (client && client !== loadedClient && client !== loadingClient) {
      loadingClient = client;
      const startedRevision = revision;
      let localSnapshot: string | null = null;
      try {
        localSnapshot = storage()?.getItem(THREAD_FOLDERS_STORAGE_KEY) ?? null;
      } catch {
        localSnapshot = null;
      }
      void (async () => {
        try {
          const state = await client.getThreadFolders();
          if (disposed || loadingClient !== client) return;
          if (revision === startedRevision) {
            if (state.config) {
              mirror(state.config);
            } else if (localSnapshot) {
              await saveHost(client, parseThreadFolders(localSnapshot));
            } else {
              mirror(defaultThreadFolders());
            }
          }
          loadedClient = client;
          loadingClient = null;
          failure = null;
          refresh();
        } catch (error) {
          if (disposed || loadingClient !== client) return;
          loadingClient = null;
          loadedClient = client;
          failure = error;
          refresh();
        }
      })();
    }

    const projects: Array<{ container: HTMLElement; project: SidebarProject }> = [];
    for (const container of document.querySelectorAll<HTMLElement>(PROJECT_CONTAINER_SELECTOR)) {
      const project = rowProject(container);
      if (project) projects.push({ container, project });
    }
    const activeKeys = new Set(projects.map(({ project }) => projectKey(project)));
    for (const [key, entry] of bars) {
      if (!activeKeys.has(key) || !entry.container.isConnected || !entry.bar.isConnected) {
        entry.bar.remove();
        bars.delete(key);
      }
    }
    for (const { container, project } of projects) {
      const key = projectKey(project);
      const header = container.querySelector<HTMLElement>(PROJECT_HEADER_SELECTOR);
      if (!header) continue;
      let entry = bars.get(key);
      if (!entry) {
        const bar = document.createElement("div");
        bar.setAttribute(BAR_ATTRIBUTE, "");
        entry = { container, bar, signature: "" };
        bars.set(key, entry);
      }
      if (
        entry.container !== container ||
        entry.bar.parentElement !== header.parentElement ||
        entry.bar.previousElementSibling !== header
      ) {
        entry.container = container;
        header.after(entry.bar);
      }
      renderBar(project, entry);
    }

    for (const row of hiddenRows) {
      if (!row.isConnected) {
        row.removeAttribute(HIDDEN_ATTRIBUTE);
        hiddenRows.delete(row);
      }
    }
    for (const row of document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const project = projectForRow(row);
      if (!hostId || !project) {
        row.removeAttribute(HIDDEN_ATTRIBUTE);
        hiddenRows.delete(row);
        continue;
      }
      const state = threadFolderProject(config, projectKey(project));
      const threadId = nativeThreadId(hostId, row);
      const assigned = threadId ? state.assignments[threadId] : undefined;
      const hidden = !failure && state.folders.some((folder) => folder.id === assigned);
      row.toggleAttribute(HIDDEN_ATTRIBUTE, hidden);
      if (hidden) hiddenRows.add(row);
      else hiddenRows.delete(row);
    }
  }

  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(refresh);
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== THREAD_FOLDERS_STORAGE_KEY && event.key !== null) return;
    readLocal();
    revision += 1;
    schedule();
  };
  // 只关心侧栏结构：refresh() 会对每个项目容器做 fiber 回溯（rowProject），
  // 整页订阅会在聊天内容流水时反复触发。按侧栏子树收窄，并保留原有的
  // 「排除自身注入 bar」判断。
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "attributes"],
    attributeFilter: [
      "data-sidebar-project-kind",
      "data-sidebar-project-container-id",
      "data-app-action-sidebar-project-row",
      "data-app-action-sidebar-thread-active",
      "data-app-action-sidebar-thread-id",
      "data-app-action-sidebar-thread-host-id",
    ],
    test: (record) =>
      record.target instanceof Element &&
      record.target.closest(`[${BAR_ATTRIBUTE}]`) === null &&
      mutationAffectsElements(record, SIDEBAR_SCOPE),
    onMutate: () => schedule(),
  });
  window.addEventListener("storage", onStorage);
  schedule();

  return {
    refresh: schedule,
    threadMenu,
    dispose() {
      disposed = true;
      stopObserving();
      closeContextMenu();
      document.removeEventListener("contextmenu", onSidebarContextMenu, true);
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      document.removeEventListener("keydown", onMenuKey);
      window.removeEventListener("storage", onStorage);
      dialog?.close();
      for (const entry of bars.values()) entry.bar.remove();
      bars.clear();
      for (const row of hiddenRows) row.removeAttribute(HIDDEN_ATTRIBUTE);
      hiddenRows.clear();
      styles.remove();
    },
  };
}
