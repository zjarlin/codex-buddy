import { describe, expect, it } from "vitest";

import {
  PENDING_CONFIRMATIONS_LIMIT,
  PENDING_CONFIRMATIONS_STORAGE_KEY,
  PendingConfirmationsModel,
  isMetadataTitleTurn,
  pendingConfirmationStatus,
  pendingConfirmationSummary,
  type PendingConfirmationStore,
} from "../src/pending-confirmations-state.js";

function memoryStorage(initial?: string): PendingConfirmationStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) {
      return key === PENDING_CONFIRMATIONS_STORAGE_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === PENDING_CONFIRMATIONS_STORAGE_KEY) this.value = value;
    },
  };
}

describe("pending confirmation state", () => {
  it("normalizes terminal statuses and extracts the final agent text", () => {
    expect(pendingConfirmationStatus("succeeded")).toBe("completed");
    expect(pendingConfirmationStatus("cancelled")).toBe("interrupted");
    expect(pendingConfirmationStatus("inProgress")).toBeNull();
    expect(
      pendingConfirmationSummary({
        status: "completed",
        items: [
          { type: "agentMessage", text: "first" },
          { type: "agentMessage", text: "  final result  " },
        ],
      }),
    ).toBe("final result");
  });

  it("uses the native error when a failed Turn has no agent message", () => {
    expect(
      pendingConfirmationSummary({
        status: "failed",
        error: { code: "nativeFailure", message: "upstream unavailable" },
        items: [],
      }),
    ).toBe("upstream unavailable");
  });

  it("keeps terminal turns and ignores background task turns", () => {
    const model = new PendingConfirmationsModel(memoryStorage(), () => 100);
    expect(
      model.upsert({
        hostId: "local",
        threadId: "thread-a",
        title: "Task A",
        turnId: "turn-a",
        status: "completed",
        items: [{ type: "agentMessage", text: "done" }],
      }),
    ).toMatchObject({ status: "completed", summary: "done", completedAt: 100 });
    expect(
      model.upsert({
        hostId: "local",
        threadId: "thread-b",
        title: "Task B",
        turnId: "running",
        status: "inProgress",
      }),
    ).toBeNull();
    expect(model.pending()).toHaveLength(1);
  });

  it("deduplicates the same terminal turn and replaces an older pending turn", () => {
    let now = 100;
    const model = new PendingConfirmationsModel(memoryStorage(), () => now);
    model.upsert({
      hostId: "local",
      threadId: "thread-a",
      title: "Task A",
      turnId: "turn-a",
      status: "completed",
      items: [{ type: "agentMessage", text: "first result" }],
    });
    model.upsert({
      hostId: "local",
      threadId: "thread-a",
      title: "Task A",
      turnId: "turn-a",
      status: "completed",
      items: [{ type: "agentMessage", text: "duplicate result" }],
    });
    expect(model.latestPending()?.summary).toBe("first result");

    now = 200;
    model.startTurn("local", "thread-a", "turn-b");
    model.upsert({
      hostId: "local",
      threadId: "thread-a",
      title: "Task A",
      turnId: "turn-b",
      status: "failed",
      error: { message: "new failure" },
    });
    expect(model.pending()).toHaveLength(1);
    expect(model.latestPending()).toMatchObject({ turnId: "turn-b", status: "failed" });
  });

  it("persists confirmation for reconciliation and handles restart", () => {
    const storage = memoryStorage();
    const model = new PendingConfirmationsModel(storage, () => 100);
    const entry = model.upsert({
      hostId: "remote",
      threadId: "thread-r",
      title: "Remote",
      turnId: "turn-r",
      status: "completed",
      items: [{ type: "agentMessage", text: "done" }],
    })!;
    expect(model.confirm(entry)).toBe(true);
    expect(model.pending()).toEqual([]);

    const restored = new PendingConfirmationsModel(storage, () => 200);
    expect(restored.entries()).toEqual([
      expect.objectContaining({ hostId: "remote", threadId: "thread-r", state: "confirmed" }),
    ]);
    expect(restored.hasPending("remote", "thread-r")).toBe(false);
  });

  it("does not revive a confirmed Turn after a duplicate completion notification", () => {
    const model = new PendingConfirmationsModel(memoryStorage(), () => 100);
    const entry = model.upsert({
      hostId: "local",
      threadId: "thread-a",
      title: "Task A",
      turnId: "turn-a",
      status: "completed",
      items: [{ type: "agentMessage", text: "done" }],
    })!;
    expect(model.confirm(entry)).toBe(true);
    expect(
      model.upsert({
        hostId: "local",
        threadId: "thread-a",
        title: "Task A",
        turnId: "turn-a",
        status: "completed",
        items: [{ type: "agentMessage", text: "duplicate" }],
      }),
    ).toMatchObject({ state: "confirmed" });
    expect(model.pending()).toEqual([]);
  });

  it("isolates Hosts and keeps the newest 200 records", () => {
    const model = new PendingConfirmationsModel(memoryStorage(), () => 1);
    for (let index = 0; index < PENDING_CONFIRMATIONS_LIMIT + 20; index += 1) {
      model.upsert({
        hostId: index % 2 ? "remote" : "local",
        threadId: `thread-${index}`,
        title: `Task ${index}`,
        turnId: `turn-${index}`,
        status: "completed",
        completedAt: 10_000 + index,
        items: [{ type: "agentMessage", text: `result ${index}` }],
      });
    }
    expect(model.entries()).toHaveLength(PENDING_CONFIRMATIONS_LIMIT);
    expect(model.hasPending("local", "thread-0")).toBe(false);
    expect(model.hasPending("remote", "thread-1")).toBe(false);
    expect(model.pending().every((entry) => entry.state === "pending")).toBe(true);
  });

  it("migrates a provisional Host identity without mixing Threads", () => {
    const model = new PendingConfirmationsModel(memoryStorage(), () => 1);
    model.upsert({
      hostId: "unresolved",
      threadId: "thread-a",
      title: "A",
      turnId: "turn-a",
      status: "completed",
    });
    expect(model.merge("unresolved", "local", "thread-a")).toBe(true);
    expect(model.hasPending("local", "thread-a")).toBe(true);
    expect(model.hasPending("unresolved", "thread-a")).toBe(false);
  });

  it("ignores corrupt storage and unknown versions", () => {
    expect(new PendingConfirmationsModel(memoryStorage("{bad")).entries()).toEqual([]);
    expect(
      new PendingConfirmationsModel(memoryStorage(JSON.stringify({ version: 2, entries: [] }))).entries(),
    ).toEqual([]);
  });

  it("recognizes a thread title generation Turn from its JSON payload", () => {
    expect(
      isMetadataTitleTurn({
        items: [
          { type: "userMessage", content: [{ type: "text", text: "hi" }] },
          {
            type: "agentMessage",
            text: '{"title":"修复无运行项目时态势异常","description":"排查并修复"}',
          },
        ],
      }),
    ).toBe(true);
    expect(
      isMetadataTitleTurn({
        items: [{ type: "agentMessage", text: '```json\n{"title":"T"}\n```' }],
      }),
    ).toBe(true);
  });

  it("does not treat ordinary results as thread title generation", () => {
    expect(
      isMetadataTitleTurn({
        items: [{ type: "agentMessage", text: "{\"title\":\"T\",\"extra\":1}" }],
      }),
    ).toBe(false);
    expect(
      isMetadataTitleTurn({ items: [{ type: "agentMessage", text: "plain result" }] }),
    ).toBe(false);
    expect(isMetadataTitleTurn({ items: [] })).toBe(false);
    expect(
      isMetadataTitleTurn({
        items: [{ type: "agentMessage", text: '{"title":"","description":"d"}' }],
      }),
    ).toBe(false);
  });

  it("keeps title generation Turns out of the pending queue", () => {
    const model = new PendingConfirmationsModel(memoryStorage(), () => 100);
    expect(
      model.upsert({
        hostId: "local",
        threadId: "thread-a",
        title: "未命名会话",
        turnId: "title-turn",
        status: "completed",
        items: [{ type: "agentMessage", text: '{"title":"命名","description":"d"}' }],
      }),
    ).toBeNull();
    expect(model.pending()).toEqual([]);
  });
});
