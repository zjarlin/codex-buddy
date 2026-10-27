import createElement from "lucide/dist/esm/createElement.mjs";
import Code from "lucide/dist/esm/icons/code.mjs";
import Copy from "lucide/dist/esm/icons/copy.mjs";
import Terminal from "lucide/dist/esm/icons/terminal.mjs";
import X from "lucide/dist/esm/icons/x.mjs";
import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import type { SidebarProject } from "./project-tabs/model.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import { getDomMutationHub } from "./renderer-mutation-hub.js";
import {
  getSharedThreadTerminalPreferenceStore,
  type ThreadTerminalPreferenceStore,
} from "./thread-terminal-preference.js";

const ERROR_ATTRIBUTE = "data-codexhost-project-actions-error";
const ACTION_ATTRIBUTE = "data-codexhost-project-actions";
const COPY_PATH_ATTRIBUTE = `${ACTION_ATTRIBUTE}-copy-path`;
const OPEN_TERMINAL_ATTRIBUTE = `${ACTION_ATTRIBUTE}-open-terminal`;
const OPEN_VSCODE_ATTRIBUTE = `${ACTION_ATTRIBUTE}-open-vscode`;
const CONTRIBUTION_ATTRIBUTE = `${ACTION_ATTRIBUTE}-contribution`;
const STATUS_ATTRIBUTE = `${ACTION_ATTRIBUTE}-status`;
const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

const style = `
[${ERROR_ATTRIBUTE}]{position:fixed;right:16px;bottom:16px;z-index:1200;display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:12px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:8px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-primary,inherit);box-shadow:0 8px 24px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[${ERROR_ATTRIBUTE}] span{min-width:0;overflow-wrap:anywhere}
[${ERROR_ATTRIBUTE}] button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
[${ERROR_ATTRIBUTE}] button:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
[${ERROR_ATTRIBUTE}] button:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[${STATUS_ATTRIBUTE}]{position:fixed;right:16px;bottom:16px;z-index:1200;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:8px 12px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:8px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-secondary,currentColor);box-shadow:0 8px 24px #0003;font:12px/18px system-ui,sans-serif;color-scheme:inherit}
[${ACTION_ATTRIBUTE}]{display:flex;align-items:center;gap:8px;cursor:pointer}
[${ACTION_ATTRIBUTE}]:hover,[${ACTION_ATTRIBUTE}]:focus-visible{background:color-mix(in srgb,currentColor 12%,transparent);outline:none}
[${ACTION_ATTRIBUTE}] svg{flex:none}
[${ACTION_ATTRIBUTE}] span{min-width:0}
`;

type Locale = "zh-CN" | "en";
type ProjectAction = "copy-path" | "terminal" | "vscode";

interface NativeProjectMenuProps extends Record<string, unknown> {
  getContextMenuItems(): unknown;
  onOpenChange(open: boolean): void;
}

interface ProjectMenuTarget {
  /** 菜单所属项目；本地与远程项目都会解析。 */
  project: SidebarProject;
  /** 本机绝对路径；远程项目或路径尚未就绪时为 null。 */
  path: string | null;
  /** 当前菜单项是“在访达中显示”，本地项目的首选注入锚点。 */
  reveal: boolean;
  /** 当前菜单项是“编辑”，没有 reveal 时作为注入锚点。 */
  edit: boolean;
  close(): void;
}

interface MenuEntry {
  anchor: HTMLElement;
  menu: HTMLElement;
  items: HTMLElement[];
  /** 注入项的点击动作；键盘确认与鼠标点击走同一条路径。 */
  actions: Map<HTMLElement, () => void>;
  path: string | null;
  /** 配置签名；变化说明贡献项需要重建。 */
  signature: string;
  search: string;
  searchTime: number;
}

/** 其他模块往原生项目菜单追加动作时提供的单个条目。 */
export interface ProjectMenuContributionItem {
  /** 具体动作属性，便于样式与测试定位。 */
  attribute: string;
  label: string;
  icon: typeof Copy;
  /** 原生菜单关闭后再执行；回调里的 close 会关闭当前菜单。 */
  onSelect(close: () => void): void;
}

export interface ProjectMenuContributionContext {
  menu: HTMLElement;
  project: SidebarProject;
  /** 关闭当前原生菜单。 */
  close(): void;
}

