import type { ThreadTerminalId } from "@codexhost/shared-contracts";

export const THREAD_TERMINAL_PREFERENCE_STORAGE_KEY = "codexhost.thread-terminal.v1";

export interface ThreadTerminalPreferenceStore {
  get(): ThreadTerminalId | null;
  set(terminalId: ThreadTerminalId | null): void;
  subscribe(listener: () => void): () => void;
}

function safeLocalStorage(ownerWindow: Window | undefined = globalThis.window): Storage | null {
  try {
    return ownerWindow?.localStorage ?? null;
  } catch {
    return null;
  }
}

function isThreadTerminalId(value: unknown): value is ThreadTerminalId {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/u.test(value);
}

export function createThreadTerminalPreferenceStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = safeLocalStorage(),
): ThreadTerminalPreferenceStore {
  const listeners = new Set<() => void>();
  const read = (): ThreadTerminalId | null => {
    try {
      const raw = storage?.getItem(THREAD_TERMINAL_PREFERENCE_STORAGE_KEY);
      return raw && isThreadTerminalId(raw) ? raw : null;
    } catch {
      // Best effort only: an unavailable preference store falls back to Host discovery.
      return null;
    }
  };

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    get() {
      return read();
    },
    set(terminalId) {
      try {
        if (terminalId) storage?.setItem(THREAD_TERMINAL_PREFERENCE_STORAGE_KEY, terminalId);
        else storage?.removeItem(THREAD_TERMINAL_PREFERENCE_STORAGE_KEY);
      } catch {
        // Best effort only: the next read falls back to Host defaults.
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let sharedStore: ThreadTerminalPreferenceStore | null = null;

export function getSharedThreadTerminalPreferenceStore(): ThreadTerminalPreferenceStore {
  sharedStore ??= createThreadTerminalPreferenceStore();
  return sharedStore;
}

export function watchThreadTerminalPreference(
  ownerWindow: Window,
  listener: () => void,
): () => void {
  const storage = (event: StorageEvent): void => {
    if (event.key === THREAD_TERMINAL_PREFERENCE_STORAGE_KEY || event.key === null) listener();
  };
  ownerWindow.addEventListener("storage", storage);
  return () => ownerWindow.removeEventListener("storage", storage);
}
