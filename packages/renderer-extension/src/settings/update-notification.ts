import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import { formatUpdateBytes, isWindowsRenderer, statusMessage } from "./pages.js";
import { installRendererUpdateRailTrigger } from "./trigger.js";
import { isPollingUpdateStatus, type RendererUpdateController } from "./update-controller.js";
import notificationStyles from "./update-notification.css";

export function installRendererUpdateNotification(options: {
  controller: RendererUpdateController;
  messages: RendererSettingsMessages;
  ownerWindow: Window;
  openSettings(button: HTMLButtonElement): void;
}) {
  const { controller, messages, ownerWindow } = options;
  const document = ownerWindow.document;
  const root = document.createElement("div");
  root.setAttribute("data-codexhost-update-notification", "");
  root.hidden = true;
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = notificationStyles;
  const panel = document.createElement("section");
  panel.className = "update-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", messages.updateNotificationTitle);
  const heading = document.createElement("div");
  heading.className = "update-heading";
  const title = document.createElement("strong");
  title.textContent = messages.updateNotificationTitle;
  heading.append(createRendererSettingsIcon("updates", 20), title);
  const version = document.createElement("p");
  version.className = "update-version";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const progress = document.createElement("progress");
  progress.setAttribute("aria-label", messages.updateDownloading);
  const detail = document.createElement("p");
  detail.className = "update-detail";
  const error = document.createElement("p");
  error.className = "update-error";
  const actions = document.createElement("div");
  actions.className = "update-actions";
  const later = document.createElement("button");
  later.type = "button";
  later.textContent = messages.updateLater;
  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "update-primary";
  actions.append(later, primary);
  panel.append(heading, version, status, progress, detail, error, actions);
  shadow.append(style, panel);
  document.body.append(root);
  let readyVersion: string | null = null;
  let primaryLabel = "";

  const position = (): void => {
    if (root.hidden) return;
    const anchor = trigger.button.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    root.style.left = `${Math.max(12, Math.min(anchor.right + 8, ownerWindow.innerWidth - bounds.width - 12))}px`;
    root.style.top = `${Math.max(12, Math.min(anchor.top, ownerWindow.innerHeight - bounds.height - 12))}px`;
  };
  const close = (): void => {
    root.hidden = true;
    trigger.button.setAttribute("aria-expanded", "false");
  };
  const open = (): void => {
    root.hidden = false;
    trigger.button.setAttribute("aria-expanded", "true");
    position();
  };
  const automatic = (): boolean =>
    !isWindowsRenderer(ownerWindow) && controller.snapshot.check?.installationAvailable === true;
  const start = (): void => {
    if (!automatic()) {
      close();
      options.openSettings(trigger.button);
      return;
    }
    void controller.startUpdate().catch(() => undefined);
  };
  const trigger = installRendererUpdateRailTrigger({
    ownerDocument: document,
    onOpen() {
      open();
      later.focus();
      const snapshot = controller.snapshot;
      if (!snapshot.busy && !snapshot.error && !snapshot.status && snapshot.check?.updateAvailable)
        start();
    },
  });
  trigger.refresh();

  later.addEventListener("click", () => {
    close();
    trigger.button.focus();
  });
  primary.addEventListener("click", () => {
    if (controller.snapshot.busy) return;
    if (controller.snapshot.status?.phase === "ready-to-restart") {
      void controller.restartUpdate().catch(() => undefined);
    } else if (!automatic()) {
      close();
      options.openSettings(trigger.button);
    } else if (isPollingUpdateStatus(controller.snapshot.status)) {
      void controller.readUpdateStatus().catch(() => undefined);
    } else start();
  });
  const unsubscribe = controller.subscribe((snapshot) => {
    const phase = snapshot.status?.phase;
    const active = isPollingUpdateStatus(snapshot.status);
    const ready = phase === "ready-to-restart";
    const visible = Boolean(snapshot.check?.updateAvailable || active || ready || snapshot.busy);
    trigger.setState(
      visible,
      ready
        ? messages.updateRestart
        : active || snapshot.busy
          ? messages.updateDownloading
          : messages.updateDownload,
    );
    version.textContent =
      snapshot.status?.version || snapshot.check?.latestVersion
        ? `v${snapshot.status?.version ?? snapshot.check?.latestVersion}`
        : "";
    const restarting =
      snapshot.busy === "restart" ||
      (["prepared", "waiting-for-exit", "installing", "restarting"].includes(phase ?? "") &&
        snapshot.busy !== "start");
    status.textContent =
      snapshot.busy === "restart"
        ? messages.updateRestarting
        : snapshot.busy === "start" && !active
          ? messages.updatePreparing
          : (statusMessage(snapshot.status, messages) ?? messages.updateAvailable);
    progress.hidden = phase !== "downloading";
    detail.hidden = progress.hidden;
    if (!progress.hidden) {
      const downloaded = snapshot.status?.downloadedBytes ?? 0;
      const total = snapshot.status?.totalBytes;
      if (total && total > 0) {
        progress.max = total;
        progress.value = Math.min(downloaded, total);
        detail.textContent = `${Math.min(100, Math.round((downloaded / total) * 100))}% · ${formatUpdateBytes(downloaded)} / ${formatUpdateBytes(total)}`;
      } else {
        progress.removeAttribute("value");
        detail.textContent = formatUpdateBytes(downloaded);
      }
    }
    error.hidden = !snapshot.error;
    error.textContent =
      snapshot.error instanceof Error
        ? snapshot.error.message
        : snapshot.error
          ? String(snapshot.error)
          : "";
    const label = ready
      ? messages.updateRestart
      : snapshot.error || phase === "failed"
        ? messages.updateRetry
        : automatic()
          ? messages.updateDownload
          : messages.pageLabels.updates;
    if (primaryLabel !== label) {
      primaryLabel = label;
      primary.replaceChildren(
        createRendererSettingsIcon(ready ? "refresh" : "download", 14),
        label,
      );
    }
    primary.hidden = (active || snapshot.busy !== null) && !snapshot.error;
    primary.disabled = snapshot.busy !== null || restarting;
    if (!visible) close();
    if (
      snapshot.status?.phase === "ready-to-restart" &&
      readyVersion !== snapshot.status.version &&
      trigger.root.isConnected
    ) {
      readyVersion = snapshot.status.version;
      open();
    }
    position();
  });
  const outside = (event: PointerEvent): void => {
    const path = event.composedPath();
    if (!path.includes(root) && !path.includes(trigger.root)) close();
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || root.hidden) return;
    close();
    trigger.button.focus();
  };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);
  ownerWindow.addEventListener("resize", position);
  return {
    refresh(): boolean {
      const refreshed = trigger.refresh();
      position();
      return refreshed;
    },
    dispose(): void {
      unsubscribe();
      trigger.dispose();
      root.remove();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      ownerWindow.removeEventListener("resize", position);
    },
  };
}