/** 往原生项目菜单追加动作；侧栏项目行不再直接摆放高风险入口。 */
export interface ProjectMenuContribution {
  /** 稳定标识；同一原生菜单里只追加一次。 */
  id: string;
  /** 贡献项内容随配置变化；签名变化时已打开的菜单会重建。 */
  signature?(): string;
  resolve(context: ProjectMenuContributionContext): ProjectMenuContributionItem[] | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function projectActionLabel(locale: Locale, action: ProjectAction): string {
  if (locale !== "zh-CN") {
    return {
      "copy-path": "Copy absolute path",
      terminal: "Open in Terminal",
      vscode: "Open in VS Code",
    }[action];
  }
  return {
    "copy-path": "复制绝对路径",
    terminal: "在终端中打开",
    vscode: "用 VS Code 打开",
  }[action];
}

function copiedPathLabel(locale: Locale): string {
  return locale === "zh-CN" ? "已复制绝对路径" : "Absolute path copied";
}

function copyFailedLabel(locale: Locale): string {
  return locale === "zh-CN" ? "复制绝对路径失败" : "Could not copy absolute path";
}

// 只从原生项目菜单项的已提交祖先读取项目身份；本地与远程项目都解析，
// 但绝对路径只有本机项目才有，远程项目保持 null。
function nativeProjectMenuTarget(anchor: HTMLElement): ProjectMenuTarget | null {
  const key = Object.keys(anchor).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  const rawFiber = Reflect.get(anchor, key);
  let reveal = false;
  let edit = false;
  let menuProps: NativeProjectMenuProps | null = null;
  let project: SidebarProject | null = null;
  let path: string | null = null;
  for (const fiber of committedReactAncestors(rawFiber)) {
    const props = record(fiber.memoizedProps);
    const itemId = record(props?.item)?.id ?? props?.id ?? fiber.key;
    reveal ||= itemId === "reveal-project-folder";
    edit ||= itemId === "edit-project";
    if (
      typeof props?.getContextMenuItems === "function" &&
      typeof props.onOpenChange === "function" &&
      typeof props.triggerAriaLabel === "string"
    ) {
      menuProps = props as NativeProjectMenuProps;
    }
    const candidate = record(props?.project);
    if (
      candidate &&
      (candidate.projectKind === "local" || candidate.projectKind === "remote") &&
      typeof candidate.projectId === "string" &&
      typeof candidate.label === "string" &&
      (candidate.projectKind === "local" || typeof candidate.hostId === "string")
    ) {
      project = {
        projectId: candidate.projectId,
        projectKind: candidate.projectKind,
        ...(candidate.projectKind === "remote" ? { hostId: candidate.hostId as string } : {}),
        label: candidate.label,
      };
      path =
        candidate.projectKind === "local" && typeof candidate.path === "string" && candidate.path
          ? candidate.path
          : null;
    }
  }
  if ((!reveal && !edit) || !menuProps || !project) return null;
  const target = menuProps;
  return {
    project,
    path,
    reveal,
    edit,
    close: () => target.onOpenChange(false),
  };
}

function cloneNativeMenuItem(reveal: HTMLElement, attribute: string): HTMLElement {
  const item = reveal.cloneNode(false) as HTMLElement;
  for (const name of [
    "id",
    "href",
    "title",
    "aria-disabled",
    "aria-labelledby",
    "aria-describedby",
    "aria-keyshortcuts",
    "data-disabled",
    "data-highlighted",
    "data-radix-collection-item",
  ]) {
    item.removeAttribute(name);
  }
  item.setAttribute(ACTION_ATTRIBUTE, "");
  item.setAttribute(attribute, "");
  item.setAttribute("role", "menuitem");
  item.tabIndex = -1;
  return item;
}

export function installRendererProjectActions(options: {
  getClient(): RendererModelClient | null;
  getLocale(): Locale;
  terminalPreference?: ThreadTerminalPreferenceStore;
}): {
  refresh(): void;
  registerContribution(contribution: ProjectMenuContribution): () => void;
  dispose(): void;
} {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const terminalPreference = options.terminalPreference ?? getSharedThreadTerminalPreferenceStore();
  let disposed = false;
  let scheduled = false;
  let errorToast: HTMLElement | null = null;
  let statusToast: HTMLElement | null = null;
  let statusTimer: number | null = null;
  const mounted = new Map<HTMLElement, MenuEntry>();
  const contributions = new Map<string, ProjectMenuContribution>();

  const contributionSignature = (project: SidebarProject): string =>
    JSON.stringify([
      options.getLocale(),
      project.label,
      ...[...contributions.values()].map((entry) => [entry.id, entry.signature?.() ?? ""]),
    ]);

  const clearError = (): void => {
    errorToast?.remove();
    errorToast = null;
  };

  const showError = (failure: unknown): void => {
    clearError();
    if (disposed) return;
    const toast = document.createElement("div");
    toast.setAttribute(ERROR_ATTRIBUTE, "");
    toast.setAttribute("role", "alert");
    const message = document.createElement("span");
    message.textContent = failure instanceof Error ? failure.message : String(failure);
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    const dismissLabel = options.getLocale() === "zh-CN" ? "关闭" : "Dismiss";
    dismiss.title = dismissLabel;
    dismiss.setAttribute("aria-label", dismissLabel);
    dismiss.append(createElement(X, { width: 16, height: 16, "aria-hidden": "true" }));
    dismiss.addEventListener("click", clearError);
    toast.append(message, dismiss);
    document.body.append(toast);
    errorToast = toast;
  };

  // 复制前会先关闭原生菜单，反馈不能挂在即将消失的菜单里，也不随菜单清理消失。
  const showCopyResult = (message: string): void => {
    if (disposed) return;
    statusToast?.remove();
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    const snackbar = document.createElement("div");
    snackbar.setAttribute(STATUS_ATTRIBUTE, "");
    snackbar.setAttribute("role", "status");
    snackbar.textContent = message;
    document.body.append(snackbar);
    statusToast = snackbar;
    statusTimer = window.setTimeout(() => {
      snackbar.remove();
      if (statusToast === snackbar) statusToast = null;
      statusTimer = null;
    }, 2_000);
  };

  const currentTarget = (entry: MenuEntry): ProjectMenuTarget | null =>
    entry.anchor.isConnected &&
    entry.items.every((item) => item.isConnected) &&
    entry.menu.isConnected
      ? nativeProjectMenuTarget(entry.anchor)
      : null;

  const copyPath = async (entry: MenuEntry): Promise<void> => {
    if (!entry.path) return;
    clearError();
    const clipboard = document.defaultView?.navigator.clipboard;
    if (typeof clipboard?.writeText !== "function") {
      showCopyResult(copyFailedLabel(options.getLocale()));
      return;
    }
    try {
      await clipboard.writeText(entry.path);
      showCopyResult(copiedPathLabel(options.getLocale()));
    } catch {
      showCopyResult(copyFailedLabel(options.getLocale()));
    }
  };

  const openTerminal = async (entry: MenuEntry): Promise<void> => {
    const client = options.getClient();
    if (!client?.openProjectTerminal) throw new Error("本机终端入口不可用。");
    if (!entry.path) throw new Error("项目绝对路径尚未就绪，请刷新项目列表后重试。");
    const terminalId = terminalPreference.get();
    await client.openProjectTerminal({
      path: entry.path,
      ...(terminalId ? { terminalId } : {}),
    });
  };

  const openWorkspace = async (entry: MenuEntry): Promise<void> => {
    const client = options.getClient();
    if (!client?.openProjectWorkspace) throw new Error("本机 VS Code 入口不可用。");
    if (!entry.path) throw new Error("项目绝对路径尚未就绪，请刷新项目列表后重试。");
    await client.openProjectWorkspace({ path: entry.path });
  };

  const select = (entry: MenuEntry, action: ProjectAction): void => {
    const target = currentTarget(entry);
    if (disposed || !target) return;
    try {
      target.close();
      if (action === "copy-path") {
        void copyPath(entry);
        return;
      }
      void (action === "terminal" ? openTerminal(entry) : openWorkspace(entry)).catch(showError);
    } catch (failure) {
      showError(failure);
    }
  };

  /**
   * 计算菜单的注入锚点：本地项目优先用“在访达中显示”之后，其次是“编辑”；
   * 这样本机动作与外部贡献项都落在原生动作区，而不是分裂成两处。
   */
  const anchorFor = (
    menu: HTMLElement,
  ): { anchor: HTMLElement; target: ProjectMenuTarget } | null => {
    let edit: { anchor: HTMLElement; target: ProjectMenuTarget } | null = null;
    for (const item of menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)) {
      if (item.hasAttribute(ACTION_ATTRIBUTE)) continue;
      const target = nativeProjectMenuTarget(item);
      if (!target) continue;
      if (target.reveal) return { anchor: item, target };
      if (target.edit) edit = { anchor: item, target };
    }
    return edit;
  };

