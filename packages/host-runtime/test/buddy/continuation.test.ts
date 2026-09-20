import { describe, expect, it, vi } from "vitest";
import { InterruptedConversations } from "../../src/buddy/continuation.js";
import type { NativeRequest } from "../../src/buddy/planner.js";

function fixture() {
  let status = "failed";
  let active = false;
  let allowed = true;
  const request = vi.fn<NativeRequest>(async (method) => {
    if (method === "thread/list") return { result: { data: [{ id: "thread" }] } };
    if (method === "thread/read")
      return {
        result: {
          thread: {
            name: "Network failure",
            status: { type: "idle" },
            turns: [{ id: "turn", status }],
          },
        },
      };
    if (method === "turn/start") {
      status = "inProgress";
      return { result: { turn: { id: "continued" } } };
    }
    return { result: {} };
  });
  const service = new InterruptedConversations(
    request,
    () => active,
    async () => allowed,
  );
  return {
    service,
    request,
    status: (value: string) => {
      status = value;
    },
    active: () => {
      active = true;
    },
    private: () => {
      allowed = false;
    },
  };
}

describe("interrupted conversations", () => {
  it("does not send after recovery was cancelled during a history read", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.request.mockImplementation(async () => {
      controller.abort();
      return { result: { thread: { turns: [{ id: "turn", status: "failed" }] } } };
    });
    await expect(
      f.service.continue("thread", "turn", { model: "cheap", signal: controller.signal }),
    ).rejects.toThrow();
    expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  });
  it("discovers persisted failed turns and continues without replaying original input or overriding configuration", async () => {
    const f = fixture();
    expect((await f.service.list()).threads).toEqual([
      { threadId: "thread", turnId: "turn", title: "Network failure", status: "failed" },
    ]);
    await f.service.continue("thread", "turn");
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      "thread/list",
      "thread/read",
      "thread/read",
      "thread/resume",
      "thread/read",
      "turn/start",
    ]);
    expect(f.request.mock.calls.at(-1)?.[1]).toEqual({
      threadId: "thread",
      input: [{ type: "text", text: expect.stringContaining("不要盲目重放") }],
    });
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("状态已改变");
  });
  it.each(["completed", "inProgress"])("excludes and rejects %s", async (status) => {
    const f = fixture();
    f.status(status);
    expect((await f.service.list()).threads).toEqual([]);
    await expect(f.service.continue("thread", "turn")).rejects.toThrow();
    expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  });
  it("rejects active, stale and private requests", async () => {
    const f = fixture();
    await expect(f.service.continue("thread", "old")).rejects.toThrow("状态已改变");
    f.active();
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("仍在运行");
    f.private();
    await expect(f.service.list()).rejects.toThrow("隐私");
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("隐私");
  });
  it("serializes duplicate clicks", async () => {
    const f = fixture();
    const first = f.service.continue("thread", "turn");
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("重复点击");
    await first;
    expect(f.request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  });
  it("reports unreadable histories without claiming no interruptions", async () => {
    const f = fixture();
    f.request.mockImplementation(async (method) =>
      method === "thread/list"
        ? { result: { data: [{ id: "broken" }] } }
        : { error: { message: "missing source rollout" } },
    );
    expect(await f.service.list()).toEqual({ threads: [], unreadable: 1 });
    await expect(f.service.continue("broken", "turn")).rejects.toThrow("missing source rollout");
  });
});
