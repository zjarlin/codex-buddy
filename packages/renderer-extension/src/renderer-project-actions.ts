import createElement from "lucide/dist/esm/createElement.mjs";
import ExternalLink from "lucide/dist/esm/icons/external-link.mjs";
import X from "lucide/dist/esm/icons/x.mjs";
import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import type { RendererModelClient } from "./renderer-model-client.js";
import { mutationAffectsElements } from "./renderer-dom-mutations.js";

const ERROR_ATTRIBUTE = "data-codexhost-project-actions-error";
const ACTION_ATTRIBUTE = "data-codexhost-project-actions-open-doubao";
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

interface NativeProjectMenuProps extends Record<string, unknown> {
  getContextMenuItems(): unknown;
  onOpenChange(open: boolean): void;
}

interface MenuEntry {
  reveal: HTMLElement;
  menu: HTMLElement;
  item: HTMLElement;
  label: HTMLElement;
  search: string;
  searchTime: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// 原生菜单项以项目操作 ID 作为 React key；Portal 仍保留项目所有者的祖先链。
function nativeProjectMenuProps(reveal: HTMLElement): NativeProjectMenuProps | null {
  const key = Object.keys(reveal).find((key) => key.startsWith("__reactFiber$"));
  if (!key) {
    return null;
  }
  const rawFiber = Reflect.get(reveal, key);
  const seen = new Set<unknown>();
  let candidate = false;
  for (let node = record(rawFiber); node && seen.size < 100; node = record(node.return)) {
    if (seen.has(node)) {
      break;
    }
    seen.add(node);
    const props = record(node.memoizedProps);
    if ((record(props?.item)?.id ?? props?.id ?? node.key) === "reveal-project-folder") {
      candidate = true;
      break;
    }
  }
  if (!candidate) {
    return null;
  }
  let revealItem = false;
  let menuProps: NativeProjectMenuProps | null = null;
  for (const fiber of committedReactAncestors(rawFiber)) {
    const props = record(fiber.memoizedProps);
    const itemId = record(props?.item)?.id ?? props?.id ?? fiber.key;
    revealItem ||= itemId === "reveal-project-folder";
    if (
      typeof props?.getContextMenuItems === "function" &&
      typeof props.onOpenChange === "function" &&
      typeof props.triggerAriaLabel === "string"
    ) {
      menuProps = props as NativeProjectMenuProps;
    }
    const project = record(props?.project);
    if (!project) {
      continue;
    }
    if (!revealItem || project.projectKind !== "local" || !menuProps) {
      return null;
    }
    let items: unknown;
    try {
      items = menuProps.getContextMenuItems();
    } catch {
      // 私有原生契约变化时保留原菜单，避免阻断 Renderer 的其他控件。
      return null;
    }
    if (!Array.isArray(items)) {
      return null;
    }
    const ids = new Set(items.map((item) => record(item)?.id));
    return ["edit-project", "reveal-project-folder", "remove-project"].every((id) => ids.has(id))
      ? menuProps
      : null;
  }
  return null;
}

function openDoubaoLabel(locale: Locale): string {
  return locale === "zh-CN" ? "在 Doubao 中打开" : "Open in Doubao";
}

export function installRendererProjectActions(options: {
  getClient(): RendererModelClient | null;
  getLocale(): Locale;
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  let disposed = false;
  let opening = false;
  let scheduled = false;
  let errorToast: HTMLElement | null = null;
  const mounted = new Map<HTMLElement, MenuEntry>();

  const clearError = (): void => {
    errorToast?.remove();
    errorToast = null;
  };

  const showError = (failure: unknown): void => {
    clearError();
    const toast = document.createElement("div");
    toast.setAttribute(ERROR_ATTRIBUTE, "");
    toast.setAttribute("role", "alert");
    const message = document.createElement("span");
    const detail = failure instanceof Error ? failure.message : String(failure);
    message.textContent = `${openDoubaoLabel(options.getLocale())}: ${detail}`;
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

  const openDoubao = async (): Promise<void> => {
    if (disposed || opening) {
      return;
    }
    opening = true;
    clearError();
    try {
      const client = options.getClient();
      if (!client?.openDoubao) {
        throw new Error(
          options.getLocale() === "zh-CN"
            ? "Doubao 启动连接不可用"
            : "Doubao launch connection is unavailable",
        );
      }
      await client.openDoubao();
    } catch (failure) {
      if (!disposed) {
        showError(failure);
      }
    } finally {
      opening = false;
    }
  };

  const currentProps = (entry: MenuEntry): NativeProjectMenuProps | null =>
    entry.reveal.isConnected &&
    entry.item.isConnected &&
    entry.item.parentElement === entry.reveal.parentElement
      ? nativeProjectMenuProps(entry.reveal)
      : null;

  const select = (entry: MenuEntry): void => {
    const props = currentProps(entry);
    if (disposed || !props) {
      return;
    }
    try {
      props.onOpenChange(false);
      void openDoubao();
    } catch (failure) {
      showError(failure);
    }
  };

  const refresh = (): void => {
    if (disposed) {
      return;
    }
    for (const [reveal, entry] of mounted) {
      if (!currentProps(entry)) {
        entry.item.remove();
        mounted.delete(reveal);
      }
    }
    for (const reveal of document.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      if (reveal.hasAttribute(ACTION_ATTRIBUTE)) {
        continue;
      }
      const existing = mounted.get(reveal);
      if (existing) {
        const label = openDoubaoLabel(options.getLocale());
        if (existing.label.textContent !== label) {
          existing.label.textContent = label;
        }
        continue;
      }
      const props = nativeProjectMenuProps(reveal);
      const menu = reveal.closest<HTMLElement>('[role="menu"]');
      if (!props || !menu || menu.querySelector(`[${ACTION_ATTRIBUTE}]`)) {
        continue;
      }
      const item = reveal.cloneNode(false) as HTMLElement;
      for (const attribute of [
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
        item.removeAttribute(attribute);
      }
      item.setAttribute(ACTION_ATTRIBUTE, "");
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
      const icon = createElement(ExternalLink, { width: 16, height: 16, "aria-hidden": "true" });
      const label = document.createElement("span");
      label.textContent = openDoubaoLabel(options.getLocale());
      item.append(icon, label);
      const entry = { reveal, menu, item, label, search: "", searchTime: 0 };
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        select(entry);
      });
      reveal.after(item);
      mounted.set(reveal, entry);
    }
  };

  // 注入项不属于原生 roving-focus 注册表，在跨越该项时补齐键盘焦点移动。
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const menu = target.closest('[role="menu"]');
    const entry = [...mounted.values()].find((entry) => entry.menu === menu);
    if (!entry || !currentProps(entry)) {
      return;
    }
    const current = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
    if (current === entry.item && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      select(entry);
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
    if (next && current !== entry.item && next !== entry.item) {
      return;
    }
    if (!next && event.key.length === 1 && event.key !== " " && !event.isComposing) {
      const now = Date.now();
      entry.search = now - entry.searchTime > 500 ? event.key : entry.search + event.key;
      entry.searchTime = now;
      const query = entry.search.toLocaleLowerCase();
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      next = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(query));
    }
    if (next && (current === entry.item || next === entry.item)) {
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
      if (disposed) {
        return;
      }
      disposed = true;
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      for (const entry of mounted.values()) {
        entry.item.remove();
      }
      mounted.clear();
      clearError();
      styles.remove();
    },
  };
}
