import { createRendererSettingsBrandIcon, createRendererSettingsIcon } from "./icons.js";
import {
  DEFAULT_RENDERER_SETTINGS_MESSAGES,
  type RendererSettingsMessages,
} from "./localization.js";
import type { RendererModelClient } from "../renderer-model-client.js";

export const SETTINGS_TRIGGER_ATTRIBUTE = "data-codexhost-settings-trigger";
const SYSTEM_ONE_TRIGGER_ATTRIBUTE = "data-codexhost-system-one-model";
/** 由 codexhost 注入、不属于 Desktop 原生结构的 header 控件。 */
export const RENDERER_INJECTED_CONTROL_SELECTOR = `[${SETTINGS_TRIGGER_ATTRIBUTE}],[${SYSTEM_ONE_TRIGGER_ATTRIBUTE}]`;
export const SETTINGS_HEADER_SURFACE_SELECTOR =
  '[data-testid="app-shell-header-context-menu-surface"]';
const SETTINGS_APPLICATION_HEADER_SELECTOR = 'header[data-pip-obstacle="app-shell-header"]';
const SETTINGS_HEADER_SLOT_SELECTOR = ':scope > [data-test-id="header-shell-slot"]';
const SETTINGS_HEADER_NATIVE_ACTION_GROUP_SELECTOR =
  ':scope > [data-app-shell-header-obstacle="true"]';

export interface RendererSettingsTriggerControl {
  root: HTMLElement;
  button: HTMLButtonElement;
  updateButton: HTMLButtonElement;
  setUpdateAvailable(available: boolean): void;
  dispose(): void;
}

export interface RendererSettingsBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface RendererSettingsHeaderSlotCandidate<T> {
  value: T;
  bounds: RendererSettingsBounds;
  visibleButtonCount: number;
  structuralActionGroup?: boolean;
}

