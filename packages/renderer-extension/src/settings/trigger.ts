import { createRendererSettingsBrandIcon, createRendererSettingsIcon } from "./icons.js";
import {
  DEFAULT_RENDERER_SETTINGS_MESSAGES,
  type RendererSettingsMessages,
} from "./localization.js";
import type { RendererModelClient } from "../renderer-model-client.js";

export const SETTINGS_TRIGGER_ATTRIBUTE = "data-codexhost-settings-trigger";
export const UPDATE_TRIGGER_ATTRIBUTE = "data-codexhost-update-trigger";
const SYSTEM_ONE_TRIGGER_ATTRIBUTE = "data-codexhost-system-one-model";
/** 由 codexhost 注入、不属于 Desktop 原生结构的 header 控件。 */
export const RENDERER_INJECTED_CONTROL_SELECTOR = `[${SETTINGS_TRIGGER_ATTRIBUTE}],[${SYSTEM_ONE_TRIGGER_ATTRIBUTE}],[${UPDATE_TRIGGER_ATTRIBUTE}]`;
export const SETTINGS_HEADER_SURFACE_SELECTOR =
  '[data-testid="app-shell-header-context-menu-surface"]';
const SETTINGS_APPLICATION_HEADER_SELECTOR = 'header[data-pip-obstacle="app-shell-header"]';
const SETTINGS_HEADER_SLOT_SELECTOR = ':scope > [data-test-id="header-shell-slot"]';
const SETTINGS_HEADER_NATIVE_ACTION_GROUP_SELECTOR =
  ':scope > [data-app-shell-header-obstacle="true"]';
const SETTINGS_RAIL_SELECTOR = "nav[data-app-navigation-rail]";
const SETTINGS_RAIL_DESTINATION_SELECTOR = "[data-sidebar-destination]";
const UPDATE_ACCENT = "#3b82f6";
const RAIL_ICON_COLOR = "var(--color-text-secondary-ghost, rgba(26, 28, 31, 0.5))";
const RAIL_ICON_HOVER_COLOR = "var(--color-text-secondary-ghost-hover, #1a1c1f)";
const RAIL_ICON_HOVER_BACKGROUND =
  "var(--color-background-secondary-ghost-hover, rgba(26, 28, 31, 0.05))";

export interface RendererSettingsTriggerControl {
  root: HTMLElement;
  button: HTMLButtonElement;
  setUpdateAvailable(available: boolean): void;
  dispose(): void;
}

export interface RendererSettingsRailTriggerControl {
  readonly root: HTMLElement | null;
  refresh(): boolean;
  setUpdateAvailable(available: boolean): void;
  dispose(): void;
}

export interface SystemOneModelHeaderControl {
  readonly root: HTMLElement | null;
  refresh(): boolean;
  reposition(): boolean;
  dispose(): void;
}

interface RendererSettingsRailInsertionPoint {
  parent: HTMLElement;
  before: ChildNode | null;
}

export interface RendererSettingsContractInspection {
  railCount: number;
  visibleRailCount: number;
  insertionPointCount: number;
}

