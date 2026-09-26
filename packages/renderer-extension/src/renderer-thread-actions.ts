import createElement from "lucide/dist/esm/createElement.mjs";
import Ellipsis from "lucide/dist/esm/icons/ellipsis.mjs";
import Terminal from "lucide/dist/esm/icons/terminal.mjs";
import {
  hostThreadIdSchema,
  type ThreadTerminalDescriptor,
  type ThreadTerminalId,
} from "@codexhost/shared-contracts";

import type { RendererModelClient } from "./renderer-model-client.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";

const TRIGGER_ATTRIBUTE = "data-codexhost-thread-actions-trigger";
const MENU_ATTRIBUTE = "data-codexhost-thread-actions-menu";
const OPEN_TERMINAL_ATTRIBUTE = "data-codexhost-thread-actions-open-terminal";
const TERMINAL_SUBMENU_ATTRIBUTE = "data-codexhost-thread-actions-terminal-submenu";
const TERMINAL_OPTION_ATTRIBUTE = "data-codexhost-thread-actions-terminal-option";
const MENU_WIDTH = 216;
const VIEWPORT_MARGIN = 8;
const MENU_GAP = 6;

const style = `
[${TRIGGER_ATTRIBUTE}]{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
[${TRIGGER_ATTRIBUTE}]:hover,[${TRIGGER_ATTRIBUTE}][data-state="open"]{background:color-mix(in srgb,currentColor 12%,transparent)}
[${TRIGGER_ATTRIBUTE}]:focus-visible{outline:2px solid #508df2;outline-offset:1px}
[${TRIGGER_ATTRIBUTE}]:disabled{opacity:.55;cursor:wait}
[${MENU_ATTRIBUTE}]{position:fixed;z-index:1200;box-sizing:border-box;width:${MENU_WIDTH}px;padding:4px;border:1px solid var(--color-border,rgba(127,127,127,.25));border-radius:8px;background:var(--color-token-dropdown-background,var(--color-background-elevated,light-dark(#fff,#24262c)));color:var(--color-token-text-primary,inherit);box-shadow:0 8px 24px #0003;font:13px/18px system-ui,sans-serif;color-scheme:inherit}
[${MENU_ATTRIBUTE}] [role="menuitem"]{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
[${MENU_ATTRIBUTE}] [role="menuitem"]:hover,[${MENU_ATTRIBUTE}] [role="menuitem"]:focus-visible{background:color-mix(in srgb,currentColor 12%,transparent);outline:none}
[${MENU_ATTRIBUTE}] [role="menuitem"]:disabled{opacity:.55;cursor:wait}
[${MENU_ATTRIBUTE}] [role="menuitem"] svg{flex:none}
[${TERMINAL_SUBMENU_ATTRIBUTE}]{margin:2px 0 0;padding:4px 0 0;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent)}
[${TERMINAL_SUBMENU_ATTRIBUTE}]::before{display:block;padding:4px 8px;color:color-mix(in srgb,currentColor 65%,transparent);font-size:11px;content:attr(data-label)}
[${TERMINAL_SUBMENU_ATTRIBUTE}] [role="menuitemradio"]{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:30px;padding:5px 8px 5px 24px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
[${TERMINAL_SUBMENU_ATTRIBUTE}] [role="menuitemradio"]:hover,[${TERMINAL_SUBMENU_ATTRIBUTE}] [role="menuitemradio"]:focus-visible{background:color-mix(in srgb,currentColor 12%,transparent);outline:none}
[${TERMINAL_SUBMENU_ATTRIBUTE}] [role="menuitemradio"]:disabled{opacity:.55;cursor:default}
[${TERMINAL_SUBMENU_ATTRIBUTE}] [aria-checked="true"]::before{content:"✓";position:absolute;margin-left:-16px}
[${TERMINAL_OPTION_ATTRIBUTE}][aria-checked="true"]{font-weight:600}
[${MENU_ATTRIBUTE}] [data-codexhost-thread-actions-error]{padding:5px 8px;color:var(--color-token-text-warning,#b77b20);font-size:12px;overflow-wrap:anywhere}
[${MENU_ATTRIBUTE}] [data-codexhost-thread-actions-error]:empty{display:none}
`;

