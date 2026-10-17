import createElement from "lucide/dist/esm/createElement.mjs";
import Folder from "lucide/dist/esm/icons/folder.mjs";
import LoaderCircle from "lucide/dist/esm/icons/loader-circle.mjs";
import Plus from "lucide/dist/esm/icons/plus.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
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
  draftIdFromSidebarRowElement,
  threadIdFromSidebarRowElement,
} from "../renderer-sidebar-agent-icons.js";
import { sidebarThreadNativeStatus } from "../renderer-sidebar-thread-status.js";
import { nativeProjectStart } from "../renderer-native-project-start.js";
import { createPendingFolderThreads, type PendingThreadRow } from "./pending-threads.js";

const BAR_ATTRIBUTE = "data-codexhost-thread-folders";
const MOVE_ATTRIBUTE = "data-codexhost-thread-folder-move";
const HIDDEN_ATTRIBUTE = "data-codexhost-thread-folder-hidden";
const CUSTOM_MENU_ATTRIBUTE = "data-codexhost-thread-actions-menu";
const STATUS_ATTRIBUTE = "data-codexhost-folder-thread-status";
const TITLE_ATTRIBUTE = "data-codexhost-folder-thread-title";
const RECOVERY_ATTRIBUTE = "data-buddy-sidebar-state";
const FOLDER_ATTRIBUTE = "data-codexhost-thread-folder";
const THREAD_ATTRIBUTE = "data-codexhost-folder-thread";
const NEW_THREAD_ATTRIBUTE = "data-codexhost-thread-folder-new-thread";
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

interface SidebarRowIdentity {
  key: string;
  draft: boolean;
}

/**
 * 行的归类身份：已物化会话用原生 Thread ID，未提交的新会话草稿用草稿身份。
 * 草稿身份不写入文件夹配置，只由“在文件夹中新建会话”的待定意图持有。
 */