function isVisible(element: Element): boolean {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function hasDestination(element: Element): boolean {
  return (
    element.matches(SETTINGS_RAIL_DESTINATION_SELECTOR) ||
    element.querySelector(SETTINGS_RAIL_DESTINATION_SELECTOR) !== null
  );
}

/**
 * The rail's top column lists native destinations and ends with the More
 * button, which has no destination. The trigger goes directly above More.
 */
function findRailInsertionPoint(rail: HTMLElement): RendererSettingsRailInsertionPoint | null {
  const column = [...rail.children].find(hasDestination) as HTMLElement | undefined;
  if (!column) return null;
  const last = [...column.children]
    .filter(
      (child) =>
        !child.hasAttribute(SETTINGS_TRIGGER_ATTRIBUTE) &&
        !child.hasAttribute(UPDATE_TRIGGER_ATTRIBUTE),
    )
    .at(-1);
  return { parent: column, before: last && !hasDestination(last) ? last : null };
}

export function inspectRendererSettingsContract(
  ownerDocument: Document = document,
): RendererSettingsContractInspection {
  const rails = [...ownerDocument.querySelectorAll<HTMLElement>(SETTINGS_RAIL_SELECTOR)];
  const visibleRails = rails.filter(isVisible);
  return {
    railCount: rails.length,
    visibleRailCount: visibleRails.length,
    insertionPointCount: visibleRails.filter((rail) => findRailInsertionPoint(rail) !== null)
      .length,
  };
}

function findRendererSettingsRailInsertionPoint(
  ownerDocument: Document,
): RendererSettingsRailInsertionPoint | null {
  const rail = ownerDocument.querySelector<HTMLElement>(SETTINGS_RAIL_SELECTOR);
  return rail && isVisible(rail) ? findRailInsertionPoint(rail) : null;
}

export interface RendererSettingsBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface RendererSettingsHeaderInsertionPoint {
  parent: HTMLElement;
  before: ChildNode | null;
}

function measuredBounds(element: Element): RendererSettingsBounds {
  const bounds = element.getBoundingClientRect();
  return {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
    width: bounds.width,
    height: bounds.height,
  };
}

function findNativeHeaderActionGroup(header: HTMLElement): HTMLElement | null {
  const surface = header.querySelector<HTMLElement>(SETTINGS_HEADER_SURFACE_SELECTOR);
  if (!surface) return null;
  const groups = [
    ...surface.querySelectorAll<HTMLElement>(SETTINGS_HEADER_NATIVE_ACTION_GROUP_SELECTOR),
  ];
  return groups.at(-1) ?? null;
}

function findRendererSettingsHeaderInsertionPoint(
  ownerDocument: Document,
): RendererSettingsHeaderInsertionPoint | null {
  const header = ownerDocument.querySelector<HTMLElement>(SETTINGS_APPLICATION_HEADER_SELECTOR);
  if (!header) return null;

  const headerBounds = measuredBounds(header);
  if (headerBounds.width <= 0 || headerBounds.height <= 0) return null;

  const nativeActionGroup = findNativeHeaderActionGroup(header);
  if (nativeActionGroup?.parentElement) {
    return { parent: nativeActionGroup.parentElement, before: nativeActionGroup };
  }

  const endSlot = [...header.querySelectorAll<HTMLElement>(SETTINGS_HEADER_SLOT_SELECTOR)]
    .filter((slot) => {
      const bounds = measuredBounds(slot);
      return bounds.width > 0 && bounds.height > 0;
    })
    .toSorted((left, right) => measuredBounds(right).left - measuredBounds(left).left)[0];
  return endSlot ? { parent: header, before: endSlot } : null;
}

function mountSystemOneModelHeaderControl(
  getClient: () => RendererModelClient | null,
  getLocale: () => "zh-CN" | "en",
  ownerDocument: Document,
): {
  root: HTMLElement;
  refresh(): void;
  dispose(): void;
} {
  type BuddySnapshot = Awaited<ReturnType<NonNullable<RendererModelClient["buddyStatus"]>>>;
  const root = ownerDocument.createElement("div");
  root.setAttribute(SYSTEM_ONE_TRIGGER_ATTRIBUTE, "v1");
  root.style.display = "inline-flex";
  root.style.alignItems = "center";
  root.style.flex = "0 0 auto";
  root.style.color = "inherit";
  root.style.pointerEvents = "auto";
  root.style.setProperty("-webkit-app-region", "no-drag");

  const label = ownerDocument.createElement("span");
  label.style.fontSize = "11px";
  label.style.fontWeight = "600";
  label.style.lineHeight = "1";
  label.style.whiteSpace = "nowrap";
  label.style.opacity = "0.72";

  const select = ownerDocument.createElement("select");
  select.style.height = "28px";
  select.style.maxWidth = "132px";
  select.style.minWidth = "104px";
  select.style.border = "1px solid color-mix(in srgb, currentColor 18%, transparent)";
  select.style.borderRadius = "8px";
  select.style.background = "color-mix(in srgb, currentColor 5%, transparent)";
  select.style.color = "inherit";
  select.style.font = "inherit";
  select.style.fontSize = "12px";
  select.style.padding = "0 24px 0 8px";
  select.style.cursor = "pointer";
  select.style.setProperty("-webkit-app-region", "no-drag");

  for (const [value, labelText] of [
    ["typesafe/jev", "JEV"],
    ["laya", "Laya"],
  ] as const) {
    const option = ownerDocument.createElement("option");
    option.value = value;
    option.textContent = labelText;
    select.append(option);
  }

  root.append(label, select);

  let snapshot: BuddySnapshot | null = null;
  let currentClient: RendererModelClient | null = null;
  let requestGeneration = 0;
  let disposed = false;
  let saving = false;

  // renderer 以 MutationObserver 驱动全量 scan。每次 scan 都无条件改写 DOM 会让
  // scan 自我激荡并压死主线程，因此只在渲染值真正变化时才写 DOM。
  let renderedKey = "";
  const render = (): void => {
    const zh = getLocale() === "zh-CN";
    const disabled =
      saving ||
      !snapshot?.settings.jev ||
      !snapshot.settings.enabled ||
      snapshot.settings.privateMode;
    const value = snapshot?.settings.systemOneModel ?? "typesafe/jev";
    const display = snapshot ? "inline-flex" : "none";
    const key = [zh, disabled, value, display].join("\u0000");
    if (key === renderedKey) return;
    renderedKey = key;
    label.textContent = "System One";
    select.setAttribute("aria-label", zh ? "System One 模型" : "System One model");
    select.title = zh
      ? "网关按模型选择平台：JEV 走 typesafe/jev，Laya 走本地 laya"
      : "Choose the gateway platform: JEV uses typesafe/jev, Laya uses local laya";
    select.disabled = disabled;
    select.value = value;
    root.style.display = display;
  };

  let pending = false;
  const refresh = (): void => {
    if (disposed) return;
    const client = getClient();
    if (!client?.buddyStatus) {
      currentClient = null;
      snapshot = null;
      pending = false;
      render();
      return;
    }
    // 该控件会被 scan 高频调用；同一时刻只允许一个在途请求，避免请求风暴。
    if (pending && client === currentClient) return;
    currentClient = client;
    pending = true;
    const generation = ++requestGeneration;
    void client
      .buddyStatus()
      .then((next) => {
        if (disposed || generation !== requestGeneration || currentClient !== client) return;
        snapshot = next;
        render();
      })
      .catch(() => {
        if (disposed || generation !== requestGeneration || currentClient !== client) return;
        snapshot = null;
        render();
      })
      .finally(() => {
        if (currentClient === client) pending = false;
      });
  };

  const onChange = (): void => {
    const client = currentClient;
    if (!snapshot || !client?.buddyConfigure || saving) return;
    const nextModel = select.value;
    if (nextModel === snapshot.settings.systemOneModel) return;
    saving = true;
    render();
    void client
      .buddyConfigure({ ...snapshot.settings, systemOneModel: nextModel })
      .then((next) => {
        if (disposed || currentClient !== client) return;
        snapshot = next;
      })
      .catch(() => undefined)
      .finally(() => {
        if (disposed || currentClient !== client) return;
        saving = false;
        render();
      });
  };

  select.addEventListener("change", onChange);
  refresh();
  return {
    root,
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      requestGeneration += 1;
      select.removeEventListener("change", onChange);
      root.remove();
    },
  };
}