type Locale = "zh-CN" | "en";

interface RowEntry {
  slot: HTMLElement;
  trigger: HTMLButtonElement;
  onContextMenu: (event: MouseEvent) => void;
}

interface TerminalSelection {
  descriptors: ThreadTerminalDescriptor[];
  selected: ThreadTerminalId | null;
}

function menuLabel(locale: Locale): string {
  return locale === "zh-CN" ? "更多操作" : "More actions";
}

function openTerminalLabel(locale: Locale): string {
  return locale === "zh-CN" ? "从终端打开" : "Open in Terminal";
}

function chooseTerminalLabel(locale: Locale): string {
  return locale === "zh-CN" ? "选择终端" : "Choose Terminal";
}

function notInstalledLabel(locale: Locale): string {
  return locale === "zh-CN" ? "未安装" : "Not installed";
}

function defaultTerminal(selection: TerminalSelection): ThreadTerminalDescriptor | null {
  return (
    selection.descriptors.find((terminal) => terminal.id === selection.selected) ??
    selection.descriptors.find((terminal) => terminal.default && terminal.installed) ??
    selection.descriptors.find((terminal) => terminal.installed) ??
    null
  );
}

function nativeThreadId(hostId: string, row: HTMLElement): string | null {
  const threadId = threadIdFromSidebarRowElement(row);
  if (!threadId) return null;
  const hostPrefix = `${hostId}:`;
  return threadId.startsWith(hostPrefix) ? threadId.slice(hostPrefix.length) : threadId;
}

function actionSlot(row: HTMLElement): HTMLElement | null {
  // Native hover actions live next to the title trigger. Append after the
  // existing buttons so the injected trigger sits at the row's trailing edge.
  const titleTrigger = row.querySelector<HTMLElement>("[data-thread-title-trigger]");
  if (!titleTrigger) return null;
  const actions = titleTrigger.parentElement;
  return actions instanceof HTMLElement ? actions : null;
}

