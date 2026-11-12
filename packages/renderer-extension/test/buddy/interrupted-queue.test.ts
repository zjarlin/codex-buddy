import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RendererModelClient,
  RendererThreadTurnState,
} from "../../src/renderer-model-client.js";
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
    readThreadTurnState: vi.fn(async (id: string): Promise<RendererThreadTurnState> => ({
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
    error?: unknown,
  ) => {
    const target = managers.get(host);
    if (!target) throw new Error("Missing manager");
    target.emit(method, {
      threadId: id,
      turn: { id: turnId, status, ...(error ? { error } : {}) },
    });
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

  it("reconciles the viewed session when its terminal notification was missed", async () => {
    const f = fixture();
    await f.queue.reconcile("local", "one");
    expect(f.first()).toMatchObject({
      threadId: "one",
      turnId: "one-turn",
      title: "Title one",
      status: "failed",
    });
    // 30 秒内重复打开同一会话不重复读取；队列已有该回合时直接命中缓存。
    await f.queue.reconcile("local", "one");
    expect(f.client.readThreadTurnState).toHaveBeenCalledTimes(1);
    f.client.readThreadTurnState.mockClear();
    f.queue.syncStorage();
    await f.queue.reconcile("local", "one");
    expect(f.client.readThreadTurnState).not.toHaveBeenCalled();
  });

  it("honours the caller's reconcile interval for background sidebar polling", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.queue.reconcile("local", "one", { intervalMs: 180_000 });
    expect(f.client.readThreadTurnState).toHaveBeenCalledTimes(1);
    // 未到后台间隔时，轮询重扫不会重复读取。
    vi.advanceTimersByTime(179_000);
    await f.queue.reconcile("local", "one", { intervalMs: 180_000 });
    expect(f.client.readThreadTurnState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await f.queue.reconcile("local", "one", { intervalMs: 180_000 });
    expect(f.client.readThreadTurnState).toHaveBeenCalledTimes(2);
  });

  it("does not reconcile running, completed, external or superseded turns", async () => {
    const f = fixture();
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: true,
      status: null,
      turnId: null,
    });
    await f.queue.reconcile("local", "running");
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "done-turn",
    });
    await f.queue.reconcile("local", "done");
    f.projection.mockResolvedValueOnce({
      thread: { ...metadata("external").thread, modelProvider: "codexhost" },
    });
    await f.queue.reconcile("local", "external");
    f.emit("turn/started", "fresh", "new-turn");
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: "failed",
      turnId: "fresh-turn",
    });
    await f.queue.reconcile("local", "fresh");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("does not resurrect a turn that was already started or settled", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    f.emit("turn/completed", "one", "second-turn", "failed");
    await settle();
    expect(f.first().turnId).toBe("second-turn");
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: "failed",
      turnId: "second-turn",
    });
    await f.queue.resume(f.first());
    vi.advanceTimersByTime(31_000);
    f.client.readThreadTurnState.mockClear();
    await f.queue.reconcile("local", "one");
    expect(f.client.readThreadTurnState).toHaveBeenCalledTimes(1);
    expect(f.queue.list("local")).toEqual([]);
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

  it("resumes a Laya-classified ambiguous entry whose native status is not mapped", async () => {
    const f = fixture();
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
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "one-turn",
      turnStatus: "unknown",
    });
    await f.queue.resume(f.first());
    expect(f.client.buddyContinue).toHaveBeenCalledWith("one", "one-turn");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("resumes a Laya-classified entry whose native turn is still marked completed", async () => {
    const f = fixture();
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
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "one-turn",
      turnStatus: "completed",
    });
    await f.queue.resume(f.first());
    expect(f.client.buddyContinue).toHaveBeenCalledWith("one", "one-turn");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("drops an entry once the native turn really moved on", async () => {
    const f = fixture();
    f.emit("turn/completed");
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "newer-turn",
      turnStatus: "completed",
    });
    await expect(f.queue.resume(f.first())).rejects.toThrow("已运行或最新回合已改变");
    expect(f.queue.list("local")).toEqual([]);
    expect(f.client.buddyContinue).not.toHaveBeenCalled();
  });

  it("adds a completed turn that Host classifies as interrupted when the session is opened", async () => {
    const f = fixture();
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "one-turn",
      turnStatus: "completed",
    });
    f.client.buddyInterrupted.mockResolvedValueOnce({
      threads: [
        {
          threadId: "one",
          turnId: "one-turn",
          title: "Title one",
          owner: "codex",
          status: "interrupted",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    await f.queue.reconcile("local", "one");
    expect(f.client.buddyInterrupted).toHaveBeenCalledWith("one");
    expect(f.first()).toMatchObject({ threadId: "one", turnId: "one-turn", status: "interrupted" });
  });

  it("leaves a completed turn out of the queue when Host finds no interruption", async () => {
    const f = fixture();
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "one-turn",
      turnStatus: "completed",
    });
    await f.queue.reconcile("local", "one");
    expect(f.client.buddyInterrupted).toHaveBeenCalledWith("one");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("clears a queued interruption when the viewed session is running again", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    expect(f.first().status).toBe("failed");
    vi.advanceTimersByTime(31_000);
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: true,
      status: null,
      turnId: null,
      turnStatus: null,
    });
    await f.queue.reconcile("local", "one");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("clears a queued interruption after the session moved on to a newer turn", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    vi.advanceTimersByTime(31_000);
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: null,
      turnId: "later-turn",
      turnStatus: "completed",
    });
    await f.queue.reconcile("local", "one");
    expect(f.client.buddyInterrupted).toHaveBeenCalledWith("one");
    expect(f.queue.list("local")).toEqual([]);
  });

  it("keeps the automatic budget across the turns created by continuation", async () => {
    const f = fixture();
    let latest = "one-turn";
    f.client.readThreadTurnState.mockImplementation(async () => ({
      running: false,
      status: "failed" as const,
      turnId: latest,
      turnStatus: "failed",
    }));
    f.emit("turn/completed", "one", latest, "failed");
    await settle();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await f.queue.resume(f.first(), undefined, { auto: true });
      latest = `continued-${attempt}`;
      // 续接提交本身会创建新回合；预算必须跟着会话继续累计。
      f.emit("turn/started", "one", latest);
      f.emit("turn/completed", "one", latest, "failed");
      await settle();
      expect(f.first()).toMatchObject({ turnId: latest, autoResumeAttempts: attempt });
    }
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("上限");
    // 手动恢复不计入自动预算。
    await f.queue.resume(f.first());
    expect(f.client.buddyContinue).toHaveBeenCalledTimes(4);
  });

  it("keeps the automatic budget exhausted until a turn completes normally", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let latest = "one-turn";
    let status: "failed" | "completed" = "failed";
    f.client.readThreadTurnState.mockImplementation(async () => ({
      running: false,
      status,
      turnId: latest,
      turnStatus: status,
    }));
    f.emit("turn/completed", "one", latest, "failed");
    await settle();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await f.queue.resume(f.first(), undefined, { auto: true });
      latest = `continued-${attempt}`;
      f.emit("turn/started", "one", latest);
      f.emit("turn/completed", "one", latest, "failed");
      await settle();
    }
    // 等待不会让确定性失败变成可重放的历史。
    vi.advanceTimersByTime(24 * 60 * 60_000);
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("上限");

    // 回合正常完成才重新开始计数：之后的另一次中断仍能得到自动尝试。
    latest = "finished-turn";
    status = "completed";
    f.emit("turn/started", "one", latest);
    f.emit("turn/completed", "one", latest, "completed");
    await settle();
    expect(f.queue.list("local")).toEqual([]);
    latest = "later-turn";
    status = "failed";
    f.emit("turn/completed", "one", latest, "failed");
    await settle();
    expect(f.first().turnId).toBe(latest);
    expect(f.first().autoResumeAttempts ?? 0).toBe(0);
  });

  it("marks an already queued turn when reconcile reads an undecryptable history error", async () => {
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    expect(f.first().autoResumeBlocked).toBeUndefined();
    // 升级前入队的记录没有错误文本；打开会话核对时用原生错误补上阻断。
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: "failed",
      turnId: "one-turn",
      turnStatus: "failed",
      turnError: "upstream could not be decrypted or parsed",
    });
    await f.queue.reconcile("local", "one");
    expect(f.first().autoResumeBlocked).toBe("undecryptable-history");
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("无法解密");
    expect(f.client.buddyContinue).not.toHaveBeenCalled();
  });

  it("stops automatic resume when the failed turn's history cannot be decrypted", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed", "local", {
      message:
        "stream disconnected before completion: Encrypted function output content could not be decrypted or decoded.",
    });
    await settle();
    expect(f.first().autoResumeBlocked).toBe("undecryptable-history");
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("无法解密");
    // 时间不会解除阻断：同一段历史重放多少次都还是同一个错误。
    vi.advanceTimersByTime(24 * 60 * 60_000);
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("无法解密");
    // 手动入口不受阻断限制：用户可能已经压缩过历史，是否可读由这次请求自己回答。
    f.client.buddyContinue.mockRejectedValueOnce(new Error("gateway down"));
    await expect(f.queue.resume(f.first())).rejects.toThrow("gateway down");
    expect(f.client.buddyContinue).toHaveBeenCalledTimes(1);
    expect(f.first().autoResumeBlocked).toBe("undecryptable-history");
  });

  it("blocks automatic resume when the freshly read turn says its history cannot be decrypted", async () => {
    const f = fixture();
    // 补录的条目可能只有回合 ID：提交前读到的错误文本同样要能阻止自动重放。
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: "failed",
      turnId: "one-turn",
      turnStatus: "failed",
      turnError: "encrypted reasoning content belongs to another upstream account",
    });
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    expect(f.first().autoResumeBlocked).toBeUndefined();
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("无法解密");
    expect(f.client.buddyContinue).not.toHaveBeenCalled();
    expect(f.first().autoResumeBlocked).toBe("undecryptable-history");
    // 手动入口不受影响，也不解除阻断：用户可能先压缩历史，是否可读由这次请求回答。
    f.client.buddyContinue.mockRejectedValueOnce(new Error("gateway down"));
    await expect(f.queue.resume(f.first())).rejects.toThrow("gateway down");
    expect(f.client.buddyContinue).toHaveBeenCalledTimes(1);
    expect(f.first().autoResumeBlocked).toBe("undecryptable-history");
  });

  it("records undecryptable history reported by the continuation request itself", async () => {
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    f.client.buddyContinue.mockRejectedValueOnce(
      new Error(
        "stream disconnected before completion: Encrypted function output content could not be decrypted or decoded.",
      ),
    );
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("无法解密");
    expect(f.first().autoResumeBlocked).toBe("undecryptable-history");
    // 阻断后的第二次自动续接不再发出请求。
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("无法解密");
    expect(f.client.buddyContinue).toHaveBeenCalledTimes(1);
  });

  it("counts automatic resume attempts and keeps manual recovery available", async () => {
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    f.client.buddyContinue.mockRejectedValue(new Error("gateway down"));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow(
        "gateway down",
      );
      expect(f.first().autoResumeAttempts).toBe(attempt);
    }
    await expect(f.queue.resume(f.first(), undefined, { auto: true })).rejects.toThrow("上限");
    expect(f.first().autoResumeAttempts).toBe(3);
    await expect(f.queue.resume(f.first())).rejects.toThrow("gateway down");
    expect(f.first().autoResumeAttempts).toBe(3);
  });

  it("discovers interruptions of sessions the sidebar never rendered", async () => {
    const f = fixture();
    f.client.buddyInterrupted.mockResolvedValueOnce({
      threads: [
        {
          threadId: "unrendered",
          turnId: "unrendered-turn",
          title: "未渲染的会话",
          owner: "codex",
          status: "interrupted",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    await f.queue.discover("local");
    expect(f.queue.list("local")).toEqual([
      expect.objectContaining({ threadId: "unrendered", turnId: "unrendered-turn" }),
    ]);
  });

  it("rate limits background discovery per Host and retries sooner after a failure", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const interrupted = (turnId: string): BuddyInterrupted => ({
      threads: [{ threadId: "one", turnId, title: "one", owner: "codex", status: "interrupted" }],
      runningThreadIds: [],
      unreadable: 0,
    });
    await f.queue.discover("local");
    await f.queue.discover("local");
    expect(f.client.buddyInterrupted).toHaveBeenCalledTimes(1);

    // 失败只在较短的退避后重试，而不是等满一个完整周期。
    f.client.buddyInterrupted.mockRejectedValueOnce(new Error("host offline"));
    vi.advanceTimersByTime(121_000);
    await f.queue.discover("local");
    expect(f.client.buddyInterrupted).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(31_000);
    f.client.buddyInterrupted.mockResolvedValueOnce(interrupted("one-turn"));
    await f.queue.discover("local");
    expect(f.client.buddyInterrupted).toHaveBeenCalledTimes(3);
    expect(f.queue.list("local")).toHaveLength(1);

    // 未到间隔时既不重复扫描，也不阻塞下一个 Host。
    await f.queue.discover("local");
    expect(f.client.buddyInterrupted).toHaveBeenCalledTimes(3);
    await f.queue.discover("remote");
    expect(f.client.buddyInterrupted).toHaveBeenCalledTimes(4);
  });

  it("keeps a queued interruption while the same native turn is still stopped", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.emit("turn/completed", "one", "one-turn", "failed");
    await settle();
    vi.advanceTimersByTime(31_000);
    f.client.readThreadTurnState.mockResolvedValueOnce({
      running: false,
      status: "failed",
      turnId: "one-turn",
      turnStatus: "failed",
    });
    await f.queue.reconcile("local", "one");
    expect(f.client.readThreadTurnState).toHaveBeenCalledTimes(1);
    expect(f.first()).toMatchObject({ turnId: "one-turn", status: "failed" });
  });
});
