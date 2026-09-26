import { describe, expect, it, vi } from "vitest";

import {
  createThreadTerminalPreferenceStore,
  THREAD_TERMINAL_PREFERENCE_STORAGE_KEY,
} from "../src/thread-terminal-preference.js";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe("thread terminal preference", () => {
  it("persists and restores a selected terminal", () => {
    const backing = storage();
    const first = createThreadTerminalPreferenceStore(backing);
    const listener = vi.fn();
    first.subscribe(listener);

    first.set("ghostty");
    expect(first.get()).toBe("ghostty");
    expect(backing.setItem).toHaveBeenCalledWith(THREAD_TERMINAL_PREFERENCE_STORAGE_KEY, "ghostty");
    expect(listener).toHaveBeenCalledOnce();

    expect(createThreadTerminalPreferenceStore(backing).get()).toBe("ghostty");
  });

  it("clears back to Host defaults without trusting arbitrary stored values", () => {
    const backing = storage({ [THREAD_TERMINAL_PREFERENCE_STORAGE_KEY]: "/bin/sh" });
    const store = createThreadTerminalPreferenceStore(backing);
    expect(store.get()).toBeNull();

    store.set("iterm2");
    store.set(null);
    expect(store.get()).toBeNull();
    expect(backing.removeItem).toHaveBeenCalledWith(THREAD_TERMINAL_PREFERENCE_STORAGE_KEY);
  });
});