export function installRendererThreadActions(options: {
  getClient(hostId: string): RendererModelClient | null;
  getLocale(): Locale;
}): { refresh(): void; dispose(): void } {
  const styles = document.createElement("style");
  styles.textContent = style;
  document.head.append(styles);
  const mounted = new Map<HTMLElement, RowEntry>();
  let openRow: HTMLElement | null = null;
  let openMenu: HTMLElement | null = null;
  let disposed = false;
  let scheduled = false;
  const terminalSelections = new Map<string, TerminalSelection>();
  const terminalLoads = new Map<string, Promise<TerminalSelection>>();

  const terminalSelection = async (hostId: string): Promise<TerminalSelection | null> => {
    const client = options.getClient(hostId);
    if (!client?.listThreadTerminals) return null;
    const existing = terminalSelections.get(hostId);
    if (existing) return existing;
    let loading = terminalLoads.get(hostId);
    if (!loading) {
      loading = client
        .listThreadTerminals()
        .then((result) => {
          const selection = { descriptors: result.terminals, selected: null };
          terminalSelections.set(hostId, selection);
          return selection;
        })
        .finally(() => terminalLoads.delete(hostId));
      terminalLoads.set(hostId, loading);
    }
    try {
      return await loading;
    } catch {
      return null;
    }
  };

  const closeMenu = (): void => {
    openMenu?.remove();
    openMenu = null;
    if (openRow) mounted.get(openRow)?.trigger.setAttribute("data-state", "closed");
    openRow = null;
  };

  const clear = (row: HTMLElement): void => {
    if (openRow === row) closeMenu();
    const entry = mounted.get(row);
    if (!entry) return;
    entry.trigger.remove();
    row.removeEventListener("contextmenu", entry.onContextMenu);
    mounted.delete(row);
  };

  const placeMenu = (row: HTMLElement, menu: HTMLElement, trigger: HTMLButtonElement): void => {
    const bounds = trigger.getBoundingClientRect();
    placeMenuAt(row, menu, trigger, bounds.right, bounds.bottom);
  };

  const placeMenuAt = (
    row: HTMLElement,
    menu: HTMLElement,
    trigger: HTMLButtonElement,
    anchorX: number,
    anchorY: number,
  ): void => {
    menu.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchorX - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN))}px`;
    menu.style.top = `${Math.max(VIEWPORT_MARGIN, anchorY + MENU_GAP)}px`;
    document.body.append(menu);
    const menuBounds = menu.getBoundingClientRect();
    if (menuBounds.bottom > window.innerHeight - VIEWPORT_MARGIN) {
      menu.style.top = `${Math.max(VIEWPORT_MARGIN, anchorY - menuBounds.height - MENU_GAP)}px`;
    }
    openRow = row;
    openMenu = menu;
    trigger.setAttribute("data-state", "open");
  };

  const openTerminal = async (
    row: HTMLElement,
    hostId: string,
    threadId: string,
    menu: HTMLElement,
    item: HTMLButtonElement,
    terminalId?: ThreadTerminalId,
  ): Promise<void> => {
    const client = options.getClient(hostId);
    if (!client?.openThreadTerminal) {
      item.disabled = true;
      return;
    }
    const error = menu.querySelector<HTMLElement>("[data-codexhost-thread-actions-error]");
    item.disabled = true;
    if (error) error.textContent = "";
    try {
      const selection = await terminalSelection(hostId);
      const selectedTerminal =
        (terminalId
          ? selection?.descriptors.find((terminal) => terminal.id === terminalId)
          : null) ?? (selection ? defaultTerminal(selection) : null);
      if (terminalId && selection && !selectedTerminal?.installed) {
        throw new Error(notInstalledLabel(options.getLocale()));
      }
      if (selection && selectedTerminal) selection.selected = selectedTerminal.id;
      await client.openThreadTerminal({
        threadId: hostThreadIdSchema.parse(threadId),
        ...(selectedTerminal ? { terminalId: selectedTerminal.id } : {}),
      });
      if (openRow === row) closeMenu();
    } catch (failure) {
      if (disposed || openRow !== row) return;
      item.disabled = false;
      if (error) {
        error.textContent = `${openTerminalLabel(options.getLocale())}: ${
          failure instanceof Error ? failure.message : String(failure)
        }`;
      }
    }
  };

  const appendTerminalOptions = (
    menu: HTMLElement,
    row: HTMLElement,
    hostId: string,
    threadId: string,
    item: HTMLButtonElement,
    selection: TerminalSelection,
  ): void => {
    const submenu = document.createElement("div");
    submenu.setAttribute(TERMINAL_SUBMENU_ATTRIBUTE, "");
    submenu.setAttribute("data-label", chooseTerminalLabel(options.getLocale()));
    submenu.setAttribute("role", "group");
    submenu.setAttribute("aria-label", chooseTerminalLabel(options.getLocale()));
    const active = defaultTerminal(selection);
    for (const terminal of selection.descriptors) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", terminal.id === active?.id ? "true" : "false");
      option.setAttribute(TERMINAL_OPTION_ATTRIBUTE, "");
      option.disabled = !terminal.installed;
      const name = document.createElement("span");
      name.textContent = terminal.name;
      const state = document.createElement("span");
      state.textContent = terminal.installed ? "" : notInstalledLabel(options.getLocale());
      state.style.opacity = ".65";
      state.style.fontSize = "12px";
      option.append(name, state);
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openTerminal(row, hostId, threadId, menu, item, terminal.id);
      });
      submenu.append(option);
    }
    menu.append(submenu);
  };

  const buildMenu = (row: HTMLElement, hostId: string, threadId: string): HTMLElement => {
    const menu = document.createElement("div");
    menu.setAttribute(MENU_ATTRIBUTE, "");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.setAttribute(OPEN_TERMINAL_ATTRIBUTE, "");
    const label = openTerminalLabel(options.getLocale());
    item.title = label;
    item.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.style.display = "inline-flex";
    icon.style.alignItems = "center";
    icon.append(createElement(Terminal, { width: 15, height: 15, "aria-hidden": "true" }));
    const text = document.createElement("span");
    text.textContent = label;
    item.append(icon, text);
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openTerminal(row, hostId, threadId, menu, item);
    });
    const error = document.createElement("div");
    error.setAttribute("data-codexhost-thread-actions-error", "");
    error.setAttribute("role", "alert");
    menu.append(item, error);
    void terminalSelection(hostId).then((selection) => {
      if (!selection || disposed) return;
      if (menu.querySelector(`[${TERMINAL_SUBMENU_ATTRIBUTE}]`)) return;
      if (selection.descriptors.length > 1)
        appendTerminalOptions(menu, row, hostId, threadId, item, selection);
    });
    return menu;
  };

  const toggleMenu = (row: HTMLElement, hostId: string, threadId: string): void => {
    const entry = mounted.get(row);
    if (!entry) return;
    if (openRow === row) {
      closeMenu();
      return;
    }
    closeMenu();
    const menu = buildMenu(row, hostId, threadId);
    placeMenu(row, menu, entry.trigger);
  };

  const scan = (): void => {
    scheduled = false;
    if (disposed) return;
    const rows = [...document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)];
    for (const row of [...mounted.keys()]) {
      if (!rows.includes(row)) clear(row);
    }
    for (const row of rows) {
      const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
      const threadId = hostId ? nativeThreadId(hostId, row) : null;
      const client = hostId ? options.getClient(hostId) : null;
      if (!hostId || !threadId || !client?.openThreadTerminal) {
        clear(row);
        continue;
      }
      const slot = actionSlot(row);
      let entry = mounted.get(row);
      if (!slot) {
        clear(row);
        continue;
      }
      if (entry?.slot !== slot || entry.trigger.parentElement !== slot) {
        clear(row);
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.setAttribute(TRIGGER_ATTRIBUTE, "");
        trigger.setAttribute("data-state", "closed");
        trigger.append(createElement(Ellipsis, { width: 15, height: 15, "aria-hidden": "true" }));
        trigger.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const currentHostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
          const currentThreadId = currentHostId ? nativeThreadId(currentHostId, row) : null;
          if (!currentHostId || !currentThreadId) return;
          toggleMenu(row, currentHostId, currentThreadId);
        });
        // Keep the row's native open/drag handlers from seeing pointer and key
        // input that belongs to the injected action.
        for (const name of ["pointerdown", "mousedown", "keydown", "keyup"] as const) {
          trigger.addEventListener(name, (event) => event.stopPropagation());
        }
        const onContextMenu = (event: MouseEvent): void => {
          const currentHostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
          const currentThreadId = currentHostId ? nativeThreadId(currentHostId, row) : null;
          if (!currentHostId || !currentThreadId) return;
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          const menu = buildMenu(row, currentHostId, currentThreadId);
          placeMenuAt(row, menu, trigger, event.clientX, event.clientY);
        };
        row.addEventListener("contextmenu", onContextMenu);
        slot.append(trigger);
        entry = { slot, trigger, onContextMenu };
        mounted.set(row, entry);
      }
      const label = menuLabel(options.getLocale());
      entry.trigger.title = label;
      entry.trigger.setAttribute("aria-label", label);
    }
  };

  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  };
  const refresh = (): void => schedule();
  const onDocumentPointerDown = (event: Event): void => {
    if (!openMenu || (event.target instanceof Node && openMenu.contains(event.target))) return;
    if (
      openRow &&
      event.target instanceof Node &&
      mounted.get(openRow)?.trigger.contains(event.target)
    )
      return;
    closeMenu();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeMenu();
  };
  const onWindowChange = (): void => closeMenu();

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [SIDEBAR_THREAD_ID_ATTRIBUTE, SIDEBAR_THREAD_HOST_ID_ATTRIBUTE],
  });
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onWindowChange);
  window.addEventListener("scroll", onWindowChange, true);
  window.addEventListener("focus", refresh);
  schedule();

  return {
    refresh,
    dispose() {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
      window.removeEventListener("focus", refresh);
      closeMenu();
      for (const row of [...mounted.keys()]) clear(row);
      mounted.clear();
      styles.remove();
    },
  };
}