  const buildItems = (entry: MenuEntry, anchor: HTMLElement, target: ProjectMenuTarget): void => {
    const cursor = (): HTMLElement => entry.items.at(-1) ?? anchor;
    const mount = (item: HTMLElement): void => {
      cursor().after(item);
      entry.items.push(item);
    };
    // 本机路径动作只在能确认绝对路径的本地项目上出现。
    if (target.project.projectKind === "local" && target.path) {
      const icons = { "copy-path": Copy, terminal: Terminal, vscode: Code };
      for (const action of ["copy-path", "terminal", "vscode"] as const) {
        const attribute = {
          "copy-path": COPY_PATH_ATTRIBUTE,
          terminal: OPEN_TERMINAL_ATTRIBUTE,
          vscode: OPEN_VSCODE_ATTRIBUTE,
        }[action];
        const item = cloneNativeMenuItem(anchor, attribute);
        const icon = createElement(icons[action], { width: 16, height: 16, "aria-hidden": "true" });
        const label = document.createElement("span");
        label.textContent = projectActionLabel(options.getLocale(), action);
        item.append(icon, label);
        const run = (): void => select(entry, action);
        entry.actions.set(item, run);
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          run();
        });
        mount(item);
      }
    }
    for (const contribution of contributions.values()) {
      const items = contribution.resolve({
        menu: entry.menu,
        project: target.project,
        close: target.close,
      });
      if (!items || items.length === 0) continue;
      for (const item of items) {
        const element = cloneNativeMenuItem(anchor, item.attribute);
        element.setAttribute(CONTRIBUTION_ATTRIBUTE, contribution.id);
        element.append(createElement(item.icon, { width: 16, height: 16, "aria-hidden": "true" }));
        const label = document.createElement("span");
        label.textContent = item.label;
        element.append(label);
        const run = (): void => item.onSelect(target.close);
        entry.actions.set(element, run);
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          run();
        });
        mount(element);
      }
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    for (const [anchor, entry] of mounted) {
      const target = currentTarget(entry);
      if (!target) {
        for (const item of entry.items) item.remove();
        mounted.delete(anchor);
        continue;
      }
      // 贡献项可能随绑定变化（例如刚保存或删除配置），签名变化时重建。
      const signature = contributionSignature(target.project);
      if (entry.signature === signature) continue;
      for (const item of entry.items) item.remove();
      entry.items = [];
      entry.actions.clear();
      entry.signature = signature;
      buildItems(entry, entry.anchor, target);
    }
    for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
      if ([...mounted.values()].some((entry) => entry.menu === menu)) continue;
      const resolved = anchorFor(menu);
      if (!resolved) continue;
      const { anchor, target } = resolved;
      const local = target.project.projectKind === "local" && target.path !== null;
      // 没有本机路径动作、也没有任何贡献项时，不保留空注入。
      if (!local && contributions.size === 0) continue;
      const entry: MenuEntry = {
        anchor,
        menu,
        items: [],
        actions: new Map(),
        path: target.path,
        signature: contributionSignature(target.project),
        search: "",
        searchTime: 0,
      };
      buildItems(entry, anchor, target);
      if (entry.items.length === 0) continue;
      mounted.set(anchor, entry);
    }
  };

  // 注入项不属于原生 roving-focus 注册表，在跨越这些项时补齐键盘焦点移动。
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const menu = target.closest('[role="menu"]');
    const entry = [...mounted.values()].find((candidate) => candidate.menu === menu);
    if (!entry || !currentTarget(entry)) return;
    const current = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
    const run = current ? entry.actions.get(current) : undefined;
    if (run && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      run();
      return;
    }
    const items = [...entry.menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)].filter(
      (item) =>
        item.closest('[role="menu"]') === entry.menu &&
        !item.hidden &&
        item.getAttribute("aria-disabled") !== "true" &&
        !item.hasAttribute("data-disabled"),
    );
    const index = current ? items.indexOf(current) : -1;
    const navigation = {
      ArrowDown: items[(index + 1) % items.length],
      ArrowUp: items[(index - 1 + items.length) % items.length],
      Home: items[0],
      End: items.at(-1),
    };
    let next = navigation[event.key as keyof typeof navigation];
    if (next && current && !entry.items.includes(current) && !entry.items.includes(next)) return;
    if (!next && event.key.length === 1 && event.key !== " " && !event.isComposing) {
      const now = Date.now();
      entry.search = now - entry.searchTime > 500 ? event.key : entry.search + event.key;
      entry.searchTime = now;
      const query = entry.search.toLocaleLowerCase();
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      next = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(query));
    }
    if (next && ((current && entry.items.includes(current)) || entry.items.includes(next))) {
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    }
  };

  const stopObserving = getDomMutationHub(document).subscribe({
    kinds: ["childList"],
    test: (record) => mutationAffectsElements(record, '[role="menu"]'),
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
  refresh();

  return {
    refresh,
    registerContribution(contribution) {
      contributions.set(contribution.id, contribution);
      refresh();
      return () => {
        contributions.delete(contribution.id);
        refresh();
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopObserving();
      contributions.clear();
      document.removeEventListener("keydown", onKeyDown, true);
      for (const entry of mounted.values()) {
        for (const item of entry.items) item.remove();
      }
      statusToast?.remove();
      statusToast = null;
      if (statusTimer !== null) window.clearTimeout(statusTimer);
      statusTimer = null;
      mounted.clear();
      clearError();
      styles.remove();
    },
  };
}
