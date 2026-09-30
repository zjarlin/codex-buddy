import {
  DEFAULT_THREAD_AUTO_ARCHIVE_SETTINGS,
  threadAutoArchiveSettingsSchema,
  type ThreadAutoArchiveSettings,
} from "@codexhost/shared-contracts";
import type { RendererModelClient } from "./renderer-model-client.js";
import { RendererMethodUnavailableError } from "./renderer-request-sender.js";

export const THREAD_AUTO_ARCHIVE_STORAGE_KEY = "codexhost.thread-auto-archive.v1";
export const THREAD_AUTO_ARCHIVE_CHANGE_EVENT = "codexhost:thread-auto-archive-changed";
export const THREAD_AUTO_ARCHIVE_STATUS_EVENT = "codexhost:thread-auto-archive-status";
export type ThreadAutoArchiveSyncStatus = "pending" | "applied" | "unavailable" | "failed";

export function readThreadAutoArchivePreference(owner: Window): ThreadAutoArchiveSettings {
  try {
    const raw = owner.localStorage.getItem(THREAD_AUTO_ARCHIVE_STORAGE_KEY);
    const parsed = threadAutoArchiveSettingsSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (parsed.success) return parsed.data;
  } catch {
    /* An unavailable preference store must not enable automatic archiving. */
  }
  return { ...DEFAULT_THREAD_AUTO_ARCHIVE_SETTINGS };
}

export function writeThreadAutoArchivePreference(
  owner: Window,
  value: ThreadAutoArchiveSettings,
): boolean {
  const parsed = threadAutoArchiveSettingsSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    owner.localStorage.setItem(THREAD_AUTO_ARCHIVE_STORAGE_KEY, JSON.stringify(parsed.data));
  } catch {
    return false;
  }
  owner.dispatchEvent(new Event(THREAD_AUTO_ARCHIVE_CHANGE_EVENT));
  return true;
}

/** One connection synchronizer per Renderer installation; never uses the active remote route. */
export function installThreadAutoArchivePreferenceSync(owner: Window): {
  connect(client: RendererModelClient | null): void;
  dispose(): void;
} {
  let client: RendererModelClient | null = null;
  let disposed = false;
  let generation = 0;
  let work = { pending: false, dirty: false };
  const publish = (value: ThreadAutoArchiveSyncStatus): void => {
    owner.dispatchEvent(new CustomEvent(THREAD_AUTO_ARCHIVE_STATUS_EVENT, { detail: value }));
  };
  const sync = async (): Promise<void> => {
    const currentWork = work;
    const version = generation;
    currentWork.dirty = true;
    if (currentWork.pending || disposed) return;
    currentWork.pending = true;
    try {
      while (currentWork.dirty && !disposed && version === generation) {
        currentWork.dirty = false;
        const target = client;
        if (!target) {
          publish("pending");
          continue;
        }
        if (!target.setThreadAutoArchiveSettings) {
          publish("unavailable");
          continue;
        }
        const settings = readThreadAutoArchivePreference(owner);
        publish("pending");
        try {
          await target.setThreadAutoArchiveSettings(settings);
          if (!disposed && version === generation && !currentWork.dirty) publish("applied");
        } catch (error) {
          if (!disposed && version === generation) {
            publish(error instanceof RendererMethodUnavailableError ? "unavailable" : "failed");
          }
        }
      }
    } finally {
      currentWork.pending = false;
    }
  };
  const changed = (): void => {
    void sync();
  };
  const storage = (event: StorageEvent): void => {
    if (event.key === THREAD_AUTO_ARCHIVE_STORAGE_KEY || event.key === null) changed();
  };
  owner.addEventListener(THREAD_AUTO_ARCHIVE_CHANGE_EVENT, changed);
  owner.addEventListener("storage", storage);
  return {
    connect(next) {
      if (disposed) return;
      if (next === client) return;
      client = next;
      generation += 1;
      work = { pending: false, dirty: false };
      void sync();
    },
    dispose() {
      disposed = true;
      generation += 1;
      client = null;
      owner.removeEventListener(THREAD_AUTO_ARCHIVE_CHANGE_EVENT, changed);
      owner.removeEventListener("storage", storage);
    },
  };
}
