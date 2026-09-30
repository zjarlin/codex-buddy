import createElement from "lucide/dist/esm/createElement.mjs";
import Code from "lucide/dist/esm/icons/code.mjs";
import Copy from "lucide/dist/esm/icons/copy.mjs";
import Terminal from "lucide/dist/esm/icons/terminal.mjs";
import X from "lucide/dist/esm/icons/x.mjs";
import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import type { RendererModelClient } from "./renderer-model-client.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";
import {
  getSharedThreadTerminalPreferenceStore,
  type ThreadTerminalPreferenceStore,
} from "./thread-terminal-preference.js";

const ERROR_ATTRIBUTE = "data-codexhost-project-actions-error";
const ACTION_ATTRIBUTE = "data-codexhost-project-actions";
const COPY_PATH_ATTRIBUTE = `${ACTION_ATTRIBUTE}-copy-path`;
const OPEN_TERMINAL_ATTRIBUTE = `${ACTION_ATTRIBUTE}-open-terminal`;
const OPEN_VSCODE_ATTRIBUTE = `${ACTION_ATTRIBUTE}-open-vscode`;
const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

const style = `
[${ERROR_ATTRIBUTE}]{position:fixed;right:16px;bottom:16px;z-index:1200;display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:12px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:8px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-primary,inherit);box-shadow:0 8px 24px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[${ERROR_ATTRIBUTE}] span{min-width:0;overflow-wrap:anywhere}
[${ERROR_ATTRIBUTE}] button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
[${ERROR_ATTRIBUTE}] button:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
[${ERROR_ATTRIBUTE}] button:focus-visible{outline:2px solid #508df2;outline-offset:1px}
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

interface NativeProject {
  projectId: string;
  projectKind: "local";
  path: string;
}

interface ProjectMenuTarget {
  project: NativeProject;
  close(): void;
}

interface MenuEntry {
  reveal: HTMLElement;
  menu: HTMLElement;
  items: HTMLElement[];
  snackbar: HTMLElement | null;
  path: string;
  search: string;
  searchTime: number;
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

function nativeProjectMenuTarget(anchor: HTMLElement): ProjectMenuTarget | null {
  const key = Object.keys(anchor).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  const rawFiber = Reflect.get(anchor, key);
  let revealItem = false;
  let menuProps: NativeProjectMenuProps | null = null;
  let project: NativeProject | null = null;
  for (const fiber of committedReactAncestors(rawFiber)) {
    const props = record(fiber.memoizedProps);
    revealItem ||= (record(props?.item)?.id ?? props?.id ?? fiber.key) === "reveal-project-folder";
    if (
      typeof props?.getContextMenuItems === "function" &&
      typeof props.onOpenChange === "function" &&
      typeof props.triggerAriaLabel === "string"
    ) {
      menuProps = props as NativeProjectMenuProps;
    }
    const candidate = record(props?.project);
    if (
      candidate?.projectKind === "local" &&
      typeof candidate.projectId === "string" &&
      typeof candidate.path === "string" &&
      candidate.path.length > 0
    ) {
      project = {
        projectId: candidate.projectId,
        projectKind: "local",
        path: candidate.path,
      };
    }
  }
  if (!revealItem || !menuProps || !project) return null;
  const target = menuProps;
  return {
    project,
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
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const terminalPreference = options.terminalPreference ?? getSharedThreadTerminalPreferenceStore();
  let disposed = false;
  let scheduled = false;
  let errorToast: HTMLElement | null = null;
  const mounted = new Map<HTMLElement, MenuEntry>();

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

  const showCopyResult = (entry: MenuEntry, message: string): void => {
    entry.snackbar?.remove();
    if (disposed || !entry.menu.isConnected) return;
    const snackbar = document.createElement("div");
    snackbar.setAttribute("role", "status");
    snackbar.style.padding = "5px 8px";
    snackbar.style.color = "var(--color-token-text-secondary,currentColor)";
    snackbar.style.fontSize = "12px";
    snackbar.textContent = message;
    entry.menu.append(snackbar);
    entry.snackbar = snackbar;
  };

  const currentTarget = (entry: MenuEntry): ProjectMenuTarget | null =>
    entry.reveal.isConnected &&
    entry.items.every((item) => item.isConnected) &&
    entry.menu.isConnected
      ? nativeProjectMenuTarget(entry.reveal)
      : null;

  const copyPath = async (entry: MenuEntry): Promise<void> => {
    clearError();
    const clipboard = document.defaultView?.navigator.clipboard;
    if (typeof clipboard?.writeText !== "function") {
      showCopyResult(entry, copyFailedLabel(options.getLocale()));
      return;
    }
    try {
      await clipboard.writeText(entry.path);
      showCopyResult(entry, copiedPathLabel(options.getLocale()));
    } catch {
      showCopyResult(entry, copyFailedLabel(options.getLocale()));
    }
  };

  const openTerminal = async (entry: MenuEntry): Promise<void> => {
    const client = options.getClient();
    if (!client?.openProjectTerminal) throw new Error("本机终端入口不可用。");
    const terminalId = terminalPreference.get();
    await client.openProjectTerminal({
      path: entry.path,
      ...(terminalId ? { terminalId } : {}),
    });
  };

  const openWorkspace = async (entry: MenuEntry): Promise<void> => {
    const client = options.getClient();
    if (!client?.openProjectWorkspace) throw new Error("本机 VS Code 入口不可用。");
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

  const refresh = (): void => {
    if (disposed) return;
    for (const [reveal, entry] of mounted) {
      if (!currentTarget(entry)) {
        for (const item of entry.items) item.remove();
        entry.snackbar?.remove();
        mounted.delete(reveal);
      }
    }
    for (const reveal of document.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      if (reveal.hasAttribute(ACTION_ATTRIBUTE) || mounted.has(reveal)) continue;
      const target = nativeProjectMenuTarget(reveal);
      const menu = reveal.closest<HTMLElement>('[role="menu"]');
      if (!target || !menu || menu.querySelector(`[${ACTION_ATTRIBUTE}]`)) continue;
      const icons = { "copy-path": Copy, terminal: Terminal, vscode: Code };
      const entry: MenuEntry = {
        reveal,
        menu,
        items: [],
        snackbar: null,
        path: target.project.path,
        search: "",
        searchTime: 0,
      };
      for (const action of ["copy-path", "terminal", "vscode"] as const) {
        const attribute = {
          "copy-path": COPY_PATH_ATTRIBUTE,
          terminal: OPEN_TERMINAL_ATTRIBUTE,
          vscode: OPEN_VSCODE_ATTRIBUTE,
        }[action];
        const item = cloneNativeMenuItem(reveal, attribute);
        const icon = createElement(icons[action], { width: 16, height: 16, "aria-hidden": "true" });
        const label = document.createElement("span");
        label.textContent = projectActionLabel(options.getLocale(), action);
        item.append(icon, label);
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          select(entry, action);
        });
        entry.items.push(item);
      }
      const first = entry.items[0];
      const second = entry.items[1];
      const third = entry.items[2];
      if (first && second && third) first.after(second, third);
      mounted.set(reveal, entry);
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
    const injectedIndex = current ? entry.items.indexOf(current) : -1;
    if (injectedIndex >= 0 && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      select(entry, (["copy-path", "terminal", "vscode"] as const)[injectedIndex] as ProjectAction);
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

  const observer = new MutationObserver((records) => {
    if (
      scheduled ||
      disposed ||
      !records.some((record) => mutationAffectsElements(record, '[role="menu"]'))
    ) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      refresh();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("keydown", onKeyDown, true);
  refresh();

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      for (const entry of mounted.values()) {
        for (const item of entry.items) item.remove();
        entry.snackbar?.remove();
      }
      mounted.clear();
      clearError();
      styles.remove();
    },
  };
}
