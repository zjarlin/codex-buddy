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
  type SidebarProject,
  withProjectTabs,
} from "./model.js";
import {
  ProjectSourceControl,
  type ProjectOriginClient,
  type ProjectSourceGroupState,
} from "./source-control.js";
import {
  PROJECT_SOURCE_DEFERRED_KEY,
  PROJECT_SOURCE_RETENTION_KEY,
  projectSourceId,
} from "./source-model.js";
import { hiddenProjectSourceIds } from "../renderer-project-sources.js";
import {
  PROJECT_CREATE_SELECTOR,
  PROJECT_ROW_SELECTOR,
  projectMenu,
  projectPaths,
  rowProject,
  threadProject,
  type ThreadProjectTarget,
} from "./native-binding.js";
import {
  RENDERER_INJECTED_ATTRIBUTE,
  mutationAffectsElements,
  mutationIsRendererOwnedWrite,
} from "../renderer-dom-mutations.js";
import { getDomMutationHub } from "../renderer-mutation-hub.js";
import { createRecentSectionCollapse } from "./recent-section.js";
import { createProjectTabSearch } from "./search-picker.js";
import { projectTabsStyle } from "./styles.js";

const SIDEBAR_SCOPE = "#app-shell-sidebar";
const HIDDEN = "data-codexhost-project-tab-hidden";
const SOURCE_HIDDEN = "data-codexhost-project-source-hidden";
const MOVE = "data-codexhost-project-tab-move";
const MENU_ITEMS = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
const SIDEBAR_THREAD_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
const SIDEBAR_THREAD_ID_ATTRIBUTE = "data-app-action-sidebar-thread-id";
const SIDEBAR_THREAD_HOST_ID_ATTRIBUTE = "data-app-action-sidebar-thread-host-id";
const CREATE_INTENT_TTL_MS = 2 * 60 * 1000;

interface ProjectTabsPersistenceClient {
  getProjectTabs?(): Promise<ProjectTabsState>;
  setProjectTabs?(config: ProjectTabsConfig): Promise<ProjectTabsState>;
}

export interface RendererProjectTabsControl {
  refresh(): void;
  revealThread(input: ThreadProjectTarget): string | null;
  dispose(): void;
}

