import { h } from "./dom.js";
import type { ConsoleMessages } from "./messages.js";

export interface ReplaceDesktopChoice {
  /** Quit the Desktop that runs outside codexhost before starting. */
  replaceRunningDesktop: boolean;
}

/**
 * Ask before quitting a Codex Desktop that runs outside codexhost.
 *
 * Only the confirmed choice passes a destructive replacement to the Launcher,
 * and the Launcher refuses an unconfirmed replacement on every platform. The
 * prompt therefore belongs to the start action itself, not to error recovery.
 */
export function confirmReplaceDesktop(
  document: Document,
  container: HTMLElement,
  messages: ConsoleMessages,
  start: (choice: ReplaceDesktopChoice) => void,
  signal?: AbortSignal,
): void {
  const modal = document.createElement("dialog");
  modal.className = "settings-account-dialog settings-credential-dialog";
  modal.setAttribute("aria-label", messages.replaceDesktopTitle);
  const title = h(document, "h2", {}, messages.replaceDesktopTitle);
  const body = h(
    document,
    "div",
    { className: "settings-credential-dialog__body" },
    h(document, "p", {}, messages.replaceDesktopBody),
  );
  const cancel = h(
    document,
    "button",
    { type: "button", className: "settings-command-button settings-command-button--secondary" },
    messages.cancel,
  );
  const confirm = h(
    document,
    "button",
    {
      type: "button",
      className:
        "settings-command-button settings-command-button--secondary settings-command-button--danger",
    },
    messages.replaceDesktopConfirm,
  );
  let started = false;
  cancel.addEventListener("click", () => modal.close());
  confirm.addEventListener("click", () => {
    if (started) return;
    started = true;
    modal.close();
    start({ replaceRunningDesktop: true });
  });
  modal.addEventListener("cancel", (event) => {
    if (started) event.preventDefault();
  });
  modal.addEventListener("close", () => modal.remove());
  modal.append(
    title,
    body,
    h(document, "div", { className: "settings-credential-dialog__actions" }, cancel, confirm),
  );
  container.append(modal);
  signal?.addEventListener("abort", () => modal.remove(), { once: true });
  modal.showModal();
  cancel.focus();
}
