import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@codexhost/shared-contracts";
import {
  InterruptedConversations,
  type InterruptedTurnClassifier,
} from "../../src/buddy/continuation.js";
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

function layaFixture(
  options: {
    status?: string;
    threadStatus?: string | null;
    updatedAt?: number;
    assistant?: string;
    user?: string;
    verdict?: boolean;
    throws?: boolean;
    items?: JsonValue[];
    error?: string;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const status = options.status ?? "inProgress";
  const threadStatus = options.threadStatus === undefined ? "idle" : options.threadStatus;
  const turn = {
    id: "turn",
    status,
    ...(options.error ? { error: { message: options.error } } : {}),
    items: options.items ?? [
      {
        type: "userMessage",
        content: [{ type: "text", text: options.user ?? "修复构建" }],
      },
      { type: "agentMessage", text: options.assistant ?? "我先检查一下构建日志" },
    ],
  };
  const request = vi.fn<NativeRequest>(async (method, params) => {
    if (method === "thread/list")
      return {
        result: {
          data: [{ id: "thread", name: "Build", updatedAt: options.updatedAt ?? now }],
        },
      };
    if (method === "thread/read")
      return {
        result: {
          thread: {
            name: "Build",
            status: threadStatus === null ? null : { type: threadStatus },
            ...(params.includeTurns === true ? { turns: [turn] } : {}),
          },
        },
      };
    if (method === "thread/turns/list")
      return {
        result: {
          data: [params.itemsView === "full" ? turn : { id: "turn", status }],
        },
      };
    if (method === "thread/resume") return { result: { thread: { status: { type: "idle" } } } };
    if (method === "turn/start") return { result: { turn: { id: "continued" } } };
    return { result: {} };
  });
  const classifier = vi.fn<InterruptedTurnClassifier>(async () => {
    if (options.throws) throw new Error("laya unavailable");
    return options.verdict ?? true;
  });
  const service = new InterruptedConversations(
    request,
    () => false,
    async () => true,
    classifier,
  );
  return { service, request, classifier };
}

describe("interrupted conversations", () => {
  it.each([
    { status: "completed", items: [{ type: "contextCompaction" }] },
    { status: "completed", items: [{ type: "agentMessage" }] },
    { status: "failed", items: [{ type: "contextCompaction" }] },
  ])("never continues after a compaction turn: %j", async (turn) => {
    const request = vi.fn<NativeRequest>(async (method) => {
      if (method === "thread/read")
        return { result: { thread: { status: { type: "idle" }, turns: [turn] } } };
      if (method === "turn/start") return { result: { turn: { id: "continued" } } };
      return { result: {} };
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );
    await expect(service.continue("thread", "compact")).rejects.toThrow("会话状态已改变");
    expect(request.mock.calls.map(([method]) => method)).not.toContain("turn/start");
  });

  it("refuses automatic resume of a turn whose history cannot be decrypted", async () => {
    const request = vi.fn<NativeRequest>(async (method) => {
      if (method === "thread/read")
        return {
          result: {
            thread: {
              status: { type: "idle" },
              turns: [
                {
                  id: "turn",
                  status: "failed",
                  error: {
                    message:
                      "stream disconnected before completion: Encrypted function output content could not be decrypted or decoded.",
                  },
                },
              ],
            },
          },
        };
      if (method === "turn/start") return { result: { turn: { id: "continued" } } };
      return { result: {} };
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );
    await expect(service.continue("thread", "turn", { automatic: true })).rejects.toThrow(
      "无法解密",
    );
    expect(request.mock.calls.map(([method]) => method)).not.toContain("thread/resume");
    expect(request.mock.calls.map(([method]) => method)).not.toContain("turn/start");
    // 手动入口保留：用户可能已经压缩过历史，Host 不替他判断历史是否已经可读。
    await expect(service.continue("thread", "turn")).resolves.toBe("continued");
  });

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
  it.each(["idle", "notLoaded", "systemError"])(
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
  it.each([null, "unknown"])(
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
  it("reads only metadata and the latest turn instead of the whole history", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const request = vi.fn<NativeRequest>(async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/list") return { result: { data: [{ id: "thread" }] } };
      if (method === "thread/read") {
        // 分页元数据不携带 turns；只有 includeTurns 才返回历史。
        return {
          result: {
            thread: {
              name: "Big history",
              status: { type: "idle" },
              ...(params.includeTurns === true
                ? { turns: [{ id: "turn", status: "failed" }] }
                : {}),
            },
          },
        };
      }
      if (method === "thread/turns/list")
        return {
          result: {
            data: [{ id: "turn", status: "failed", items: [{ type: "agentMessage" }] }],
            nextCursor: null,
            backwardsCursor: null,
          },
        };
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
          threadId: "thread",
          turnId: "turn",
          title: "Big history",
          status: "failed",
          owner: "codex",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    expect(calls).toContainEqual({
      method: "thread/read",
      params: { threadId: "thread", includeTurns: false },
    });
    expect(calls).toContainEqual({
      method: "thread/turns/list",
      params: { threadId: "thread", limit: 1, sortDirection: "desc", itemsView: "notLoaded" },
    });
    // 扫描过程不物化整段历史，避免大会话超时拖垮整轮发现。
    expect(calls.some((call) => call.params.includeTurns === true)).toBe(false);
  });

  it("falls back to the legacy full-history read when pagination is unsupported", async () => {
    const request = vi.fn<NativeRequest>(async (method, params) => {
      if (method === "thread/list") return { result: { data: [{ id: "thread" }] } };
      if (method === "thread/read")
        return {
          result: {
            thread: {
              name: "Legacy",
              status: { type: "idle" },
              ...(params.includeTurns === true
                ? { turns: [{ id: "turn", status: "failed" }] }
                : {}),
            },
          },
        };
      if (method === "thread/turns/list")
        return { error: { code: -32601, message: "thread/turns/list is not supported yet" } };
      return { result: {} };
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
    );
    await expect(service.list()).resolves.toEqual({
      threads: [
        { threadId: "thread", turnId: "turn", title: "Legacy", status: "failed", owner: "codex" },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
    expect(request).toHaveBeenCalledWith("thread/read", {
      threadId: "thread",
      includeTurns: true,
    });
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

  it("uses Laya to classify a recent ambiguous turn and sends only its tail", async () => {
    const assistant = `${"x".repeat(10_000)}TAIL`;
    const f = layaFixture({ assistant });
    await expect(f.service.list()).resolves.toMatchObject({
      threads: [{ threadId: "thread", turnId: "turn", status: "interrupted" }],
    });
    expect(f.classifier).toHaveBeenCalledWith(
      expect.objectContaining({
        turnStatus: "inProgress",
        assistantText: expect.stringMatching(/TAIL$/),
        userText: "修复构建",
        lastItemType: "agentMessage",
        pendingTool: false,
      }),
    );
    expect(f.classifier.mock.calls[0]?.[0].assistantText).toHaveLength(6_000);
    expect(f.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ itemsView: "full" }),
    );
  });

  it("excludes an ambiguous turn when Laya confidently says completed", async () => {
    const f = layaFixture({ verdict: false });
    expect((await f.service.list()).threads).toEqual([]);
    expect(f.classifier).toHaveBeenCalledOnce();
  });

  it("falls back to stale inProgress when Laya is unavailable", async () => {
    const f = layaFixture({ throws: true });
    expect((await f.service.list()).threads.map((thread) => thread.status)).toEqual([
      "interrupted",
    ]);
  });

  it("does not call Laya for a clearly completed turn", async () => {
    const f = layaFixture({ status: "completed" });
    expect((await f.service.list()).threads).toEqual([]);
    expect(f.classifier).not.toHaveBeenCalled();
  });

  it("enqueues a recent systemError thread whose latest turn already completed", async () => {
    const f = layaFixture({ status: "completed", threadStatus: "systemError" });
    await expect(f.service.list()).resolves.toMatchObject({
      threads: [{ threadId: "thread", turnId: "turn", status: "failed" }],
    });
    expect(f.classifier).not.toHaveBeenCalled();
  });

  it("leaves a systemError thread older than three days out of the queue", async () => {
    const f = layaFixture({
      status: "completed",
      threadStatus: "systemError",
      updatedAt: Math.floor(Date.now() / 1000) - 4 * 24 * 60 * 60,
    });
    expect((await f.service.list()).threads).toEqual([]);
  });

  it("enqueues a recent turn with a non-retryable error item without asking Laya", async () => {
    const f = layaFixture({
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "修复构建" }] },
        { type: "agentMessage", text: "构建失败了" },
        { type: "error", message: "stream disconnected", willRetry: false },
      ],
    });
    await expect(f.service.list()).resolves.toMatchObject({
      threads: [{ threadId: "thread", turnId: "turn", status: "failed" }],
    });
    expect(f.classifier).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous turn when Laya is unavailable instead of dropping it", async () => {
    const f = layaFixture({
      status: "completed",
      throws: true,
      items: [
        { type: "userMessage", content: [{ type: "text", text: "跑一下构建" }] },
        { type: "commandExecution", status: "completed", command: "npm run build" },
      ],
    });
    expect((await f.service.list()).threads.map((thread) => thread.status)).toEqual([
      "interrupted",
    ]);
    expect(f.classifier).toHaveBeenCalledOnce();
  });

  it("stops asking Laya after repeated failures and keeps the remaining turns", async () => {
    const now = Math.floor(Date.now() / 1000);
    const threads = Array.from({ length: 12 }, (_, index) => ({
      id: `thread-${index}`,
      name: `Thread ${index}`,
      updatedAt: now - index,
    }));
    const turn = {
      id: "turn",
      status: "completed",
      items: [{ type: "commandExecution", status: "completed", command: "npm run build" }],
    };
    const request = vi.fn<NativeRequest>(async (method, params) => {
      if (method === "thread/list") return { result: { data: threads, nextCursor: null } };
      if (method === "thread/read")
        return { result: { thread: { name: "Thread", status: { type: "idle" } } } };
      if (method === "thread/turns/list")
        return {
          result: {
            data: [params.itemsView === "full" ? turn : { id: "turn", status: "completed" }],
          },
        };
      return { result: {} };
    });
    const classifier = vi.fn<InterruptedTurnClassifier>(async () => {
      throw new Error("503 System One account is busy");
    });
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
      classifier,
    );
    expect((await service.list()).threads).toHaveLength(threads.length);
    // 并发读取会同时发起几条请求，失败计数达到上限后不再继续问询。
    expect(classifier.mock.calls.length).toBeLessThan(threads.length);
    expect(classifier.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("skips old failures in background discovery but still checks one opened thread", async () => {
    const f = layaFixture({
      status: "failed",
      updatedAt: Math.floor(Date.now() / 1000) - 4 * 24 * 60 * 60,
    });
    expect((await f.service.list()).threads).toEqual([]);
    await expect(f.service.list({ threadId: "thread" })).resolves.toMatchObject({
      threads: [{ threadId: "thread", status: "failed" }],
    });
  });

  it("continues a queued systemError thread without asking Laya again", async () => {
    const f = layaFixture({ status: "completed", threadStatus: "systemError" });
    await expect(f.service.list()).resolves.toMatchObject({ threads: [{ status: "failed" }] });
    await expect(f.service.continue("thread", "turn")).resolves.toBe("continued");
    expect(f.classifier).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({ threadId: "thread" }),
    );
  });

  it("spends the classification budget only on new verdicts", async () => {
    const now = Math.floor(Date.now() / 1000);
    const threads = Array.from({ length: 70 }, (_, index) => ({
      id: `thread-${index}`,
      name: `Thread ${index}`,
      updatedAt: now - index,
    }));
    const turn = {
      id: "turn",
      status: "completed",
      items: [{ type: "commandExecution", status: "completed", command: "npm run build" }],
    };
    const request = vi.fn<NativeRequest>(async (method, params) => {
      if (method === "thread/list") return { result: { data: threads, nextCursor: null } };
      if (method === "thread/read")
        return { result: { thread: { name: "Thread", status: { type: "idle" } } } };
      if (method === "thread/turns/list")
        return {
          result: {
            data: [params.itemsView === "full" ? turn : { id: "turn", status: "completed" }],
          },
        };
      return { result: {} };
    });
    const classifier = vi.fn<InterruptedTurnClassifier>(async () => true);
    const service = new InterruptedConversations(
      request,
      () => false,
      async () => true,
      classifier,
    );

    const firstScan = await service.list();
    const first = classifier.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(threads.length);
    expect(firstScan.threads).toHaveLength(first);

    // 第二轮先复用上一轮的结论，剩下的会话才轮到 Laya；预算按真实调用计算，
    // 不会因为同一批靠前的会话反复命中缓存而永远轮不到后面。
    expect((await service.list()).threads).toHaveLength(threads.length);
    expect(classifier).toHaveBeenCalledTimes(threads.length);
  });

  it("classifies a completed turn that ends in a failed command", async () => {
    const f = layaFixture({
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "修复构建" }] },
        { type: "agentMessage", text: "我先运行构建" },
        { type: "commandExecution", status: "failed", command: "npm run build" },
      ],
    });
    await expect(f.service.list()).resolves.toMatchObject({
      threads: [{ threadId: "thread", turnId: "turn", status: "interrupted" }],
    });
    expect(f.classifier).toHaveBeenCalledWith(
      expect.objectContaining({
        turnStatus: "completed",
        lastItemType: "commandExecution",
        lastItemStatus: "failed",
        pendingTool: false,
      }),
    );
  });

  it("classifies a completed turn that ends in a succeeded command without an answer", async () => {
    const f = layaFixture({
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "看看构建结果" }] },
        { type: "commandExecution", status: "completed", command: "npm run build" },
      ],
    });
    expect((await f.service.list()).threads).toHaveLength(1);
    expect(f.classifier).toHaveBeenCalledOnce();
  });

  it("checks one named thread without listing the rest of the history", async () => {
    const f = layaFixture({ status: "unknown" });
    await expect(f.service.list({ threadId: "thread" })).resolves.toMatchObject({
      threads: [{ threadId: "thread", turnId: "turn" }],
    });
    expect(f.request.mock.calls.some(([method]) => method === "thread/list")).toBe(false);
  });

  it("classifies an answered completed turn that still carries an unresolved error", async () => {
    const f = layaFixture({
      status: "completed",
      error: "stream disconnected",
    });
    expect((await f.service.list()).threads).toHaveLength(1);
    expect(f.classifier).toHaveBeenCalledWith(
      expect.objectContaining({ errorText: "stream disconnected" }),
    );
  });

  it("only classifies sessions updated within the last three days", async () => {
    const f = layaFixture({
      status: "unknown",
      updatedAt: Math.floor(Date.now() / 1000) - 4 * 24 * 60 * 60,
    });
    expect((await f.service.list()).threads).toEqual([]);
    expect(f.classifier).not.toHaveBeenCalled();
  });

  it("continues an ambiguous turn only after Laya confirms it", async () => {
    const f = layaFixture({ status: "unknown" });
    await expect(f.service.list()).resolves.toMatchObject({
      threads: [{ threadId: "thread", turnId: "turn" }],
    });
    await expect(f.service.continue("thread", "turn")).resolves.toBe("continued");
    expect(f.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({ threadId: "thread" }),
    );
  });

  it("continues a completed turn whose tail is a failed command when Laya confirms", async () => {
    const f = layaFixture({
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "修复构建" }] },
        { type: "commandExecution", status: "failed", command: "npm run build" },
      ],
    });
    expect((await f.service.list()).threads).toHaveLength(1);
    await expect(f.service.continue("thread", "turn")).resolves.toBe("continued");
    expect(f.request).toHaveBeenCalledWith("thread/resume", { threadId: "thread" });
    expect(f.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({ threadId: "thread" }),
    );
  });

  it("does not continue a clearly completed turn without an unfinished tail", async () => {
    const f = layaFixture({ status: "completed" });
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("状态已改变");
    expect(f.classifier).not.toHaveBeenCalled();
    expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  });

  it("does not continue an ambiguous turn that Laya rejects", async () => {
    const f = layaFixture({ status: "unknown", verdict: false });
    expect((await f.service.list()).threads).toEqual([]);
    await expect(f.service.continue("thread", "turn")).rejects.toThrow("状态已改变");
    expect(f.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  });
});
