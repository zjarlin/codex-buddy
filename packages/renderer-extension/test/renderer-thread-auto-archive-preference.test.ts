import { describe, expect, it, vi } from "vitest";
import { THREAD_AUTO_ARCHIVE_SETTINGS_METHOD } from "@codexhost/shared-contracts";
import { createRendererModelClient } from "../src/renderer-model-client.js";
import {
  THREAD_AUTO_ARCHIVE_STORAGE_KEY,
  THREAD_AUTO_ARCHIVE_STATUS_EVENT,
  installThreadAutoArchivePreferenceSync,
  readThreadAutoArchivePreference,
  writeThreadAutoArchivePreference,
} from "../src/renderer-thread-auto-archive-preference.js";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const owner = Object.assign(new EventTarget(), { localStorage: storage }) as unknown as Window;
  const send = vi.fn(async (_method: string, params: unknown) => params);
  const client = createRendererModelClient([{ sendRequest: send }]);
  if (!client) throw new Error("Missing Renderer client");
  const statuses: string[] = [];
  owner.addEventListener(THREAD_AUTO_ARCHIVE_STATUS_EVENT, (event) => {
    statuses.push((event as CustomEvent<string>).detail);
  });
  return { owner, values, storage, send, client, statuses };
}

const flush = async () => {
  for (let i = 0; i < 15; i += 1) await Promise.resolve();
};

describe("Thread auto archive preference", () => {
  it("defaults off, preserves saved days while disabled, and rejects invalid settings", () => {
    const f = fixture();
    expect(readThreadAutoArchivePreference(f.owner)).toEqual({ enabled: false, inactiveDays: 30 });
    expect(writeThreadAutoArchivePreference(f.owner, { enabled: true, inactiveDays: 1 })).toBe(
      true,
    );
    expect(writeThreadAutoArchivePreference(f.owner, { enabled: false, inactiveDays: 1 })).toBe(
      true,
    );
    expect(readThreadAutoArchivePreference(f.owner)).toEqual({ enabled: false, inactiveDays: 1 });
    for (const inactiveDays of [0, 3651, 30.5, NaN, Infinity]) {
      expect(writeThreadAutoArchivePreference(f.owner, { enabled: true, inactiveDays })).toBe(
        false,
      );
    }
    expect(readThreadAutoArchivePreference(f.owner).enabled).toBe(false);
  });

  it("fails safely for corrupt and unavailable storage", () => {
    const f = fixture();
    for (const raw of ["broken", "null", '{"enabled":true,"inactiveDays":0}']) {
      f.values.set(THREAD_AUTO_ARCHIVE_STORAGE_KEY, raw);
      expect(readThreadAutoArchivePreference(f.owner).enabled).toBe(false);
    }
    f.storage.getItem.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    f.storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readThreadAutoArchivePreference(f.owner)).toEqual({ enabled: false, inactiveDays: 30 });
    expect(writeThreadAutoArchivePreference(f.owner, { enabled: true, inactiveDays: 30 })).toBe(
      false,
    );
  });

  it("sends complete validated settings on connect and changes", async () => {
    const f = fixture();
    const sync = installThreadAutoArchivePreferenceSync(f.owner);
    sync.connect(f.client);
    await flush();
    expect(f.send).toHaveBeenLastCalledWith(THREAD_AUTO_ARCHIVE_SETTINGS_METHOD, {
      enabled: false,
      inactiveDays: 30,
    });
    writeThreadAutoArchivePreference(f.owner, { enabled: true, inactiveDays: 30 });
    await flush();
    expect(f.send).toHaveBeenLastCalledWith(THREAD_AUTO_ARCHIVE_SETTINGS_METHOD, {
      enabled: true,
      inactiveDays: 30,
    });
    expect(f.statuses.at(-1)).toBe("applied");
    sync.dispose();
  });
});