function rowIdentity(hostId: string, row: HTMLElement): SidebarRowIdentity | null {
  // 草稿必须优先判定：草稿行的原生 Thread ID 读取只会返回 `client-new-thread:`
  // 草稿身份，不能当成已物化会话。
  const draftKey = draftIdFromSidebarRowElement(row);
  if (draftKey) return { key: draftKey, draft: true };
  const threadId = nativeThreadId(hostId, row);
  return threadId ? { key: threadId, draft: false } : null;
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
  const pendingThreads = createPendingFolderThreads();
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

  /** 行身份快照：判定“在文件夹中新建会话”时用于比对点击前后的侧栏。 */
  const rowIdentities = (container: HTMLElement): PendingThreadRow[] => {
    const identities: PendingThreadRow[] = [];
    for (const row of container.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)) {
      const identity = rowIdentity(
        row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local",
        row,
      );
      if (identity) identities.push(identity);
    }
    return identities;
  };

  /**
   * 在指定文件夹里新建会话：先记录待定归类，再用项目自身的原生新建入口打开
   * 新会话，随后出现的会话由 refresh 归入该文件夹。原生入口缺失时保持原状，
   * 不自行拼装 thread/start。
   */
  const startNewThread = (
    project: SidebarProject,
    key: string,
    folderId: string,
    container: HTMLElement,
  ): void => {
    const start = nativeProjectStart(container, project.projectId);
    if (!start) {
      pendingThreads.cancel(key);
      return;
    }
    pendingThreads.begin(key, folderId, rowIdentities(container));
    // 新建的会话会投影在该文件夹里，先展开它，避免用户看不到刚打开的新会话。
    collapsed.delete(JSON.stringify([key, folderId]));
    try {
      start();
    } catch (error) {
      pendingThreads.cancel(key);
      throw error;
    }
    refresh();
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
    const folder =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(`[${FOLDER_ATTRIBUTE}]`)
        : null;
    const folderId = folder?.getAttribute(FOLDER_ATTRIBUTE);
    if (folderId) {
      const target = bars.get(key)?.container;
      if (target) addAction(m.newThread, () => startNewThread(project, key, folderId, target));
    }
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
    if (target.closest(`[${THREAD_ATTRIBUTE}]`)) return;
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
      pendingThreads.state(key),
      rows.map((row) => {
        // 状态签名只进签名计算：running/unread 来自行 Fiber，恢复态来自 Buddy
        // 标记；任一变化都要重建投影，且每行只读一次 Fiber。
        const native = sidebarThreadNativeStatus(row);
        return [
          nativeThreadId(row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local", row),
          draftIdFromSidebarRowElement(row),
          row.textContent,
          row.getAttribute("data-app-action-sidebar-thread-active"),
          native.running,
          native.unread,
          row.getAttribute(RECOVERY_ATTRIBUTE),
        ];
      }),
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
      node.setAttribute(FOLDER_ATTRIBUTE, folder.id);
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
      // 文件夹行右侧的“在文件夹中新建会话”入口。常显而不是悬停才显示：
      // 隐藏式入口在树里既难发现，也会让指针落点落到行上而点不中。
      const create = button("", () => startNewThread(project, key, folder.id, entry.container));
      create.setAttribute(NEW_THREAD_ATTRIBUTE, folder.id);
      create.title = m.newThread;
      create.setAttribute("aria-label", `${m.newThread} · ${folder.name}`);
      const createIcon = document.createElement("span");
      createIcon.setAttribute("aria-hidden", "true");
      createIcon.append(createElement(Plus, { width: 14, height: 14 }));
      create.append(createIcon);
      const header = document.createElement("div");
      header.className = "thread-folder-row";
      header.append(toggle, create);
      // 归属该文件夹的行：已归类会话按原生 Thread ID，尚未提交的新会话按其
      // 草稿身份（“在文件夹中新建会话”的待定意图持有）。
      const members: Array<{ id: string; row: HTMLElement; draft: boolean }> = [];
      for (const row of rows) {
        const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local";
        const identity = rowIdentity(hostId, row);
        if (!identity) continue;
        const filed = identity.draft
          ? pendingThreads.folderFor(key, identity.key)
          : state.assignments[identity.key];
        if (filed === folder.id) members.push({ id: identity.key, row, draft: identity.draft });
      }
      for (const { id, row, draft } of members) {
        const title =
          row.querySelector("[data-thread-title]")?.textContent ?? row.textContent ?? id;
        // 不搬动 React 管理的节点；点击时重新查找当前行，兼容原生列表重绘。
        const findRow = (): HTMLElement | undefined =>
          [...entry.container.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].find(
            (candidate) => {
              const identity = rowIdentity(
                candidate.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) ?? "local",
                candidate,
              );
              return identity?.key === id && identity.draft === draft;
            },
          );
        const item = button("", () => findRow()?.click());
        item.setAttribute("role", "treeitem");
        item.setAttribute(THREAD_ATTRIBUTE, id);
        item.setAttribute(
          "aria-selected",
          String(row.getAttribute("data-app-action-sidebar-thread-active") === "true"),
        );
        // 文件夹内的会话入口与原生行同样需要状态：执行中转圈、失败/中断可恢复、
        // 未读蓝点。状态只在投影时从原生行读取，不复制原生节点。
        const native = sidebarThreadNativeStatus(row);
        const recovery = row.getAttribute(RECOVERY_ATTRIBUTE);
        const status = native.running
          ? "running"
          : recovery === "failed" || recovery === "cancelled" || recovery === "interrupted"
            ? recovery
            : native.unread
              ? "unread"
              : null;
        if (status) item.setAttribute(STATUS_ATTRIBUTE, status);
        const label = document.createElement("span");
        label.setAttribute(TITLE_ATTRIBUTE, "");
        label.textContent = title;
        item.append(label);
        if (status) {
          // 状态文案复用原生语义；恢复动作本身仍在原生行上执行。
          const statusLabel =
            status === "running"
              ? m.running
              : status === "unread"
                ? m.unread
                : status === "failed"
                  ? m.recoverFailed
                  : status === "cancelled"
                    ? m.recoverCancelled
                    : m.recoverInterrupted;
          item.title = `${title} · ${statusLabel}`;
          item.setAttribute("aria-label", item.title);
          const glyph = document.createElement("span");
          glyph.setAttribute("aria-hidden", "true");
          if (status === "running")
            glyph.append(createElement(LoaderCircle, { width: 13, height: 13 }));
          else if (status === "unread") glyph.append(document.createElement("span"));
          else glyph.append(createElement(RefreshCw, { width: 13, height: 13 }));
          item.append(glyph);
        }
        item.addEventListener("contextmenu", (event) => showContextMenu(event, project, findRow()));
        children.append(item);
      }
      node.append(header, children);
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
    // 推进“在文件夹中新建会话”的待定归类：唯一确定时写入归类并结束意图，
    // 出现歧义时放弃。归类持久化成功后由下一次 refresh 投影到文件夹中。
    for (const { container, project } of projects) {
      const key = projectKey(project);
      if (!pendingThreads.state(key)) continue;
      const outcome = pendingThreads.observe(key, rowIdentities(container));
      if (outcome.assigned) {
        void persist(
          withThreadFolderAssignment(
            config,
            key,
            outcome.assigned.threadId,
            outcome.assigned.folderId,
          ),
        ).catch(() => undefined);
      }
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
      // 原生项目行收起时会卸载其会话行，但投影 bar 是外部节点，必须按原生
      // aria-expanded 一并隐藏，否则文件夹树会留在折叠的项目下方。
      entry.bar.hidden = header.getAttribute("aria-expanded") === "false";
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
      const key = projectKey(project);
      const state = threadFolderProject(config, key);
      const identity = rowIdentity(hostId, row);
      // 草稿行不是已物化会话，只能凭“在文件夹中新建会话”的待定意图判断它是否
      // 已被投影进文件夹。
      const projected = identity
        ? identity.draft
          ? pendingThreads.folderFor(key, identity.key)
          : state.assignments[identity.key]
        : undefined;
      const hidden = !failure && state.folders.some((folder) => folder.id === projected);
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
      "aria-expanded",
      "data-app-action-sidebar-thread-active",
      "data-app-action-sidebar-thread-id",
      "data-app-action-sidebar-thread-host-id",
      RECOVERY_ATTRIBUTE,
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
      pendingThreads.clear();
      styles.remove();
    },
  };
}
