import createElement from "lucide/dist/esm/createElement.mjs";
import Folder from "lucide/dist/esm/icons/folder.mjs";
import Settings2 from "lucide/dist/esm/icons/settings-2.mjs";
import type { ThreadFoldersConfig, ThreadFoldersState } from "@codexhost/shared-contracts";
import { mutationAffectsElements } from "../renderer-dom-mutations.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import { projectKey, type SidebarProject } from "../project-tabs/model.js";
import { rowProject } from "../project-tabs/native-binding.js";
import { threadFolderMessages } from "./messages.js";
import {
  defaultThreadFolders,
  parseThreadFolders,
  selectedThreadFolder,
  THREAD_FOLDERS_STORAGE_KEY,
  threadFolderProject,
  UNASSIGNED_THREAD_FOLDER_ID,
  withThreadFolderAssignment,
  withThreadFolders,
  withThreadFolderProject,
} from "./model.js";
import { threadFoldersStyle } from "./styles.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "../renderer-sidebar-agent-icons.js";

const BAR_ATTRIBUTE = "data-codexhost-thread-folders";
const MANAGE_ATTRIBUTE = "data-codexhost-thread-folder-manage";
const MOVE_ATTRIBUTE = "data-codexhost-thread-folder-move";
const HIDDEN_ATTRIBUTE = "data-codexhost-thread-folder-hidden";
const NATIVE_AUGMENTED_ATTRIBUTE = "data-codexhost-thread-folder-native-augmented";
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

  const configure = (project: SidebarProject, key: string): void => {
    if (dialog) return;
    const current = threadFolderProject(config, key);
    const draft = current.folders.map((folder) => ({ ...folder }));
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
  };

  const chooseFolder = (project: SidebarProject, key: string, threadId: string): void => {
    if (dialog) return;
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

  // ── Native context menu augmentation ──────────────────────────────
  // Append "移动到文件夹" to the native Codex Desktop right-click menu.
  // We capture which thread row was right-clicked, then observe for the
  // native menu element appearing in the DOM and append our item.
  let pendingNativeRow: HTMLElement | null = null;
  let nativeMenuObserver: MutationObserver | null = null;
  let nativeMenuTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanupNativeWatch = (): void => {
    if (nativeMenuObserver) {
      nativeMenuObserver.disconnect();
      nativeMenuObserver = null;
    }
    if (nativeMenuTimer !== null) {
      clearTimeout(nativeMenuTimer);
      nativeMenuTimer = null;
    }
    pendingNativeRow = null;
  };

  const findNativeMenu = (): HTMLElement | null => {
    // Native Codex menus are typically [role="menu"] portals rendered outside
    // the sidebar. Skip our own custom thread-actions menu.
    const candidates = document.querySelectorAll<HTMLElement>('[role="menu"]');
    for (const candidate of candidates) {
      if (candidate.hasAttribute(NATIVE_AUGMENTED_ATTRIBUTE)) continue;
      if (candidate.hasAttribute(CUSTOM_MENU_ATTRIBUTE)) continue;
      if (candidate.querySelector('[role="menuitem"]')) return candidate;
    }
    return null;
  };

  const augmentNativeMenu = (menu: HTMLElement, row: HTMLElement): void => {
    const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
    if (!hostId) return;
    const folderThreadId = nativeThreadId(hostId, row);
    const client = persistenceClient();
    if (!folderThreadId || !client) return;
    const project = projectForRow(row);
    if (!project) return;

    menu.setAttribute(NATIVE_AUGMENTED_ATTRIBUTE, "");
    const m = threadFolderMessages(options.getLocale());

    // Separator
    const separator = document.createElement("div");
    separator.setAttribute("role", "separator");
    separator.style.cssText =
      "height:1px;margin:4px 8px;background:color-mix(in srgb,currentColor 12%,transparent);";
    menu.append(separator);

    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.setAttribute(MOVE_ATTRIBUTE, "");
    item.title = m.move;
    item.setAttribute("aria-label", m.move);
    // Match typical native menu item styling; inherits font/color from menu
    item.style.cssText =
      "display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;";
    item.addEventListener("mouseenter", () => {
      item.style.background = "color-mix(in srgb,currentColor 12%,transparent)";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
    });

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
      // Dismiss the native menu
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      chooseFolder(project, projectKey(project), folderThreadId);
    });

    menu.append(item);
  };

  const watchForNativeMenu = (): void => {
    if (!pendingNativeRow) return;
    const immediate = findNativeMenu();
    if (immediate) {
      augmentNativeMenu(immediate, pendingNativeRow);
      cleanupNativeWatch();
      return;
    }
    nativeMenuObserver = new MutationObserver(() => {
      const menu = findNativeMenu();
      if (menu && pendingNativeRow) {
        augmentNativeMenu(menu, pendingNativeRow);
        cleanupNativeWatch();
      }
    });
    nativeMenuObserver.observe(document.body, { childList: true, subtree: true });
    nativeMenuTimer = setTimeout(cleanupNativeWatch, 600);
  };

  const onSidebarContextMenu = (event: MouseEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const row = target.closest<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR);
    if (!row) return;
    // Don't interfere with our own custom three-dot menu
    if (target.closest(`[${CUSTOM_MENU_ATTRIBUTE}]`)) return;
    pendingNativeRow = row;
    requestAnimationFrame(watchForNativeMenu);
  };

  const sidebarEl = document.querySelector<HTMLElement>(SIDEBAR_SCOPE);
  sidebarEl?.addEventListener("contextmenu", onSidebarContextMenu, { capture: true });

  const renderBar = (project: SidebarProject, entry: ProjectBarEntry): void => {
    const key = projectKey(project);
    const state = threadFolderProject(config, key);
    const selected = selectedThreadFolder(state);
    const m = threadFolderMessages(options.getLocale());
    const signature = JSON.stringify([
      options.getLocale(),
      project.label,
      state.folders,
      state.assignments,
      selected,
      failure ? String(failure) : null,
    ]);
    if (entry.signature === signature) return;
    entry.signature = signature;
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    const chips: Array<{ id: string | null; label: string }> = [
      { id: null, label: m.all },
      ...(state.folders.length ? [{ id: UNASSIGNED_THREAD_FOLDER_ID, label: m.unassigned }] : []),
      ...state.folders.map((folder) => ({ id: folder.id, label: folder.name })),
    ];
    for (const chip of chips) {
      const item = button(chip.label, () => {
        const next = withThreadFolderProject(config, key, { ...state, selected: chip.id });
        void persist(next).catch(() => undefined);
      });
      item.setAttribute("aria-pressed", String(selected === chip.id));
      group.append(item);
    }
    const manage = document.createElement("button");
    manage.type = "button";
    manage.setAttribute(MANAGE_ATTRIBUTE, "");
    manage.title = m.manage;
    manage.setAttribute("aria-label", m.manage);
    manage.append(createElement(Settings2, { width: 13, height: 13, "aria-hidden": "true" }));
    manage.addEventListener("click", () => configure(project, key));
    const error = document.createElement("span");
    error.setAttribute("role", "alert");
    error.hidden = !failure;
    error.textContent = failure ? `${m.failed}${String(failure)}` : "";
    entry.bar.replaceChildren(group, manage, error);
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
      const selected = selectedThreadFolder(state);
      const threadId = nativeThreadId(hostId, row);
      const assigned = threadId ? state.assignments[threadId] : undefined;
      const hidden =
        selected === null
          ? false
          : selected === UNASSIGNED_THREAD_FOLDER_ID
            ? Boolean(assigned)
            : assigned !== selected;
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
      cleanupNativeWatch();
      sidebarEl?.removeEventListener("contextmenu", onSidebarContextMenu, { capture: true });
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
