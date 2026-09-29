import createElement from "lucide/dist/esm/createElement.mjs";
import Settings2 from "lucide/dist/esm/icons/settings-2.mjs";
import { button, configureProjectTabs, openProjectDialog } from "./dialog.js";
import { projectTabsMessages } from "./messages.js";
import {
  defaultProjectTabs,
  parseProjectTabs,
  PROJECT_TABS_STORAGE_KEY,
  projectKey,
  projectTab,
  withProjectTabs,
  type ProjectTabsConfig,
} from "./model.js";
import { PROJECT_ROW_SELECTOR, projectMenu, rowProject } from "./native-binding.js";
import { projectTabsStyle } from "./styles.js";

const HIDDEN = "data-codexhost-project-tab-hidden";
const MOVE = "data-codexhost-project-tab-move";
const MENU_ITEMS = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

export function installProjectTabs(options: { getLocale(): string }): {
  refresh(): void;
  dispose(): void;
} {
  const styles = document.createElement("style");
  styles.textContent = projectTabsStyle;
  document.head.append(styles);
  let config = defaultProjectTabs();
  let failure: unknown = null;
  const read = (): void => {
    try {
      config = parseProjectTabs(window.localStorage.getItem(PROJECT_TABS_STORAGE_KEY));
      failure = null;
    } catch (error) {
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

  const persist = (next: ProjectTabsConfig): void => {
    window.localStorage.setItem(PROJECT_TABS_STORAGE_KEY, JSON.stringify(next));
    config = next;
    failure = null;
    refresh();
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
    try {
      persist({ ...config, selected });
    } catch (error) {
      failure = error;
      refresh();
    }
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
      const choose = (id: string | null): void => {
        const assignments = { ...config.assignments };
        if (id) {
          assignments[key] = id;
        } else {
          Reflect.deleteProperty(assignments, key);
        }
        try {
          persist({ ...config, assignments });
          picker.close();
        } catch (error) {
          message.textContent = m.failed + String(error);
          message.hidden = false;
        }
      };
      const auto = button(m.automatic, () => choose(null));
      auto.setAttribute("aria-pressed", String(!config.assignments[key]));
      destinations.append(auto);
      for (const tab of config.tabs) {
        const choice = button(tab.name, () => choose(tab.id));
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
    const rows = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)];
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
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", m.title);
      for (const tab of [{ id: null, name: m.all }, ...config.tabs]) {
        const item = button(tab.name, () => select(tab.id));
        item.setAttribute("aria-pressed", String(config.selected === tab.id));
        group.append(item);
      }
      const settings = button("", configure);
      settings.setAttribute("aria-label", m.configure);
      settings.title = m.configure;
      settings.append(createElement(Settings2, { width: 16, height: 16, "aria-hidden": "true" }));
      const hadFocus = bar.contains(document.activeElement);
      bar.replaceChildren(group, settings);
      if (hadFocus) {
        group.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
      }
    }
    for (const row of hiddenRows) {
      if (!row.isConnected || !rows.includes(row)) {
        row.removeAttribute(HIDDEN);
        hiddenRows.delete(row);
      }
    }
    let matched = 0;
    for (const row of rows) {
      const project = rowProject(row);
      const hidden =
        config.selected !== null &&
        project !== null &&
        projectTab(config, project) !== config.selected;
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
    empty.hidden = config.selected === null || matched > 0;
    const detail = failure ? m.failed + String(failure) : "";
    if (error.textContent !== detail) {
      error.textContent = detail;
    }
    error.hidden = !failure;
    refreshMenus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
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
    refresh();
  };
  const observer = new MutationObserver(() => {
    if (scheduled || disposed) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      refresh();
    });
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "aria-label",
      "data-sidebar-project-kind",
      "data-sidebar-project-container-id",
    ],
  });
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("storage", onStorage);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("storage", onStorage);
      dialog?.close();
      for (const row of hiddenRows) {
        row.removeAttribute(HIDDEN);
      }
      for (const entry of menus.values()) {
        entry.item.remove();
      }
      menus.clear();
      bar.remove();
      empty.remove();
      error.remove();
      styles.remove();
    },
  };
}
