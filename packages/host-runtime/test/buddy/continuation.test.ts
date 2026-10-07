import { describe, expect, it, vi } from "vitest";
import { InterruptedConversations } from "../../src/buddy/continuation.js";
import type { NativeRequest } from "../../src/buddy/native.js";

function fixture() {
  let status = "failed";
  let threadStatus: string | null = "idle";
  let active = false;
  let allowed = true;
  const request = vi.fn<NativeRequest>(async (method) => {
    if (method === "thread/list") return { result: { data: [{ id: "thread" }] } };
    if (method === "thread/read")
      return {
        result: {
          thread: {
            name: "Network failure",
            status: threadStatus === null ? null : { type: threadStatus },
            turns: [{ id: "turn", status }],
          },
        },
      };
    if (method === "turn/start") {
      status = "inProgress";
      threadStatus = "active";
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
    threadStatus: (value: string | null) => {
      threadStatus = value;
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
  it("scans every official page so older failed turns are not hidden", async () => {
    const request = vi.fn<NativeRequest>(async (method, params) => {
      if (method === "thread/list") {
        return params.cursor
          ? { result: { data: [{ id: "older-failed" }], nextCursor: null } }
          : {
              result: {
                data: Array.from({ length: 100 }, (_, index) => ({ id: `complete-${index}` })),
                nextCursor: "page-2",
              },
            };
      }
      if (method === "thread/read") {
        const threadId = String(params.threadId);
        return {
          result: {
            thread: {
              name: threadId,
              status: { type: "idle" },
              turns: [
                threadId === "older-failed"
                  ? { id: "old-turn", status: "failed" }
                  : { id: "done", status: "completed" },
              ],
            },
          },
        };
      }
      return { result: {} };
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );

    await expect(service.list()).resolves.toEqual({
      threads: [
        {
          threadId: "older-failed",
          turnId: "old-turn",
          title: "older-failed",
          status: "failed",
          owner: "codex",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    expect(request).toHaveBeenCalledWith(
      "thread/list",
      expect.objectContaining({ cursor: "page-2", limit: 100 }),
    );
  });

  it("rejects a repeated official cursor instead of reporting a partial scan", async () => {
    const request = vi.fn<NativeRequest>(async () => ({
      result: { data: [{ id: "thread" }], nextCursor: "same" },
    }));
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );

    await expect(service.list()).rejects.toThrow("repeated cursor");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("archives only completed Threads in the current project", async () => {
    const request = vi.fn<NativeRequest>(async (method, params) => {
      if (method === "thread/read") {
        const threadId = String(params.threadId);
        const turns: Record<string, string> = {
          target: "completed",
          done: "completed",
          failed: "failed",
          active: "completed",
          other: "completed",
        };
        return {
          result: {
            thread: {
              cwd: threadId === "other" ? "/other-project" : "/project",
              status: { type: threadId === "active" ? "active" : "idle" },
              turns: [{ id: `${threadId}-turn`, status: turns[threadId] ?? "unknown" }],
            },
          },
        };
      }
      if (method === "thread/list") {
        return {
          result: {
            data: [
              { id: "target" },
              { id: "done" },
              { id: "failed" },
              { id: "active" },
              { id: "other" },
            ],
            nextCursor: null,
          },
        };
      }
      return { result: {} };
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );

    await expect(service.archiveCompleted("target")).resolves.toEqual({
      archived: 1,
      skipped: 3,
      failed: 0,
    });
    expect(request).toHaveBeenCalledWith("thread/archive", { threadId: "done" });
    expect(request).not.toHaveBeenCalledWith("thread/archive", { threadId: "target" });
    expect(request).not.toHaveBeenCalledWith("thread/archive", { threadId: "failed" });
    expect(request).not.toHaveBeenCalledWith("thread/archive", { threadId: "active" });
    expect(request).not.toHaveBeenCalledWith("thread/archive", { threadId: "other" });
  });

  it("counts a rejected Archive request as failed without aborting the batch", async () => {
    const request = vi.fn<NativeRequest>(async (method, params) => {
      if (method === "thread/read") {
        const threadId = String(params.threadId);
        return {
          result: {
            thread: {
              cwd: "/project",
              status: { type: "idle" },
              turns: [{ id: `${threadId}-turn`, status: "completed" }],
            },
          },
        };
      }
      if (method === "thread/list") {
        return {
          result: { data: [{ id: "target" }, { id: "broken" }, { id: "done" }], nextCursor: null },
        };
      }
      if (method === "thread/archive" && params.threadId === "broken") {
        return { error: { message: "archive rejected" } };
      }
      return { result: {} };
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );

    await expect(service.archiveCompleted("target")).resolves.toEqual({
      archived: 1,
      skipped: 0,
      failed: 1,
    });
    expect(request).toHaveBeenCalledWith("thread/archive", { threadId: "done" });
  });

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
      {
        threadId: "thread",
        turnId: "turn",
        title: "Network failure",
        status: "failed",
        owner: "codex",
      },
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
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("仍在运行");
  });
  it.each(["completed", "succeeded", "unknown"])("excludes and rejects %s", async (status) => {
    const f = fixture();
    f.status(status);
    expect((await f.service.list()).threads).toEqual([]);
    await expect(f.service.continue("thread", "turn")).rejects.toThrow();
    expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  });
  it.each(["idle", "notLoaded"])(
    "marks an unfinished turn in a %s thread as interrupted and allows recovery",
    async (threadStatus) => {
      const f = fixture();
      f.status("inProgress");
      f.threadStatus(threadStatus);
      await expect(f.service.list()).resolves.toEqual({
        threads: [
          {
            threadId: "thread",
            turnId: "turn",
            title: "Network failure",
            status: "interrupted",
            owner: "codex",
          },
        ],
        runningThreadIds: [],
        unreadable: 0,
      });
      await expect(f.service.continue("thread", "turn")).resolves.toBe("continued");
      expect(f.request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
    },
  );
  it.each([null, "systemError", "unknown"])(
    "does not infer an interruption from an unfinished turn with thread status %s",
    async (threadStatus) => {
      const f = fixture();
      f.status("inProgress");
      f.threadStatus(threadStatus);
      expect((await f.service.list()).threads).toEqual([]);
      await expect(f.service.continue("thread", "turn")).rejects.toThrow("状态已改变");
      expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    },
  );
  it.each(["native", "host"])(
    "keeps %s running threads green and rejects recovery",
    async (source) => {
      const f = fixture();
      f.status("inProgress");
      if (source === "native") f.threadStatus("active");
      else f.active();
      await expect(f.service.list()).resolves.toEqual({
        threads: [],
        runningThreadIds: ["thread"],
        unreadable: 0,
      });
      await expect(f.service.continue("thread", "turn")).rejects.toThrow("仍在运行");
      expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    },
  );
  it.each(["running", "completed", "new-turn"])(
    "does not continue if an unfinished turn becomes %s during native resume",
    async (change) => {
      const f = fixture();
      f.status("inProgress");
      const original = f.request.getMockImplementation();
      if (!original) throw new Error("Native request fixture missing");
      f.request.mockImplementation(async (method, params) => {
        if (method === "thread/resume") {
          if (change === "running") f.threadStatus("active");
          if (change === "completed") f.status("completed");
          if (change === "new-turn") {
            f.request.mockResolvedValue({
              result: {
                thread: {
                  status: { type: "idle" },
                  turns: [{ id: "new-turn", status: "inProgress" }],
                },
              },
            });
          }
        }
        return original(method, params);
      });
      await expect(f.service.continue("thread", "turn")).rejects.toThrow();
      expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    },
  );
  it("rejects active, stale and private requests", async () => {
    const f = fixture();
    await expect(f.service.continue("thread", "old")).rejects.toThrow("状态已改变");
    f.active();
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("仍在运行");
    const priv = fixture();
    priv.private();
    // 原生状态列表是只读的，隐私模式仍可展示；只有续接动作被拦截。
    expect((await priv.service.list()).threads.map((thread) => thread.threadId)).toEqual([
      "thread",
    ]);
    await expect(priv.service.continue("thread", "turn")).rejects.toThrow("隐私");
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
    expect(await f.service.list()).toEqual({ threads: [], runningThreadIds: [], unreadable: 1 });
    await expect(f.service.continue("broken", "turn")).rejects.toThrow("missing source rollout");
  });
});
