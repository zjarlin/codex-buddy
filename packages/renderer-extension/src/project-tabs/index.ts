import createElement from "lucide/dist/esm/createElement.mjs";
import Settings2 from "lucide/dist/esm/icons/settings-2.mjs";
import type { ProjectTabsConfig, ProjectTabsState } from "@codexhost/shared-contracts";
import { button, configureProjectTabs, openProjectDialog } from "./dialog.js";
import { projectTabsMessages } from "./messages.js";
import {
  defaultProjectTabs,
  parseProjectTabs,
  pendingProjectAssignment,
  PROJECT_TABS_STORAGE_KEY,
  projectAssignment,
  projectKey,
  projectTab,
  withProjectTabs,
} from "./model.js";
import {
  PROJECT_CREATE_SELECTOR,
  PROJECT_ROW_SELECTOR,
  projectMenu,
  rowProject,
} from "./native-binding.js";
import { mutationAffectsElements } from "../renderer-dom-mutations.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import { createRecentSectionCollapse } from "./recent-section.js";
import { createProjectTabSearch } from "./search-picker.js";
import { projectTabsStyle } from "./styles.js";

const SIDEBAR_SCOPE = "#app-shell-sidebar";
const HIDDEN = "data-codexhost-project-tab-hidden";
const MOVE = "data-codexhost-project-tab-move";
const MENU_ITEMS = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
const CREATE_INTENT_TTL_MS = 2 * 60 * 1000;

interface ProjectTabsPersistenceClient {
  getProjectTabs?(): Promise<ProjectTabsState>;
  setProjectTabs?(config: ProjectTabsConfig): Promise<ProjectTabsState>;
}