export function installSystemOneModelHeaderControl(options: {
  getClient: () => RendererModelClient | null;
  getLocale?: () => "zh-CN" | "en";
  ownerDocument?: Document;
}): SystemOneModelHeaderControl {
  const ownerDocument = options.ownerDocument ?? document;
  const getLocale = options.getLocale ?? (() => "en");
  let control: ReturnType<typeof mountSystemOneModelHeaderControl> | null = null;
  let disposed = false;

  // 布局刷新会被 MutationObserver 驱动的全量 scan 高频调用。它只负责把控件放回
  // 既有位置，既不发起 buddyStatus 请求，也不能重复改写 DOM，否则 scan 会因自身
  // 插入动作反复触发，形成 100% CPU 的 DOM churn 循环。
  //
  // 原生 header 由 React 管理，action group 常被原地替换；因此判断“已在正确位置”
  // 时，只要控件仍紧邻同一个 parent 中的原生 action group 就不再搬动，避免把
  // anchor 的 identity 变化误判成位置变化。
  const reposition = (): boolean => {
    if (disposed) return false;
    const insertionPoint = findRendererSettingsHeaderInsertionPoint(ownerDocument);
    const parent = insertionPoint?.parent ?? null;
    const before = insertionPoint?.before ?? null;
    if (!parent) {
      control?.root.remove();
      return false;
    }
    if (!control) {
      for (const duplicate of ownerDocument.querySelectorAll(`[${SYSTEM_ONE_TRIGGER_ATTRIBUTE}]`)) {
        duplicate.remove();
      }
      control = mountSystemOneModelHeaderControl(options.getClient, getLocale, ownerDocument);
      parent.insertBefore(control.root, before);
      return true;
    }
    // 原生 header 由 React 管理且会原地替换节点。只要控件仍在该 header 内，就不
    // 再搬动 DOM：重复插入会触发其他 MutationObserver，形成 100% CPU 的自激循环。
    if (control.root.isConnected && parent.contains(control.root)) return true;
    parent.insertBefore(control.root, before);
    return true;
  };

  const refresh = (): boolean => {
    if (disposed) return false;
    const mounted = reposition();
    if (mounted) control?.refresh();
    return mounted;
  };

  refresh();
  return {
    get root() {
      return control?.root ?? null;
    },
    refresh,
    reposition,
    dispose() {
      if (disposed) return;
      disposed = true;
      control?.dispose();
      control = null;
    },
  };
}