export interface RendererSettingsHeaderTriggerControl {
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

interface RendererSettingsHeaderInsertionPoint {
  parent: HTMLElement;
  before: ChildNode | null;
}

export interface RendererSettingsContractInspection {
  headerCount: number;
  visibleHeaderCount: number;
  insertionPointCount: number;
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

export function selectRendererSettingsHeaderSlot<T>(
  header: RendererSettingsBounds,
  candidates: readonly RendererSettingsHeaderSlotCandidate<T>[],
): T | null {
  const midpoint = header.left + header.width / 2;
  const maximumWidth = Math.min(320, header.width / 2);
  const eligible = candidates.filter(
    ({ bounds, visibleButtonCount, structuralActionGroup }) =>
      (visibleButtonCount > 1 || structuralActionGroup === true) &&
      bounds.width >= 0 &&
      bounds.height >= 0 &&
      bounds.width <= maximumWidth &&
      bounds.left >= midpoint &&
      bounds.right <= header.right + 1 &&
      bounds.top >= header.top - 1 &&
      bounds.bottom <= header.bottom + 1,
  );
  eligible.sort(
    (left, right) =>
      Math.abs(header.right - left.bounds.right) - Math.abs(header.right - right.bounds.right) ||
      right.visibleButtonCount - left.visibleButtonCount ||
      left.bounds.left - right.bounds.left,
  );
  return eligible[0]?.value ?? null;
}

export function inspectRendererSettingsContract(
  ownerDocument: Document = document,
): RendererSettingsContractInspection {
  const headers = [
    ...ownerDocument.querySelectorAll<HTMLElement>(SETTINGS_APPLICATION_HEADER_SELECTOR),
  ];
  const visibleHeaders = headers.filter((header) => {
    const bounds = measuredBounds(header);
    return bounds.width > 0 && bounds.height > 0;
  });
  const insertionPointCount = visibleHeaders.filter((header) =>
    [...header.querySelectorAll<HTMLElement>(SETTINGS_HEADER_SLOT_SELECTOR)].some((slot) => {
      const bounds = measuredBounds(slot);
      return bounds.width > 0 && bounds.height > 0;
    }),
  ).length;
  return {
    headerCount: headers.length,
    visibleHeaderCount: visibleHeaders.length,
    insertionPointCount,
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
  root.style.display = "inline-flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.alignSelf = "center";
  root.style.flex = "0 0 auto";
  root.style.marginRight = "0";
  root.style.color = "inherit";
  root.style.pointerEvents = "auto";
  root.style.setProperty("-webkit-app-region", "no-drag");

  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.disabled = !available;
  button.setAttribute("aria-label", messages.openSettings);
  button.setAttribute("aria-haspopup", "dialog");
  button.title = available ? messages.settingsButtonTitle : messages.settingsUnavailableTitle;
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.height = "28px";
  button.style.padding = "0 12px";
  button.style.gap = "6px";
  button.style.border = "0";
  button.style.borderRadius = "8px";
  button.style.background = "transparent";
  button.style.color = "inherit";
  button.style.cursor = available ? "pointer" : "not-allowed";
  button.style.opacity = available ? "1" : "0.5";
  button.style.outlineOffset = "2px";
  button.style.setProperty("-webkit-app-region", "no-drag");
  button.append(createRendererSettingsBrandIcon(24));

  const brandLabel = ownerDocument.createElement("span");
  brandLabel.textContent = "CodexBuddy";
  brandLabel.style.fontSize = "13px";
  brandLabel.style.fontWeight = "600";
  brandLabel.style.lineHeight = "1";
  brandLabel.style.whiteSpace = "nowrap";
  button.append(brandLabel);

  const updateButton = ownerDocument.createElement("button");
  updateButton.type = "button";
  updateButton.disabled = !available;
  updateButton.setAttribute("aria-label", messages.updateAvailable);
  updateButton.setAttribute("aria-haspopup", "dialog");
  updateButton.title = messages.updateAvailable;
  updateButton.style.display = "none";
  updateButton.style.alignItems = "center";
  updateButton.style.justifyContent = "center";
  updateButton.style.height = "28px";
  updateButton.style.padding = "0 10px";
  updateButton.style.gap = "6px";
  updateButton.style.border = "1px solid #1d4ed8";
  updateButton.style.borderRadius = "7px";
  updateButton.style.background = "#2563eb";
  updateButton.style.color = "#ffffff";
  updateButton.style.cursor = available ? "pointer" : "not-allowed";
  updateButton.style.opacity = available ? "1" : "0.5";
  updateButton.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.18)";
  updateButton.style.outlineOffset = "2px";
  updateButton.style.setProperty("-webkit-app-region", "no-drag");
  updateButton.append(createRendererSettingsIcon("updates", 15));

  const updateLabel = ownerDocument.createElement("span");
  updateLabel.textContent = messages.pageLabels.updates;
  updateLabel.style.fontSize = "12px";
  updateLabel.style.fontWeight = "600";
  updateLabel.style.lineHeight = "1";
  updateLabel.style.whiteSpace = "nowrap";
  updateButton.append(updateLabel);

  const onPointerEnter = (): void => {
    if (!button.disabled) button.style.background = "rgba(127, 127, 127, 0.16)";
  };
  const onPointerLeave = (): void => {
    button.style.background = "transparent";
  };
  const onClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (!button.disabled) onOpen(button);
  };
  const onUpdatePointerEnter = (): void => {
    if (!updateButton.disabled) {
      updateButton.style.background = "#1d4ed8";
      updateButton.style.boxShadow = "0 2px 4px rgba(15, 23, 42, 0.22)";
    }
  };
  const onUpdatePointerLeave = (): void => {
    updateButton.style.background = "#2563eb";
    updateButton.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.18)";
  };
  const onUpdateClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (!updateButton.disabled) onOpen(updateButton, "updates");
  };
  button.addEventListener("pointerenter", onPointerEnter);
  button.addEventListener("pointerleave", onPointerLeave);
  button.addEventListener("click", onClick);
  updateButton.addEventListener("pointerenter", onUpdatePointerEnter);
  updateButton.addEventListener("pointerleave", onUpdatePointerLeave);
  updateButton.addEventListener("click", onUpdateClick);
  root.append(button, updateButton);

  return {
    root,
    button,
    updateButton,
    setUpdateAvailable(updateAvailable) {
      root.toggleAttribute("data-update-available", updateAvailable);
      updateButton.style.display = updateAvailable ? "inline-flex" : "none";
    },
    dispose() {
      button.removeEventListener("pointerenter", onPointerEnter);
      button.removeEventListener("pointerleave", onPointerLeave);
      button.removeEventListener("click", onClick);
      updateButton.removeEventListener("pointerenter", onUpdatePointerEnter);
      updateButton.removeEventListener("pointerleave", onUpdatePointerLeave);
      updateButton.removeEventListener("click", onUpdateClick);
      root.remove();
    },
  };
}

export function installRendererSettingsHeaderTrigger(options: {
  available: boolean;
  onOpen(opener: HTMLButtonElement, pageId?: "updates"): void;
  messages?: RendererSettingsMessages;
  ownerDocument?: Document;
}): RendererSettingsHeaderTriggerControl {
  const ownerDocument = options.ownerDocument ?? document;
  let trigger: RendererSettingsTriggerControl | null = null;
  let updateAvailable = false;
  let disposed = false;

  const refresh = (): boolean => {
    if (disposed) return false;
    const insertionPoint = findRendererSettingsHeaderInsertionPoint(ownerDocument);
    if (!insertionPoint) {
      trigger?.root.remove();
      return false;
    }
    if (!trigger) {
      for (const duplicate of ownerDocument.querySelectorAll(`[${SETTINGS_TRIGGER_ATTRIBUTE}]`)) {
        duplicate.remove();
      }
      trigger = mountRendererSettingsTrigger(
        "application-header",
        options.available,
        options.onOpen,
        ownerDocument,
        options.messages,
      );
      trigger.setUpdateAvailable(updateAvailable);
    }
    if (
      trigger.root.parentElement !== insertionPoint.parent ||
      trigger.root.nextSibling !== insertionPoint.before
    ) {
      insertionPoint.parent.insertBefore(trigger.root, insertionPoint.before);
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