export function installProjectTabs(options: {
  getLocale(): string;
  getClient?(): ProjectTabsPersistenceClient | null;
}): {
  refresh(): void;
  dispose(): void;
} {
  const styles = document.createElement("style");
  styles.textContent = projectTabsStyle;
  document.head.append(styles);
  let config = defaultProjectTabs();
  let failure: unknown = null;
  let localReadFailure: unknown = null;
  let hasLocalConfig = false;
  let revision = 0;
  const pendingCreate = pendingProjectAssignment(CREATE_INTENT_TTL_MS);
  const knownProjectKeys = new Set<string>();
  const read = (): void => {
    try {
      const raw = window.localStorage.getItem(PROJECT_TABS_STORAGE_KEY);
      config = parseProjectTabs(raw);
      hasLocalConfig = raw !== null;
      localReadFailure = null;
      failure = null;
    } catch (error) {
      hasLocalConfig = false;
      localReadFailure = error;
      failure = error;
    }
  };
  read();
  let disposed = false;
  let scheduled = false;
  let signature = "";
  let dialog: HTMLDialogElement | null = null;
  const bar = document.createElement("div");
  bar.setAttribute("data-codexhost-project-tabs", "");
  const group = document.createElement("div");
  group.setAttribute("role", "group");
  const actions = document.createElement("div");
  actions.setAttribute("data-codexhost-project-tab-actions", "");
  const empty = document.createElement("p");
  empty.setAttribute("data-codexhost-project-tabs-empty", "");
  empty.setAttribute("role", "status");
  empty.hidden = true;
  const error = document.createElement("p");
  error.setAttribute("data-codexhost-project-tabs-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const hiddenRows = new Set<HTMLElement>();
  const menus = new Map<HTMLElement, { anchor: HTMLElement; item: HTMLElement }>();
  let loadedClient: ProjectTabsPersistenceClient | null = null;
  let loadingClient: ProjectTabsPersistenceClient | null = null;
  let hostWrite = Promise.resolve();
  const collapseRecents = createRecentSectionCollapse();

  const persistenceClient = (): Required<ProjectTabsPersistenceClient> | null => {
    const client = options.getClient?.();
    return client?.getProjectTabs && client.setProjectTabs
      ? (client as Required<ProjectTabsPersistenceClient>)
      : null;
  };
  const mirror = (next: ProjectTabsConfig, requireLocal = false): void => {
    try {
      window.localStorage.setItem(PROJECT_TABS_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      if (requireLocal) throw error;
      failure = error;
    }
    config = next;
    hasLocalConfig = true;
  };
  const saveHost = (
    client: Required<ProjectTabsPersistenceClient>,
    next: ProjectTabsConfig,
  ): Promise<ProjectTabsState> => {
    const operation = hostWrite.then(() => client.setProjectTabs(next));
    hostWrite = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
  const persist = async (next: ProjectTabsConfig): Promise<void> => {
    try {
      if (!options.getClient) {
        revision += 1;
        mirror(next, true);
        failure = null;
        refresh();
        return;
      }
      const client = persistenceClient();
      if (!client) throw new Error("Local Host project-tab persistence is unavailable");
      const requestedRevision = ++revision;
      const saved = await saveHost(client, next);
      if (!saved.config) throw new Error("Local Host returned an empty project-tab configuration");
      if (revision === requestedRevision) mirror(saved.config);
      failure = null;
      refresh();
    } catch (error) {
      failure = error;
      refresh();
      throw error;
    }
  };
  const configure = (): void => {
    if (dialog) {
      return;
    }
    const configuration = configureProjectTabs({
      config,
      messages: projectTabsMessages(options.getLocale()),
      save: (tabs) => persist(withProjectTabs(config, tabs)),
      onClose: () => {
        if (dialog === configuration) {
          dialog = null;
        }
      },
    });
    dialog = configuration;
  };
  const select = (selected: string | null): void => {
    void persist({ ...config, selected }).catch(() => undefined);
  };
  const search = createProjectTabSearch({
    getCurrent: () => config.selected,
    select,
  });
  const settings = button("", configure);
  const onProjectCreateClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(PROJECT_CREATE_SELECTOR)) {
      return;
    }
    pendingCreate.ensure(
      config.selected && config.tabs.some((tab) => tab.id === config.selected)
        ? config.selected
        : null,
    );
  };
  const move = (anchor: HTMLElement): void => {
    const target = projectMenu(anchor);
    if (!target || dialog) {
      return;
    }
    target.close();
    // 等待原生菜单完成焦点归还，再打开模态选择器。
    queueMicrotask(() => {
      if (disposed || dialog) {
        return;
      }
      const m = projectTabsMessages(options.getLocale());
      const picker = openProjectDialog(m.moveTitle, () => {
        if (dialog === picker) {
          dialog = null;
        }
      });
      dialog = picker;
      const name = document.createElement("p");
      name.textContent = target.project.label;
      const destinations = document.createElement("div");
      destinations.className = "project-tab-destinations";
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.hidden = true;
      const key = projectKey(target.project);
      const choose = async (id: string | null): Promise<void> => {
        const assignments = { ...config.assignments };
        if (id) {
          assignments[key] = id;
        } else {
          Reflect.deleteProperty(assignments, key);
        }
        try {
          await persist({ ...config, assignments });
          picker.close();
        } catch (error) {
          message.textContent = m.failed + String(error);
          message.hidden = false;
        }
      };
      const auto = button(m.automatic, () => void choose(null));
      auto.setAttribute("aria-pressed", String(!config.assignments[key]));
      destinations.append(auto);
      for (const tab of config.tabs) {
        const choice = button(tab.name, () => void choose(tab.id));
        choice.setAttribute("aria-pressed", String(config.assignments[key] === tab.id));
        destinations.append(choice);
      }
      if (!config.tabs.length) {
        const hint = document.createElement("p");
        hint.textContent = m.noTabs;
        destinations.append(hint);
      }
      const actions = document.createElement("div");
      actions.className = "project-tab-actions";
      actions.append(
        button(m.cancel, () => picker.close()),
        button(m.configure, () => {
          picker.close();
          dialog = null;
          configure();
        }),
      );
      picker.append(name, destinations, message, actions);
      picker.showModal();
    });
  };

  const refreshMenus = (): void => {
    const label = projectTabsMessages(options.getLocale()).move;
    for (const [menu, entry] of menus) {
      if (
        !menu.isConnected ||
        !entry.anchor.isConnected ||
        !entry.item.isConnected ||
        !projectMenu(entry.anchor)
      ) {
        entry.item.remove();
        menus.delete(menu);
      } else if (entry.item.textContent !== label) {
        entry.item.textContent = label;
      }
    }
    for (const anchor of document.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      const menu = anchor.closest<HTMLElement>('[role="menu"]');
      if (!menu || menus.has(menu) || anchor.hasAttribute(MOVE) || !projectMenu(anchor)) {
        continue;
      }
      const item = document.createElement("div");
      item.className = anchor.className;
      item.setAttribute("role", "menuitem");
      item.setAttribute(MOVE, "");
      item.tabIndex = -1;
      item.textContent = label;
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        move(anchor);
      });
      anchor.after(item);
      menus.set(menu, { anchor, item });
    }
  };

  const refresh = (): void => {
    if (disposed) {
      return;
    }
    collapseRecents(config.selected);
    const client = persistenceClient();
    if (client && client !== loadedClient && client !== loadingClient) {
      loadingClient = client;
      const startedRevision = revision;
      const localSnapshot = hasLocalConfig ? config : null;
      void (async () => {
        try {
          const state = await client.getProjectTabs();
          if (disposed || loadingClient !== client) return;
          if (revision === startedRevision) {
            if (state.config) {
              mirror(state.config);
            } else if (localSnapshot) {
              await saveHost(client, localSnapshot);
            }
          }
          loadedClient = client;
          loadingClient = null;
          failure = state.config || localSnapshot ? null : localReadFailure;
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
    const rows = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)];
    const rowProjects = rows.map((row) => ({ row, project: rowProject(row) }));
    const created = pendingCreate.consume(
      rowProjects.flatMap(({ project }) =>
        project && !knownProjectKeys.has(projectKey(project)) ? [project] : [],
      ),
    );
    if (created) {
      const next = projectAssignment(config, created.tab, created.project);
      if (next) void persist(next).catch(() => undefined);
    }
    for (const { project } of rowProjects) {
      if (project) {
        knownProjectKeys.add(projectKey(project));
      }
    }
    const firstRow = rows[0];
    if (!bar.isConnected && firstRow) {
      // 放在所有原生项目行的公共容器前端，保持原有状态筛选与分区结构。
      let parent = firstRow.parentElement;
      while (parent && rows.some((row) => !parent?.contains(row))) {
        parent = parent.parentElement;
      }
      if (parent && parent !== document.body) {
        // Virtualized project lists can place a flexible spacer before the rows.
        // Mount before the first content child so that spacer cannot push the
        // filter bar into the middle of the available sidebar height.
        const firstChild = parent.firstElementChild;
        if (firstChild) {
          parent.insertBefore(bar, firstChild);
        } else {
          parent.append(bar);
        }
      }
    }
    if (bar.isConnected) {
      if (bar.nextSibling !== error) {
        bar.after(error);
      }
      if (error.nextSibling !== empty) {
        error.after(empty);
      }
    }
    const m = projectTabsMessages(options.getLocale());
    const nextSignature = JSON.stringify([options.getLocale(), config.tabs, config.selected]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      group.setAttribute("aria-label", m.title);
      const items = [{ id: null, name: m.all }, ...config.tabs].map((tab) => {
        const item = button(tab.name, () => select(tab.id));
        item.setAttribute("aria-pressed", String(config.selected === tab.id));
        return item;
      });
      group.replaceChildren(...items);
      settings.setAttribute("aria-label", m.configure);
      settings.title = m.configure;
      if (!settings.querySelector("svg")) {
        settings.append(createElement(Settings2, { width: 16, height: 16, "aria-hidden": "true" }));
      }
      search.update(
        [{ id: null, name: m.all }, ...config.tabs.map((tab) => ({ id: tab.id, name: tab.name }))],
        m,
      );
      if (!actions.contains(search.button)) {
        actions.append(search.button, settings);
      }
      if (!bar.contains(group)) {
        bar.replaceChildren(group, actions);
      }
    }
    for (const row of hiddenRows) {
      if (!row.isConnected || !rows.includes(row)) {
        row.removeAttribute(HIDDEN);
        hiddenRows.delete(row);
      }
    }
    let matched = 0;
    for (const { row, project } of rowProjects) {
      const hidden = project !== null && projectTab(config, project) !== config.selected;
      if (hidden) {
        if (!row.hasAttribute(HIDDEN)) {
          row.setAttribute(HIDDEN, "");
        }
        hiddenRows.add(row);
      } else {
        row.removeAttribute(HIDDEN);
        hiddenRows.delete(row);
        matched += 1;
      }
    }
    if (empty.textContent !== m.empty) {
      empty.textContent = m.empty;
    }
    empty.hidden = matched > 0;
    const detail = failure ? m.failed + String(failure) : "";
    if (error.textContent !== detail) {
      error.textContent = detail;
    }
    error.hidden = !failure;
    refreshMenus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && pendingCreate.current()) {
      pendingCreate.clear();
    }
    if (search.handleKeyDown(event)) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const menu = target?.closest<HTMLElement>('[role="menu"]');
    const entry = menu ? menus.get(menu) : null;
    if (
      !menu ||
      !entry ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    const current = target?.closest<HTMLElement>(MENU_ITEMS);
    if (current === entry.item && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      move(entry.anchor);
      return;
    }
    const items = [...menu.querySelectorAll<HTMLElement>(MENU_ITEMS)].filter(
      (item) =>
        item.closest('[role="menu"]') === menu &&
        !item.hidden &&
        item.getAttribute("aria-disabled") !== "true" &&
        !item.hasAttribute("data-disabled"),
    );
    const index = current ? items.indexOf(current) : -1;
    const navigation: Record<string, HTMLElement | undefined> = {
      ArrowDown: items[(index + 1) % items.length],
      ArrowUp: items[(index - 1 + items.length) % items.length],
      Home: items[0],
      End: items.at(-1),
    };
    const next = navigation[event.key];
    if (next && (current === entry.item || next === entry.item)) {
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    }
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== PROJECT_TABS_STORAGE_KEY && event.key !== null) {
      return;
    }
    dialog?.close();
    read();
    revision += 1;
    refresh();
  };
  // 只关心侧栏结构：整页订阅会在聊天内容流水时反复触发 refresh()，而 refresh
  // 会对每个项目行做 fiber 回溯（committedReactAncestors）。按侧栏子树收窄。
  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList", "characterData", "attributes"],
    attributeFilter: [
      "aria-label",
      "data-sidebar-project-kind",
      "data-sidebar-project-container-id",
      "data-app-action-sidebar-section-heading",
      "data-app-action-sidebar-section-collapsed",
      "aria-expanded",
    ],
    test: (record) => mutationAffectsElements(record, SIDEBAR_SCOPE),
    onMutate: () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        refresh();
      });
    },
  });
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onProjectCreateClick, true);
  window.addEventListener("storage", onStorage);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      stopObserving();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onProjectCreateClick, true);
      window.removeEventListener("storage", onStorage);
      dialog?.close();
      for (const row of hiddenRows) {
        row.removeAttribute(HIDDEN);
      }
      for (const entry of menus.values()) {
        entry.item.remove();
      }
      menus.clear();
      search.dispose();
      bar.remove();
      empty.remove();
      error.remove();
      styles.remove();
    },
  };
}