export function mountRendererSettingsTrigger(
  triggerId: string,
  available: boolean,
  onOpen: (opener: HTMLButtonElement, pageId?: "updates") => void,
  ownerDocument: Document = document,
  messages: RendererSettingsMessages = DEFAULT_RENDERER_SETTINGS_MESSAGES,
): RendererSettingsTriggerControl {
  const root = ownerDocument.createElement("div");
  root.setAttribute(SETTINGS_TRIGGER_ATTRIBUTE, triggerId);
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.flex = "0 0 auto";

  // Matches the rail's native 36px ghost icon buttons and their color tokens.
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.disabled = !available;
  button.setAttribute("aria-label", messages.openSettings);
  button.setAttribute("aria-haspopup", "dialog");
  button.style.position = "relative";
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.width = "36px";
  button.style.height = "36px";
  button.style.padding = "0";
  button.style.border = "0";
  button.style.borderRadius = "12.5px";
  button.style.setProperty("corner-shape", "superellipse(1.5)");
  button.style.background = "transparent";
  button.style.color = RAIL_ICON_COLOR;
  button.style.cursor = available ? "pointer" : "not-allowed";
  button.style.opacity = available ? "1" : "0.5";
  button.style.outlineOffset = "2px";
  button.append(createRendererSettingsBrandIcon(20));

  const updateBadge = ownerDocument.createElement("span");
  updateBadge.setAttribute("aria-hidden", "true");
  updateBadge.style.position = "absolute";
  updateBadge.style.top = "5px";
  updateBadge.style.right = "5px";
  updateBadge.style.width = "8px";
  updateBadge.style.height = "8px";
  updateBadge.style.borderRadius = "50%";
  // One accent that reads on both light and dark rails; the tooltip carries the wording.
  updateBadge.style.background = UPDATE_ACCENT;
  updateBadge.style.display = "none";
  button.append(updateBadge);

  let updateAvailable = false;
  const renderTitle = (): void => {
    button.title = !available
      ? messages.settingsUnavailableTitle
      : updateAvailable
        ? `${messages.settingsButtonTitle} · ${messages.updateAvailable}`
        : messages.settingsButtonTitle;
  };
  renderTitle();

  const onPointerEnter = (): void => {
    if (button.disabled) return;
    button.style.background = RAIL_ICON_HOVER_BACKGROUND;
    button.style.color = RAIL_ICON_HOVER_COLOR;
  };
  const onPointerLeave = (): void => {
    button.style.background = "transparent";
    button.style.color = RAIL_ICON_COLOR;
  };
  const onClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (button.disabled) return;
    if (updateAvailable) onOpen(button, "updates");
    else onOpen(button);
  };
  button.addEventListener("pointerenter", onPointerEnter);
  button.addEventListener("pointerleave", onPointerLeave);
  button.addEventListener("click", onClick);
  root.append(button);

  return {
    root,
    button,
    setUpdateAvailable(next) {
      updateAvailable = next;
      root.toggleAttribute("data-update-available", next);
      updateBadge.style.display = next ? "block" : "none";
      renderTitle();
    },
    dispose() {
      button.removeEventListener("pointerenter", onPointerEnter);
      button.removeEventListener("pointerleave", onPointerLeave);
      button.removeEventListener("click", onClick);
      root.remove();
    },
  };
}