export function installProjectTabs(options: {
  getLocale(): string;
  getClient?(): ProjectTabsPersistenceClient | null;
  /** 当前 Host 是否仍连接；缺省视为可用。 */
  isHostAvailable?(hostId: string): boolean;
  /** 读取本地或 SSH 工作区的 Git 来源。缺省时只按项目名去重。 */
  getSourceClient?(hostId: string): ProjectOriginClient | null;
}): RendererProjectTabsControl {
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
      // 无法解析的镜像不代表已保存过设置；Host 为空时仍应迁移预置 Tab，
      // 只有没有 Host 且本地也无法恢复时才把它当作真实存储错误。
      hasLocalConfig = false;
      localReadFailure = error;
      failure = error;
    }
  };
  const resetLocalSnapshot = (): void => {
    config = defaultProjectTabs();
    hasLocalConfig = false;
    localReadFailure = null;
    failure = null;
    try {
      // 无法解析的镜像键留着只会让每次启动重复走损坏分支，Host 已确认可用
      // 时直接删除；删除失败也只是回到可重建的默认状态。
      window.localStorage.removeItem(PROJECT_TABS_STORAGE_KEY);
    } catch {
      // Storage 不可用不属于项目 Tab 配置失败，Host 仍是权威来源。
    }
  };
  read();
  let disposed = false;
  let scheduled = false;
  let refreshFrame: number | null = null;
  let signature = "";
  let dialog: HTMLDialogElement | null = null;
  const bar = document.createElement("div");
  bar.setAttribute("data-codexhost-project-tabs", "");
  bar.setAttribute(RENDERER_INJECTED_ATTRIBUTE, "");
  const group = document.createElement("div");
  group.setAttribute("role", "group");
  let tabButtons: { id: string | null; element: HTMLButtonElement }[] = [];
  const actions = document.createElement("div");
  actions.setAttribute("data-codexhost-project-tab-actions", "");
  const empty = document.createElement("p");
  empty.setAttribute("data-codexhost-project-tabs-empty", "");
  empty.setAttribute(RENDERER_INJECTED_ATTRIBUTE, "");
  empty.setAttribute("role", "status");
  empty.hidden = true;
  const error = document.createElement("p");
  error.setAttribute("data-codexhost-project-tabs-error", "");
  error.setAttribute(RENDERER_INJECTED_ATTRIBUTE, "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const hiddenRows = new Set<HTMLElement>();
  const sourceHiddenRows = new Set<HTMLElement>();
  const menus = new Map<HTMLElement, { anchor: HTMLElement; item: HTMLElement }>();
  let loadedClient: Required<ProjectTabsPersistenceClient> | null = null;
  let loadingClient: Required<ProjectTabsPersistenceClient> | null = null;
  let hostWrite = Promise.resolve();
  // Host 客户端尚未就绪时，选择先落到 localStorage 镜像并在这里排队；
  // 客户端出现后必须先补写这份更新，再读取 Host，否则旧 Host 配置会覆盖
  // 用户刚做的选择。
  let pendingHostConfig: { revision: number; config: ProjectTabsConfig } | null = null;
  const collapseRecents = createRecentSectionCollapse();
  const sourceControl = new ProjectSourceControl({
    // Storage 在禁用 cookie 的窗口里可能连读取 getter 都抛错；此时只丢失
    // 跨重启记忆，当前会话仍按实时 origin 去重。
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return { getItem: () => null, setItem: () => undefined };
      }
    })(),
    getClient: (hostId) => options.getSourceClient?.(hostId) ?? null,
    onUpdate: () => refresh(),
  });
  const projectSources = (
    rowProjects: readonly { row: HTMLElement; project: SidebarProject | null }[],
  ): ProjectSourceGroupState[] => {
    // 连接状态与来源客户端都来自原生路由发现（会回溯 React Fiber）；同一次刷新里
    // 每个 Host 只解析一次，避免按项目行重复做同一份全页发现。
    const availability = new Map<string, boolean>();
    const clients = new Map<string, ProjectOriginClient | null>();
    const hostAvailable = (hostId: string): boolean => {
      const cached = availability.get(hostId);
      if (cached !== undefined) return cached;
      const value = options.isHostAvailable?.(hostId) ?? true;
      availability.set(hostId, value);
      return value;
    };
    const sourceClient = (hostId: string): ProjectOriginClient | null => {
      if (clients.has(hostId)) return clients.get(hostId) ?? null;
      const value = options.getSourceClient?.(hostId) ?? null;
      clients.set(hostId, value);
      return value;
    };
    const candidates = new Map<
      string,
      {
        id: string;
        name: string;
        hostId: string;
        scope: "local" | "remote";
        paths: Set<string>;
        available: boolean;
      }
    >();
    for (const { project } of rowProjects) {
      if (!project) continue;
      const id = projectSourceId(project);
      const hostId = project.projectKind === "local" ? "local" : (project.hostId ?? "");
      if (!hostId) continue;
      const scope = project.projectKind;
      const paths = projectPaths(project);
      const available = scope === "local" ? true : hostAvailable(hostId);
      const current = candidates.get(id);
      if (current) {
        for (const path of paths) current.paths.add(path);
        current.available ||= available;
      } else {
        candidates.set(id, {
          id,
          name: project.label,
          hostId,
          scope,
          paths: new Set(paths),
          available,
        });
      }
    }
    return sourceControl.update(
      [...candidates.values()].map((candidate) => ({
        ...candidate,
        paths: [...candidate.paths],
      })),
      sourceClient,
    ).groups;
  };
  const openSourceChoices = (groups: readonly ProjectSourceGroupState[]): void => {
    if (!groups.length || dialog || disposed) return;
    const m = projectTabsMessages(options.getLocale());
    const pending = [...groups];
    let settled = false;
    const picker = openProjectDialog(m.sourceTitle, () => {
      if (dialog === picker) dialog = null;
      // 关闭（包括 Escape）与“稍后决定”一样只推迟当前来源集合的询问，
      // 避免用户已经看过对话框后仍按帧重复弹出。
      if (!settled) {
        for (const group of pending) {
          sourceControl.defer(
            group.key,
            group.available.map((source) => source.id),
          );
        }
      }
      refresh();
    });
    dialog = picker;
    const hint = document.createElement("p");
    hint.textContent = m.sourceHint;
    const choices = document.createElement("div");
    choices.className = "project-source-choices";
    const render = (): void => {
      choices.replaceChildren();
      for (const group of pending) {
        const section = document.createElement("section");
        section.className = "project-source-group";
        const heading = document.createElement("h3");
        heading.textContent = group.sources[0]?.name ?? group.key;
        section.append(heading);
        for (const source of group.available) {
          const choice = button(source.name, () => {
            sourceControl.choose(group.key, source.id);
            pending.splice(pending.indexOf(group), 1);
            if (pending.length === 0) picker.close();
            else render();
          });
          choice.className = "project-source-choice";
          // 同名仓库的多个副本常常同名，可访问名称带上 Host 才能区分。
          choice.setAttribute("aria-label", `${m.sourceChoose} ${source.name} · ${source.hostId}`);
          const scope = document.createElement("span");
          scope.className = "project-source-scope";
          scope.textContent = source.scope === "local" ? m.sourceLocal : m.sourceRemote;
          const copy = document.createElement("span");
          copy.className = "project-source-copy";
          const name = document.createElement("strong");
          name.textContent = source.name;
          const detail = document.createElement("span");
          detail.textContent = [source.hostId, ...source.paths].join(" · ");
          copy.append(name, detail);
          choice.append(scope, copy);
          section.append(choice);
        }
        choices.append(section);
      }
    };
    const actions = document.createElement("div");
    actions.className = "project-tab-actions";
    actions.append(
      button(m.sourceLater, () => {
        settled = true;
        for (const group of pending) {
          sourceControl.defer(
            group.key,
            group.available.map((source) => source.id),
          );
        }
        picker.close();
      }),
    );
    render();
    picker.append(hint, choices, actions);
    picker.showModal();
  };

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
  const persist = async (next: ProjectTabsConfig, immediate = false): Promise<void> => {
    try {
      if (!options.getClient) {
        revision += 1;
        mirror(next, true);
        failure = null;
        refresh();
        return;
      }
      const client = persistenceClient();
      const requestedRevision = ++revision;
      if (immediate) {
        // 分类切换先更新界面，后台串行保存；旧请求返回时不得覆盖最新选择。
        config = next;
        refresh();
      }
      if (!client) {
        // Host 暂不可用不是存储失败：先保住本地镜像和待同步配置，界面照常
        // 更新；等 setAdapter() 带来新客户端时再由 refresh() 补写并读取。
        mirror(next, true);
        pendingHostConfig = { revision: requestedRevision, config: next };
        failure = null;
        refresh();
        return;
      }
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
    if (selected === config.selected && !failure) {
      return;
    }
    void persist({ ...config, selected }, true).catch(() => undefined);
  };
  const projectForThread = (input: {
    hostId: string;
    threadId: string;
    project?: string;
    cwd?: string;
  }): SidebarProject | null => {
    const member = threadProject(document, input);
    if (member) return member;
    const hostMatches = (project: SidebarProject): boolean =>
      project.projectKind === "local" ? input.hostId === "local" : project.hostId === input.hostId;
    const projects = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)];
    for (const row of projects) {
      const thread = [...row.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].find(
        (candidate) => {
          if (candidate.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) !== input.hostId) {
            return false;
          }
          // 项目分类只需要稳定定位隐藏行；DOM 上的 host-qualified Thread id 已由
          // 原生侧栏维护，避免把侧栏图标模块及其资源依赖拖进项目 Tab。
          const value = candidate.getAttribute(SIDEBAR_THREAD_ID_ATTRIBUTE);
          return value === input.threadId || value === `${input.hostId}:${input.threadId}`;
        },
      );
      if (!thread) continue;
      const project = rowProject(row);
      if (project && hostMatches(project)) return project;
    }

    return null;
  };

  const revealThread = (input: ThreadProjectTarget): string | null => {
    const project = projectForThread(input);
    // 未解析到归属时保持当前分类，调用方补查元数据后再重试。
    if (!project) return null;
    // 用户明确打开某个副本的会话就是选择该来源：若它正被去重隐藏，
    // 先把它设为保留项，避免“点了会话却看不到项目行”。
    const rowProjects = [...document.querySelectorAll<HTMLElement>(PROJECT_ROW_SELECTOR)].map(
      (row) => ({ row, project: rowProject(row) }),
    );
    const group = projectSources(rowProjects).find((candidate) =>
      candidate.sources.some((source) => source.id === projectSourceId(project)),
    );
    if (
      group &&
      group.selected?.id !== projectSourceId(project) &&
      group.available.some((source) => source.id === projectSourceId(project))
    ) {
      sourceControl.choose(group.key, projectSourceId(project));
      refresh();
    }
    const selected = projectTab(config, project);
    if (selected !== config.selected) select(selected);
    return project?.label ?? null;
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

  const syncLoadedClient = (
    client: Required<ProjectTabsPersistenceClient>,
    pending: { revision: number; config: ProjectTabsConfig } | null,
  ): void => {
    loadingClient = client;
    const startingRevision = revision;
    void (async () => {
      try {
        if (pending) {
          // 待同步配置代表用户最后一次明确操作，必须先落 Host，再做读取。
          const saved = await saveHost(client, pending.config);
          if (saved.config && pendingHostConfig === pending && revision === pending.revision) {
            mirror(saved.config);
          }
        }
        const state = await client.getProjectTabs();
        if (disposed || loadingClient !== client) return;
        // 保存/读取期间用户又做了新操作：新操作自己负责补写 Host，这轮结果
        // 不能覆盖界面，也不能把 pending 当作已同步。
        if (pending && pendingHostConfig !== pending) return;
        if (pending || revision === startingRevision) pendingHostConfig = null;
        loadedClient = client;
        loadingClient = null;
        if (revision === startingRevision) {
          if (state.config) {
            mirror(state.config);
          } else {
            const localSnapshot = hasLocalConfig ? config : null;
            if (localSnapshot) {
              // Host 为空而本地有有效镜像：沿用启动时的迁移规则写回 Host。
              const saved = await saveHost(client, localSnapshot);
              if (saved.config && revision === startingRevision) mirror(saved.config);
            } else {
              // Host 是一次成功的空读取：本地镜像只是可重建副本，损坏的 JSON
              // 不能继续显示“读写失败”。
              resetLocalSnapshot();
            }
          }
        }
        if (localReadFailure) localReadFailure = null;
        failure = null;
        refresh();
      } catch (error) {
        if (disposed || loadingClient !== client) return;
        loadingClient = null;
        // 读取失败后不记成已加载：下一次 refresh()（侧栏变化、Host 路由切换、
        // storage 事件或适配器更新）会重试，而不是永久停在“读写失败”。
        loadedClient = null;
        failure = error;
        refresh();
      }
    })();
  };
  function refresh(): void {
    if (disposed) {
      return;
    }
    collapseRecents(config.selected);
    const client = persistenceClient();
    if (client && client !== loadedClient && client !== loadingClient) {
      syncLoadedClient(client, pendingHostConfig);
    } else if (!client && localReadFailure) {
      failure = localReadFailure;
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
    const nextSignature = JSON.stringify([options.getLocale(), config.tabs]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      group.setAttribute("aria-label", m.title);
      tabButtons = [{ id: null, name: m.all }, ...config.tabs].map((tab) => {
        const item = button(tab.name, () => select(tab.id));
        return { id: tab.id, element: item };
      });
      group.replaceChildren(...tabButtons.map(({ element }) => element));
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
    // 仅更新选中标记，保留按钮节点与焦点，避免刷新打断正在进行的点击。
    for (const { id, element } of tabButtons) {
      const pressed = String(config.selected === id);
      if (element.getAttribute("aria-pressed") !== pressed) {
        element.setAttribute("aria-pressed", pressed);
      }
    }
    for (const row of hiddenRows) {
      if (!row.isConnected || !rows.includes(row)) {
        row.removeAttribute(HIDDEN);
        hiddenRows.delete(row);
      }
    }
    for (const row of sourceHiddenRows) {
      if (!row.isConnected || !rows.includes(row)) {
        row.removeAttribute(SOURCE_HIDDEN);
        sourceHiddenRows.delete(row);
      }
    }
    const sourceGroups = projectSources(rowProjects);
    const hiddenSources = new Set<string>();
    for (const group of sourceGroups) {
      for (const id of hiddenProjectSourceIds(group)) hiddenSources.add(id);
    }
    const pendingChoices = sourceGroups.filter(
      (group) =>
        group.needsChoice &&
        !sourceControl.isDeferred(
          group.key,
          group.available.map((source) => source.id),
        ),
    );
    let matched = 0;
    for (const { row, project } of rowProjects) {
      const tabHidden = project !== null && projectTab(config, project) !== config.selected;
      if (tabHidden) {
        if (!row.hasAttribute(HIDDEN)) {
          row.setAttribute(HIDDEN, "");
        }
        hiddenRows.add(row);
      } else {
        row.removeAttribute(HIDDEN);
        hiddenRows.delete(row);
      }
      const sourceHidden = project !== null && hiddenSources.has(projectSourceId(project));
      if (sourceHidden) {
        if (!row.hasAttribute(SOURCE_HIDDEN)) {
          row.setAttribute(SOURCE_HIDDEN, "");
        }
        sourceHiddenRows.add(row);
      } else {
        row.removeAttribute(SOURCE_HIDDEN);
        sourceHiddenRows.delete(row);
      }
      if (!tabHidden && !sourceHidden) matched += 1;
    }
    if (empty.textContent !== m.empty) {
      empty.textContent = m.empty;
    }
    empty.hidden = matched > 0;
    // 每个来源组只在可用来源集合变化后询问一次；用户选择“稍后决定”或
    // 已有保留项时不再重复弹窗。多个仓库合并在同一个对话框里处理。
    //
    // origin 是逐个异步读取的：只读到部分来源时，尚未返回的副本还按项目名独立
    // 分组，此时弹窗会少列来源，用户推迟后还会因来源集合补齐而立刻再次弹出。
    // 等这批读取有结论再询问；读取失败或超时会按行独立显示，不会无限等待。
    if (!dialog && pendingChoices.length > 0 && !sourceControl.pendingOrigins()) {
      openSourceChoices(pendingChoices);
    }
    const detail = failure ? m.failed + String(failure) : "";
    if (error.textContent !== detail) {
      error.textContent = detail;
    }
    error.hidden = !failure;
    refreshMenus();
  }

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
    // 另一个窗口改了保留来源：按它重新分组即可，不重读项目 Tab 配置。
    if (
      event.key === PROJECT_SOURCE_RETENTION_KEY ||
      event.key === PROJECT_SOURCE_DEFERRED_KEY ||
      event.key === null
    ) {
      refresh();
      return;
    }
    if (event.key !== PROJECT_TABS_STORAGE_KEY) {
      return;
    }
    dialog?.close();
    revision += 1;
    if (loadedClient) {
      // Host 已确认时 localStorage 只是镜像。先采用其他窗口刚写入的有效镜像，
      // 损坏的镜像则静默忽略；随后向 Host 校正。hostWrite 保证读取排在本窗口
      // 正在进行的保存之后，revision 防止过期的读取覆盖更新的选择。
      let localSnapshot: ProjectTabsConfig | null = null;
      try {
        localSnapshot = parseProjectTabs(window.localStorage.getItem(PROJECT_TABS_STORAGE_KEY));
      } catch (error) {
        localReadFailure = error;
      }
      if (localSnapshot) {
        config = localSnapshot;
        hasLocalConfig = true;
        localReadFailure = null;
        failure = null;
        refresh();
      }
      if (!loadedClient) {
        refresh();
        return;
      }
      const client = loadedClient;
      const revisionAtRead = revision;
      void hostWrite.then(() =>
        client.getProjectTabs().then(
          async (state) => {
            if (disposed || loadedClient !== client || revision !== revisionAtRead) return;
            if (state.config) {
              config = state.config;
              hasLocalConfig = true;
              localReadFailure = null;
              failure = null;
              mirror(state.config);
            } else if (localSnapshot) {
              // Host 为空而镜像有效：沿用启动时的迁移规则写回 Host。
              try {
                const saved = await saveHost(client, localSnapshot);
                if (disposed || loadedClient !== client || revision !== revisionAtRead) return;
                if (saved.config) {
                  config = saved.config;
                  mirror(saved.config);
                }
                failure = null;
              } catch (error) {
                if (disposed || loadedClient !== client) return;
                failure = error;
              }
            } else if (localReadFailure) {
              // 没有可用镜像且 Host 为空：保留当前内存配置，不把镜像损坏
              // 当作 Host 读写失败。
              failure = null;
            } else {
              failure = null;
            }
            refresh();
          },
          (error: unknown) => {
            if (disposed || loadedClient !== client) return;
            failure = error;
            refresh();
          },
        ),
      );
      return;
    }
    read();
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
    test: (record) =>
      !mutationIsRendererOwnedWrite(record) && mutationAffectsElements(record, SIDEBAR_SCOPE),
    onMutate: () => {
      if (scheduled || disposed) return;
      scheduled = true;
      // 与观察者写入合并在同一帧：微任务频率的全会话回溯会饿死主线程。
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = null;
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
    revealThread,
    dispose() {
      disposed = true;
      stopObserving();
      if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
      refreshFrame = null;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onProjectCreateClick, true);
      window.removeEventListener("storage", onStorage);
      dialog?.close();
      sourceControl.dispose();
      for (const row of hiddenRows) {
        row.removeAttribute(HIDDEN);
      }
      for (const row of sourceHiddenRows) {
        row.removeAttribute(SOURCE_HIDDEN);
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
