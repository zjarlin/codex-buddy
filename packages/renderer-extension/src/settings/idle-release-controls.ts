import {
  IDLE_RELEASE_TIMEOUT_MINUTES_MAX,
  IDLE_RELEASE_TIMEOUT_MINUTES_MIN,
  idleReleaseSettingsSchema,
  type IdleReleaseSettings,
  THREAD_AUTO_ARCHIVE_DAYS_MAX,
  THREAD_AUTO_ARCHIVE_DAYS_MIN,
  threadAutoArchiveSettingsSchema,
  type ThreadAutoArchiveSettings,
} from "@codexhost/shared-contracts";
import {
  IDLE_RELEASE_CHANGE_EVENT,
  IDLE_RELEASE_STATUS_EVENT,
  IDLE_RELEASE_STORAGE_KEY,
  readIdleReleasePreference,
  writeIdleReleasePreference,
  type IdleReleaseSyncStatus,
} from "../renderer-idle-release-preference.js";
import {
  THREAD_AUTO_ARCHIVE_CHANGE_EVENT,
  THREAD_AUTO_ARCHIVE_STATUS_EVENT,
  THREAD_AUTO_ARCHIVE_STORAGE_KEY,
  readThreadAutoArchivePreference,
  writeThreadAutoArchivePreference,
  type ThreadAutoArchiveSyncStatus,
} from "../renderer-thread-auto-archive-preference.js";
import type { RendererSettingsMessages } from "./localization.js";
import type { RendererSettingsPageMountContext } from "./core.js";
import { mountLoadedSessionsTable, type LoadedSessionsClient } from "./loaded-sessions-table.js";
import {
  createNumberField,
  createPreferenceGroup,
  createPreferenceItem,
  createPreferenceSwitch,
  preferenceId,
} from "./preference-ui.js";