export function installRendererSettingsRailTrigger(options: {
  available: boolean;
  onOpen(opener: HTMLButtonElement, pageId?: "updates"): void;
  messages?: RendererSettingsMessages;
  ownerDocument?: Document;
}): RendererSettingsRailTriggerControl {
  const ownerDocument = options.ownerDocument ?? document;
  let trigger: RendererSettingsTriggerControl | null = null;
  let updateAvailable = false;
  let disposed = false;

  const refresh = (): boolean => {
    if (disposed) return false;
    const insertionPoint = findRendererSettingsRailInsertionPoint(ownerDocument);
    if (!insertionPoint) {
      trigger?.root.remove();
      return false;
    }
    if (!trigger) {
      for (const duplicate of ownerDocument.querySelectorAll(`[${SETTINGS_TRIGGER_ATTRIBUTE}]`)) {
        duplicate.remove();
      }
      trigger = mountRendererSettingsTrigger(
        "navigation-rail",
        options.available,
        options.onOpen,
        ownerDocument,
        options.messages,
      );
      trigger.setUpdateAvailable(updateAvailable);
    }
    const updateTrigger = [...insertionPoint.parent.children].find((child) =>
      child.hasAttribute(UPDATE_TRIGGER_ATTRIBUTE),
    );
    const before = updateTrigger ?? insertionPoint.before;
    if (
      trigger.root.parentElement !== insertionPoint.parent ||
      trigger.root.nextSibling !== before
    ) {
      insertionPoint.parent.insertBefore(trigger.root, before);
    }
    return true;
  };

  refresh();
  return {
    get root() {
      return trigger?.root ?? null;
    },
    refresh,
    setUpdateAvailable(available) {
      updateAvailable = available;
      trigger?.setUpdateAvailable(available);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      trigger?.dispose();
      trigger = null;
    },
  };
}

export function installRendererUpdateRailTrigger(options: {
  ownerDocument: Document;
  onOpen(button: HTMLButtonElement): void;
}) {
  const root = options.ownerDocument.createElement("div");
  root.setAttribute(UPDATE_TRIGGER_ATTRIBUTE, "");
  root.style.display = "none";
  const button = options.ownerDocument.createElement("button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    padding: "0",
    border: "0",
    borderRadius: "8px",
    color: "light-dark(#287bde, #66aaf9)",
    background: "light-dark(#eaf2fd, #1b304b)",
    cursor: "pointer",
    outlineOffset: "2px",
    flex: "0 0 auto",
  });
  button.append(createRendererSettingsIcon("updates", 20));
  root.append(button);
  const onClick = (event: MouseEvent): void => {
    event.stopPropagation();
    options.onOpen(button);
  };
  button.addEventListener("click", onClick);
  let disposed = false;
  return {
    root,
    button,
    refresh(): boolean {
      if (disposed) return false;
      const point = findRendererSettingsRailInsertionPoint(options.ownerDocument);
      if (!point) {
        root.remove();
        return false;
      }
      if (root.parentElement !== point.parent || root.nextSibling !== point.before) {
        point.parent.insertBefore(root, point.before);
      }
      return true;
    },
    setState(visible: boolean, title: string): void {
      root.style.display = visible ? "flex" : "none";
      button.title = title;
      button.setAttribute("aria-label", title);
    },
    dispose(): void {
      disposed = true;
      button.removeEventListener("click", onClick);
      root.remove();
    },
  };
}
