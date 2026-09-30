import createElement from "lucide/dist/esm/createElement.mjs";
import Forward from "lucide/dist/esm/icons/forward.mjs";

import { sessionPickerMessages } from "./renderer-session-picker-messages.js";
import type { RendererSettingsLocale } from "./settings/localization.js";

const CONTROL_ATTRIBUTE = "data-codexhost-session-transfer-control";

export interface RendererSessionTransferControl {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  setLocale(locale: RendererSettingsLocale): void;
  setVisible(visible: boolean): void;
  setDisabled(disabled: boolean): void;
  placeBefore(reference: Element | null): boolean;
  dispose(): void;
}

function styleTrigger(button: HTMLButtonElement): void {
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    height: "28px",
    padding: "0 7px",
    border: "0",
    borderRadius: "8px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
}

/** A deliberate alternate-destination entry next to the native send button. */
export function mountRendererSessionTransferControl(
  parent: Element,
  insertBefore: Element | null,
  onOpen: () => void,
  initialLocale: RendererSettingsLocale = "en",
): RendererSessionTransferControl {
  const ownerDocument = parent.ownerDocument;
  let messages = sessionPickerMessages(initialLocale);
  let visible = false;
  let disabled = false;
  let hovered = false;

  const root = ownerDocument.createElement("div");
  root.setAttribute(CONTROL_ATTRIBUTE, "true");
  root.style.display = "inline-flex";
  root.style.alignItems = "center";
  root.style.minWidth = "0";
  root.hidden = !visible;

  const trigger = ownerDocument.createElement("button");
  trigger.type = "button";
  styleTrigger(trigger);
  trigger.append(
    createElement(Forward, { width: 15, height: 15, "aria-hidden": "true" }),
    ownerDocument.createTextNode(messages.transfer),
  );
  root.append(trigger);

  const sync = (): void => {
    root.hidden = !visible;
    trigger.disabled = disabled;
    trigger.setAttribute("aria-label", messages.transferTitle);
    trigger.title = messages.transferTitle;
    trigger.style.opacity = disabled ? ".55" : "1";
    trigger.style.cursor = disabled ? "default" : "pointer";
    trigger.style.background = hovered && !disabled ? "rgba(127, 127, 127, 0.14)" : "transparent";
  };
  const onClick = (): void => onOpen();
  const onEnter = (): void => {
    hovered = true;
    sync();
  };
  const onLeave = (): void => {
    hovered = false;
    sync();
  };
  trigger.addEventListener("click", onClick);
  trigger.addEventListener("pointerenter", onEnter);
  trigger.addEventListener("pointerleave", onLeave);

  if (insertBefore?.parentElement === parent) parent.insertBefore(root, insertBefore);
  else parent.append(root);
  sync();

  return {
    root,
    trigger,
    setLocale(locale) {
      const next = sessionPickerMessages(locale);
      if (next === messages) return;
      messages = next;
      trigger.lastChild?.remove();
      trigger.append(ownerDocument.createTextNode(messages.transfer));
      sync();
    },
    setVisible(nextVisible) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      sync();
    },
    setDisabled(nextDisabled) {
      if (disabled === nextDisabled) return;
      disabled = nextDisabled;
      sync();
    },
    placeBefore(reference) {
      if (!reference?.parentElement) return false;
      if (root.parentElement === reference.parentElement && root.nextElementSibling === reference) {
        return true;
      }
      reference.parentElement.insertBefore(root, reference);
      return true;
    },
    dispose() {
      trigger.removeEventListener("click", onClick);
      trigger.removeEventListener("pointerenter", onEnter);
      trigger.removeEventListener("pointerleave", onLeave);
      root.remove();
    },
  };
}