export function mountIdleReleaseControls(
  context: RendererSettingsPageMountContext,
  messages: RendererSettingsMessages,
  getLoadedSessionsClient: () => LoadedSessionsClient | null,
): () => void {
  const { content } = context;
  const document = content.ownerDocument;
  const owner = document.defaultView;
  if (!owner) return () => undefined;
  const { group, header, card } = createPreferenceGroup(document, messages.idleReleaseSection);

  const status = document.createElement("div");
  status.className =
    "group/status ml-auto inline-flex items-center gap-1.5 text-xs leading-[18px] text-settings-muted data-[state=failed]:text-settings-danger data-[state=unavailable]:text-settings-warning";
  const statusDot = document.createElement("span");
  statusDot.setAttribute("aria-hidden", "true");
  statusDot.className =
    "size-1.5 shrink-0 rounded-full bg-settings-subtle group-data-[state=failed]/status:bg-settings-danger group-data-[state=unavailable]/status:bg-settings-warning";
  const statusText = document.createElement("span");
  statusText.setAttribute("role", "status");
  status.append(statusDot, statusText);
  header.append(status);

  const enabledId = preferenceId("idle-release-enabled");
  const toggle = createPreferenceItem(document, {
    title: messages.idleReleaseTitle,
    description: messages.idleReleaseDescription,
    controlId: enabledId,
    help: { label: messages.idleReleaseHelpLabel, lines: messages.idleReleaseHelp },
  });
  const enabled = createPreferenceSwitch(document, enabledId, toggle.description.id);
  toggle.item.append(enabled);

  const minutesId = preferenceId("idle-release-minutes");
  const timeout = createPreferenceItem(document, {
    title: messages.idleReleaseTimeout,
    description: messages.idleReleaseTimeoutDescription,
    controlId: minutesId,
  });
  const { field, control: minutes } = createNumberField(document, {
    id: minutesId,
    describedBy: timeout.description.id,
    unit: messages.idleReleaseMinutes,
    min: IDLE_RELEASE_TIMEOUT_MINUTES_MIN,
    max: IDLE_RELEASE_TIMEOUT_MINUTES_MAX,
  });
  timeout.item.append(field);
  timeout.item.id = preferenceId("idle-release-timeout");
  enabled.setAttribute("aria-controls", timeout.item.id);

  const archiveEnabledId = preferenceId("thread-auto-archive-enabled");
  const archiveToggle = createPreferenceItem(document, {
    title: messages.threadAutoArchiveTitle,
    description: messages.threadAutoArchiveDescription,
    controlId: archiveEnabledId,
    help: {
      label: messages.threadAutoArchiveHelpLabel,
      lines: messages.threadAutoArchiveHelp,
    },
  });
  const archiveEnabled = createPreferenceSwitch(
    document,
    archiveEnabledId,
    archiveToggle.description.id,
  );
  archiveToggle.item.append(archiveEnabled);

  const archiveDaysId = preferenceId("thread-auto-archive-days");
  const archiveTimeout = createPreferenceItem(document, {
    title: messages.threadAutoArchiveTimeout,
    description: messages.threadAutoArchiveTimeoutDescription,
    controlId: archiveDaysId,
  });
  const { field: archiveField, control: archiveDays } = createNumberField(document, {
    id: archiveDaysId,
    describedBy: archiveTimeout.description.id,
    unit: messages.threadAutoArchiveDays,
    min: THREAD_AUTO_ARCHIVE_DAYS_MIN,
    max: THREAD_AUTO_ARCHIVE_DAYS_MAX,
  });
  archiveTimeout.item.append(archiveField);
  archiveTimeout.item.id = preferenceId("thread-auto-archive-timeout");
  archiveEnabled.setAttribute("aria-controls", archiveTimeout.item.id);

  card.append(toggle.item, timeout.item, archiveToggle.item, archiveTimeout.item);
  content.append(group);
  const disposeTable = mountLoadedSessionsTable(
    { ...context, content: card },
    messages,
    getLoadedSessionsClient,
  );

  const statusMessages: Record<Exclude<IdleReleaseSyncStatus, "applied">, string> = {
    pending: messages.idleReleasePending,
    unavailable: messages.idleReleaseUnavailable,
    failed: messages.idleReleaseFailed,
  };
  const showStatus = (value: IdleReleaseSyncStatus | ThreadAutoArchiveSyncStatus): void => {
    status.dataset.state = value;
    // An applied setting needs no message; only pending, unsupported or failed sync is shown.
    status.hidden = value === "applied";
    statusText.textContent = value === "applied" ? "" : statusMessages[value];
  };
  const setInvalid = (invalid: boolean): void => {
    field.dataset.invalid = String(invalid);
    timeout.description.dataset.invalid = String(invalid);
    timeout.description.textContent = invalid
      ? messages.idleReleaseInvalid
      : messages.idleReleaseTimeoutDescription;
    minutes.setAttribute("aria-invalid", String(invalid));
    minutes.setCustomValidity(invalid ? messages.idleReleaseInvalid : "");
  };
  const setArchiveInvalid = (invalid: boolean): void => {
    archiveField.dataset.invalid = String(invalid);
    archiveTimeout.description.dataset.invalid = String(invalid);
    archiveTimeout.description.textContent = invalid
      ? messages.threadAutoArchiveInvalid
      : messages.threadAutoArchiveTimeoutDescription;
    archiveDays.setAttribute("aria-invalid", String(invalid));
    archiveDays.setCustomValidity(invalid ? messages.threadAutoArchiveInvalid : "");
  };
  const sync = (): void => {
    const settings = readIdleReleasePreference(owner);
    enabled.checked = settings.enabled;
    // The timeout only matters while release is enabled; hiding it discards an invalid draft.
    timeout.item.hidden = !settings.enabled;
    if (!settings.enabled && minutes.getAttribute("aria-invalid") === "true") setInvalid(false);
    // Otherwise keep an invalid draft visible until the user corrects it.
    if (minutes.getAttribute("aria-invalid") !== "true") {
      minutes.value = String(settings.timeoutMinutes);
    }
    const archiveSettings = readThreadAutoArchivePreference(owner);
    archiveEnabled.checked = archiveSettings.enabled;
    archiveTimeout.item.hidden = !archiveSettings.enabled;
    if (!archiveSettings.enabled && archiveDays.getAttribute("aria-invalid") === "true") {
      setArchiveInvalid(false);
    }
    if (archiveDays.getAttribute("aria-invalid") !== "true") {
      archiveDays.value = String(archiveSettings.inactiveDays);
    }
  };
  const save = (settings: IdleReleaseSettings): void => {
    if (writeIdleReleasePreference(owner, settings)) return;
    sync();
    showStatus("failed");
  };
  const saveArchive = (settings: ThreadAutoArchiveSettings): void => {
    if (writeThreadAutoArchivePreference(owner, settings)) return;
    sync();
    showStatus("failed");
  };

  enabled.addEventListener("change", () => {
    save({ ...readIdleReleasePreference(owner), enabled: enabled.checked });
  });
  minutes.addEventListener("change", () => {
    const parsed = idleReleaseSettingsSchema.safeParse({
      enabled: readIdleReleasePreference(owner).enabled,
      timeoutMinutes: minutes.valueAsNumber,
    });
    setInvalid(!parsed.success);
    if (parsed.success) save(parsed.data);
  });
  minutes.addEventListener("input", () => {
    if (minutes.getAttribute("aria-invalid") === "true") setInvalid(false);
  });
  archiveEnabled.addEventListener("change", () => {
    saveArchive({
      ...readThreadAutoArchivePreference(owner),
      enabled: archiveEnabled.checked,
    });
  });
  archiveDays.addEventListener("change", () => {
    const parsed = threadAutoArchiveSettingsSchema.safeParse({
      enabled: readThreadAutoArchivePreference(owner).enabled,
      inactiveDays: archiveDays.valueAsNumber,
    });
    setArchiveInvalid(!parsed.success);
    if (parsed.success) saveArchive(parsed.data);
  });
  archiveDays.addEventListener("input", () => {
    if (archiveDays.getAttribute("aria-invalid") === "true") setArchiveInvalid(false);
  });
  const storage = (event: StorageEvent): void => {
    if (
      event.key === IDLE_RELEASE_STORAGE_KEY ||
      event.key === THREAD_AUTO_ARCHIVE_STORAGE_KEY ||
      event.key === null
    )
      sync();
  };
  const onStatus = (event: Event): void =>
    showStatus((event as CustomEvent<IdleReleaseSyncStatus | ThreadAutoArchiveSyncStatus>).detail);
  owner.addEventListener(IDLE_RELEASE_CHANGE_EVENT, sync);
  owner.addEventListener(IDLE_RELEASE_STATUS_EVENT, onStatus);
  owner.addEventListener(THREAD_AUTO_ARCHIVE_CHANGE_EVENT, sync);
  owner.addEventListener(THREAD_AUTO_ARCHIVE_STATUS_EVENT, onStatus);
  owner.addEventListener("storage", storage);
  sync();
  showStatus("pending");
  // Ask the installed connection synchronizer to report whether the saved setting was applied.
  owner.dispatchEvent(new Event(IDLE_RELEASE_CHANGE_EVENT));
  owner.dispatchEvent(new Event(THREAD_AUTO_ARCHIVE_CHANGE_EVENT));
  return () => {
    disposeTable();
    owner.removeEventListener(IDLE_RELEASE_CHANGE_EVENT, sync);
    owner.removeEventListener(IDLE_RELEASE_STATUS_EVENT, onStatus);
    owner.removeEventListener(THREAD_AUTO_ARCHIVE_CHANGE_EVENT, sync);
    owner.removeEventListener(THREAD_AUTO_ARCHIVE_STATUS_EVENT, onStatus);
    owner.removeEventListener("storage", storage);
  };
}
