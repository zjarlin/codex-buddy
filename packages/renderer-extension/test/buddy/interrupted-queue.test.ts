import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RendererModelClient } from "../../src/renderer-model-client.js";
import {
  createInterruptedQueue,
  INTERRUPTED_QUEUE_STORAGE_KEY,
} from "../../src/buddy/interrupted-queue.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
function manager() {
  const callbacks = new Set<(event: unknown) => void>();
  return {
    addNotificationCallback: vi.fn(
      (_methods: string | readonly string[], listener: (event: unknown) => void) => {
        callbacks.add(listener);
        return () => {
          callbacks.delete(listener);
        };
      },
    ),
    emit: (method: string, params: unknown) => {
      for (const callback of callbacks) callback({ method, params });
    },
    callbacks,
  };
}
const metadata = (id: string) => ({
  thread: {
    id,
    name: `Title ${id}`,
    modelProvider: "openai",
    cliVersion: "1",
    status: { type: "idle" },
  },
});
function fixture(storage = memoryStorage()) {
  const managers = new Map([
    ["local", manager()],
    ["remote", manager()],
  ]);
  const projection = vi.fn(async (method: string, params: unknown): Promise<unknown> =>
    method === "thread/read" ? metadata((params as { threadId: string }).threadId) : {},
  );
  const client = {
    requestThreadProjection: projection,
    readThreadTurnState: vi.fn(async (id: string) => ({
      running: false,
      status: "failed",
      turnId: `${id}-turn`,
    })),
    buddyContinue: vi.fn(async () => {}),
    buddyInterrupted: vi.fn(async (): Promise<BuddyInterrupted> => ({
      threads: [],
      runningThreadIds: [],
      unreadable: 0,
    })),
  };
  const clients = new Map(
    [...managers.keys()].map((host) => [host, client as unknown as RendererModelClient]),
  );
  const queue = createInterruptedQueue({
    getHostIds: () => [...managers.keys()],
    getManager: (host) => managers.get(host) ?? null,
    getClient: (host) => clients.get(host) ?? null,
    storage,
  });
  queue.refresh();
  const emit = (
    method: string,
    id = "one",
    turnId = `${id}-turn`,
    status = "failed",
    host = "local",
  ) => {
    const target = managers.get(host);
    if (!target) throw new Error("Missing manager");
    target.emit(method, { threadId: id, turn: { id: turnId, status } });
  };
  const first = (host = "local") => {
    const entry = queue.list(host)[0];
    if (!entry) throw new Error("Missing queued interruption");
    return entry;
  };
  return { queue, client, projection, managers, clients, emit, first, storage };
}
async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe("interrupted event queue", () => {
  it("does not scan history on startup, reconnection, repeated binding or elapsed time", () => {
    vi.useFakeTimers();
    const f = fixture();
    for (let i = 0; i < 10; i += 1) f.queue.refresh();
    vi.advanceTimersByTime(300_000);
    expect(f.projection).not.toHaveBeenCalled();
    expect(f.client.buddyInterrupted).not.toHaveBeenCalled();
    expect(f.managers.get("local")?.addNotificationCallback).toHaveBeenCalledTimes(1);
    f.managers.set("local", manager());
    f.queue.refresh();
    expect(f.projection).not.toHaveBeenCalled();
    f.queue.dispose();
  });

  it.each(["failed", "interrupted", "cancelled"])(
    "queues %s immediately, deduplicates and persists across restarts",
    async (status) => {
      const f = fixture();
      f.emit("turn/completed", "one", "one-turn", status);
      expect(f.first().status).toBe(status);
      f.emit("turn/completed", "one", "one-turn", status);
      await settle();
      expect(f.projection).toHaveBeenCalledTimes(1);
      expect(f.first().title).toBe("Title one");
      f.queue.dispose();
      const restored = fixture(f.storage);
      expect(restored.first().title).toBe("Title one");
      expect(restored.projection).not.toHaveBeenCalled();
    },
  );

  it("isolates Hosts, removes started or archived turns and ignores late terminal events", async () => {
    const f = fixture();
    f.emit("turn/completed");
    f.emit("turn/completed", "one", "one-turn", "failed", "remote");
    await settle();
    f.emit("turn/started", "one", "new-turn");
    f.emit("turn/completed");
    expect(f.queue.list("local")).toEqual([]);
    expect(f.queue.list("remote")).toHaveLength(1);
    f.emit("turn/completed", "one", "new-turn");
    expect(f.first().turnId).toBe("new-turn");
    f.emit("turn/completed");
    expect(f.first().turnId).toBe("new-turn");
    f.emit("thread/archived");
    f.emit("turn/completed", "one", "new-turn");
    expect(f.queue.list("local")).toEqual([]);
    f.emit("turn/started", "one", "third-turn");
    f.emit("turn/completed", "one", "third-turn");
    expect(f.first().turnId).toBe("third-turn");
  });

  it("ignores ephemeral and external threads and successful completions", async () => {
    const f = fixture();
    f.managers.get("local")?.emit("thread/started", { thread: { id: "one", ephemeral: true } });
    f.emit("turn/completed");
    f.emit("turn/completed", "success", "success-turn", "completed");
    expect(f.queue.list("local")).toEqual([]);
    expect(f.projection).not.toHaveBeenCalled();
    f.projection.mockResolvedValueOnce({
      thread: { ...metadata("external").thread, modelProvider: "codexhost" },
    });
    f.emit("turn/completed", "external");
    await settle();
    expect(f.queue.list("local")).toEqual([]);
  });

  it("does not restore an entry when metadata arrives after a new turn or a retired connection", async () => {
    const f = fixture();
    const response = deferred<unknown>();
    f.projection.mockReturnValueOnce(response.promise);
    f.emit("turn/completed");
    f.emit("turn/started", "one", "new-turn");
    response.resolve(metadata("one"));
    await settle();
    expect(f.queue.list("local")).toEqual([]);
    const old = f.managers.get("local");
    f.managers.set("local", manager());
    old?.emit("turn/completed", {
      threadId: "stale",
      turn: { id: "stale-turn", status: "failed" },
    });
    expect(f.queue.list("local")).toEqual([]);
    f.queue.refresh();
    expect(old?.callbacks.size).toBe(0);
  });

  it("shares the action lock, resumes once and does not requeue a duplicate failed event", async () => {
    const f = fixture();
    f.emit("turn/completed");
    await settle();
    const entry = f.first();
    const response = deferred<undefined>();
    f.client.buddyContinue.mockReturnValueOnce(response.promise);
    const action = f.queue.resume(entry, "chosen-model");
    await settle();
    await expect(f.queue.archive(entry)).rejects.toThrow("正在处理中");
    expect(f.client.buddyContinue).toHaveBeenCalledWith("one", "one-turn", "chosen-model");
    response.resolve(undefined);
    await action;
    f.emit("turn/completed");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("archives via the same Host and removes only after success", async () => {
    const f = fixture();
    f.emit("turn/completed");
    await settle();
    const entry = f.first();
    const archive = deferred<unknown>();
    f.projection.mockImplementation(async (method, params) =>
      method === "thread/archive"
        ? archive.promise
        : metadata((params as { threadId: string }).threadId),
    );
    const action = f.queue.archive(entry);
    await settle();
    expect(f.queue.list("local")).toHaveLength(1);
    expect(f.projection).toHaveBeenCalledWith("thread/archive", { threadId: "one" });
    archive.resolve({});
    await action;
    expect(f.queue.list("local")).toEqual([]);
    expect(f.client.buddyContinue).not.toHaveBeenCalled();
    expect(fixture(f.storage).queue.list("local")).toEqual([]);
  });

  it("keeps failed archives queued for retry", async () => {
    const f = fixture();
    f.emit("turn/completed");
    await settle();
    f.projection.mockImplementation(async (method, params) => {
      if (method === "thread/archive") throw new Error("offline");
      return metadata((params as { threadId: string }).threadId);
    });
    await expect(f.queue.archive(f.first())).rejects.toThrow("offline");
    expect(f.queue.list("local")).toHaveLength(1);
    expect(f.queue.isPending(f.first())).toBe(false);
  });

  it("never archives a running, newer or external thread", async () => {
    const f = fixture();
    f.emit("turn/completed");
    await settle();
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: true,
      turnId: "new-turn",
      status: "failed",
    });
    await expect(f.queue.archive(f.first())).rejects.toThrow("已运行");
    expect(f.queue.list("local")).toEqual([]);
    expect(f.projection.mock.calls.some(([method]) => method === "thread/archive")).toBe(false);
    f.emit("turn/completed", "external");
    await settle();
    f.projection.mockResolvedValueOnce({
      thread: { ...metadata("external").thread, modelProvider: "codexhost" },
    });
    await expect(f.queue.archive(f.first())).rejects.toThrow("ownership");
    expect(f.projection.mock.calls.some(([method]) => method === "thread/archive")).toBe(false);
  });

  it("stops an action before archive if its connection changes during verification", async () => {
    const f = fixture();
    f.emit("turn/completed");
    await settle();
    const response = deferred<unknown>();
    f.projection.mockReturnValueOnce(response.promise);
    const action = f.queue.archive(f.first());
    f.clients.delete("local");
    response.resolve(metadata("one"));
    await expect(action).rejects.toThrow("连接");
    expect(f.projection.mock.calls.some(([method]) => method === "thread/archive")).toBe(false);
  });

  it.each(["no rollout found for thread id one", "thread not loaded: one", "Thread not found"])(
    "drops an entry whose Thread is gone from the Host (%s)",
    async (reason) => {
      const f = fixture();
      f.projection.mockRejectedValueOnce(
        Object.assign(new Error(reason), { code: -32600, data: { threadId: "one" } }),
      );
      f.emit("turn/completed");
      await settle();
      expect(f.queue.list("local")).toEqual([]);
      expect(f.queue.problem("local")).toContain("已不存在");
      // 墓碑持久化，重启和补录都不会把它重新入队。
      f.client.buddyInterrupted.mockResolvedValueOnce({
        threads: [
          {
            threadId: "one",
            turnId: "one-turn",
            title: "one",
            owner: "codex",
            status: "interrupted",
          },
        ],
        runningThreadIds: [],
        unreadable: 0,
      });
      await f.queue.importHistory("local");
      expect(f.queue.list("local")).toEqual([]);
      const restored = fixture(f.storage);
      expect(restored.queue.list("local")).toEqual([]);
    },
  );

  it.each(["resume", "archive"] as const)(
    "removes a queued entry when %s finds the Thread already gone",
    async (action) => {
      const f = fixture();
      f.emit("turn/completed");
      await settle();
      f.projection.mockRejectedValueOnce(
        Object.assign(new Error("no rollout found for thread id one"), { code: -32600 }),
      );
      await expect(f.queue[action](f.first())).rejects.toThrow("已不存在");
      expect(f.queue.list("local")).toEqual([]);
      expect(f.projection.mock.calls.some(([method]) => method === "thread/archive")).toBe(false);
      expect(f.client.buddyContinue).not.toHaveBeenCalled();
    },
  );

  it("keeps the entry and allows retry when a read is merely unavailable", async () => {
    const f = fixture();
    f.emit("turn/completed");
    await settle();
    f.projection.mockRejectedValueOnce(new Error("502 bad gateway"));
    await expect(f.queue.archive(f.first())).rejects.toThrow("502");
    expect(f.queue.list("local")).toHaveLength(1);
    await f.queue.archive(f.first());
    expect(f.queue.list("local")).toEqual([]);
  });

  it("retains events when enrichment fails and exposes persistence failures", async () => {
    const f = fixture();
    f.projection.mockRejectedValueOnce(new Error("offline"));
    f.emit("turn/completed");
    await settle();
    expect(f.queue.list("local")).toHaveLength(1);
    expect(f.queue.problem("local")).toContain("offline");
    f.storage.setItem = () => {
      throw new Error("quota");
    };
    f.emit("turn/completed", "second");
    expect(f.queue.problem("local")).toContain("quota");
  });

  it("merges cross-window records and tombstones without restoring handled entries", async () => {
    const a = fixture();
    const b = fixture(a.storage);
    a.emit("turn/completed");
    await settle();
    b.queue.syncStorage();
    expect(b.queue.list("local")).toHaveLength(1);
    await b.queue.archive(b.first());
    a.queue.syncStorage();
    expect(a.queue.list("local")).toEqual([]);
    expect(JSON.parse(a.storage.getItem(INTERRUPTED_QUEUE_STORAGE_KEY) ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "archived" })]),
    );
  });
  it("imports history only explicitly and keeps event changes and archived tombstones", async () => {
    const f = fixture();
    const response = deferred<BuddyInterrupted>();
    f.client.buddyInterrupted.mockReturnValueOnce(response.promise);
    const imported = f.queue.importHistory("local");
    f.emit("turn/completed", "one", "newer-turn");
    f.emit("thread/archived", "archived");
    const historical = (threadId: string) => ({
      threadId,
      turnId: `${threadId}-turn`,
      title: threadId,
      status: "failed" as const,
      owner: "codex" as const,
    });
    response.resolve({
      threads: [
        historical("one"),
        historical("archived"),
        historical("old"),
        historical("running"),
      ],
      runningThreadIds: ["running"],
      unreadable: 2,
    });
    expect(await imported).toBe(2);
    expect(f.queue.list("local").map(({ threadId, turnId }) => [threadId, turnId])).toEqual(
      expect.arrayContaining([
        ["one", "newer-turn"],
        ["old", "old-turn"],
      ]),
    );
    expect(f.queue.list("local")).toHaveLength(2);
    f.client.buddyInterrupted.mockResolvedValueOnce({
      threads: [historical("archived")],
      runningThreadIds: [],
      unreadable: 0,
    });
    await f.queue.importHistory("local");
    expect(f.queue.list("local")).toHaveLength(2);
    expect(f.client.buddyInterrupted).toHaveBeenCalledTimes(2);
  });

  it("does not import a stale response over a cross-window archive", async () => {
    const a = fixture();
    const b = fixture(a.storage);
    const response = deferred<BuddyInterrupted>();
    a.client.buddyInterrupted.mockReturnValueOnce(response.promise);
    const imported = a.queue.importHistory("local");
    b.emit("thread/archived", "one");
    response.resolve({
      threads: [
        { threadId: "one", turnId: "one-turn", title: "one", owner: "codex", status: "failed" },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    await imported;
    expect(a.queue.list("local")).toEqual([]);
  });

  it("imports an active turn after restart when its terminal notification was missed", async () => {
    const previous = fixture();
    previous.emit("turn/started", "one", "one-turn", "inProgress", "remote");
    previous.queue.dispose();
    const restarted = fixture(previous.storage);
    const history: BuddyInterrupted = {
      threads: [
        {
          threadId: "one",
          turnId: "one-turn",
          title: "one",
          owner: "codex",
          status: "interrupted",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    };
    restarted.client.buddyInterrupted.mockResolvedValueOnce({
      ...history,
      runningThreadIds: ["one"],
    });
    await restarted.queue.importHistory("remote");
    expect(restarted.queue.list("remote")).toEqual([]);

    restarted.client.buddyInterrupted.mockResolvedValueOnce(history);
    await restarted.queue.importHistory("remote");
    expect(restarted.queue.list("remote")).toEqual([
      expect.objectContaining({
        hostId: "remote",
        threadId: "one",
        turnId: "one-turn",
        status: "interrupted",
      }),
    ]);
    expect(restarted.queue.list("local")).toEqual([]);
  });

  it("does not import an older active turn if a new turn starts during history discovery", async () => {
    const f = fixture();
    f.emit("turn/started", "one", "one-turn", "inProgress");
    const response = deferred<BuddyInterrupted>();
    f.client.buddyInterrupted.mockReturnValueOnce(response.promise);
    const imported = f.queue.importHistory("local");
    f.emit("turn/started", "one", "next-turn", "inProgress");
    response.resolve({
      threads: [
        {
          threadId: "one",
          turnId: "one-turn",
          title: "one",
          owner: "codex",
          status: "interrupted",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    await imported;
    expect(f.queue.list("local")).toEqual([]);
    f.emit("turn/completed", "one", "next-turn");
    expect(f.first().turnId).toBe("next-turn");
  });

  it("reports subscription failure without aborting other Hosts and retries on rebinding", () => {
    const f = fixture();
    const replacement = manager();
    replacement.addNotificationCallback.mockImplementationOnce(() => {
      throw new Error("disconnected");
    });
    f.managers.set("local", replacement);
    expect(() => f.queue.refresh()).not.toThrow();
    expect(f.queue.problem("local")).toContain("disconnected");
    f.emit("turn/completed", "remote", "remote-turn", "failed", "remote");
    expect(f.queue.list("remote")).toHaveLength(1);
    f.queue.refresh();
    f.emit("turn/completed");
    expect(f.queue.list("local")).toHaveLength(1);
    expect(f.queue.problem("local")).toBe("");
  });
});
