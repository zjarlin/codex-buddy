import { describe, expect, it, vi } from "vitest";
import { recentCompletedSessions, type RecentSessionsRequest } from "../src/recent-sessions.js";

describe("recent completed sessions", () => {
  it("lists completed conversations across projects without model scoring", async () => {
    const rows = [
      { id: "a", cwd: "/one", name: "First" },
      { id: "b", cwd: "/two", name: "Second" },
      { id: "running", cwd: "/two", status: { type: "active" } },
      { id: "failed", cwd: "/one" },
      { id: "empty", cwd: "/one" },
      { id: "child", cwd: "/one", canAcceptDirectInput: false },
    ];
    const request = vi.fn<RecentSessionsRequest>(async (method, params) => {
      if (method === "thread/list") return { result: { data: rows } };
      return {
        result: {
          data:
            params.threadId === "empty"
              ? []
              : [{ status: params.threadId === "failed" ? "failed" : "completed" }],
        },
      };
    });
    const result = await recentCompletedSessions(request);
    expect(result.candidates.map((row) => [row.threadId, row.cwd, row.confidence])).toEqual([
      ["a", "/one", null],
      ["b", "/two", null],
    ]);
    expect(
      request.mock.calls
        .filter(([method]) => method === "thread/turns/list")
        .map(([, params]) => params.threadId),
    ).toEqual(["a", "b", "failed", "empty"]);
    expect(request).toHaveBeenCalledWith(
      "thread/list",
      expect.objectContaining({ archived: false, sortKey: "updated_at", sortDirection: "desc" }),
    );
  });

  it("rejects a candidate that becomes active or has no confirmed completion", async () => {
    const request: RecentSessionsRequest = async (method) =>
      method === "thread/list"
        ? { result: { data: [{ id: "pending", cwd: "/two" }] } }
        : { result: { data: [{ status: "inProgress" }] } };
    expect((await recentCompletedSessions(request)).candidates).toEqual([]);
  });

  it.each([
    { code: -32601, message: "unknown method" },
    {
      code: -32600,
      message:
        "Invalid request: unknown variant `thread/turns/list`, expected one of `initialize`, `thread/read`",
    },
    { code: -32600, message: "thread/turns/list is not supported yet" },
  ])(
    "falls back to full history when native pagination is unsupported ($message)",
    async (error) => {
      const request = vi.fn<RecentSessionsRequest>(async (method) => {
        if (method === "thread/list") return { result: { data: [{ id: "old", cwd: "/one" }] } };
        if (method === "thread/turns/list") return { error };
        return { result: { thread: { id: "old", cwd: "/one", turns: [{ status: "completed" }] } } };
      });
      expect(
        (await recentCompletedSessions(request)).candidates.map((row) => row.threadId),
      ).toEqual(["old"]);
    },
  );

  it.each([false, true])(
    "keeps completed candidates when an unmaterialized draft has no history (legacy: %s)",
    async (legacy) => {
      const request = vi.fn<RecentSessionsRequest>(async (method, params) => {
        if (method === "thread/list") {
          return {
            result: {
              data: [
                { id: "draft", cwd: "/one" },
                { id: "completed", cwd: "/one" },
              ],
            },
          };
        }
        if (legacy && method === "thread/turns/list") {
          return { error: { code: -32601, message: "unknown method" } };
        }
        if (params.threadId === "draft") {
          return {
            error: {
              message:
                "thread draft is not materialized yet; includeTurns is unavailable before first user message",
            },
          };
        }
        const turns = [{ status: "completed" }];
        return legacy
          ? { result: { thread: { id: "completed", turns } } }
          : { result: { data: turns } };
      });

      expect(
        (await recentCompletedSessions(request)).candidates.map((row) => row.threadId),
      ).toEqual(["completed"]);
    },
  );

  it.each([false, true])(
    "preserves unexpected per-thread history errors (legacy: %s)",
    async (legacy) => {
      const request: RecentSessionsRequest = async (method) => {
        if (method === "thread/list") {
          return { result: { data: [{ id: "unavailable", cwd: "/one" }] } };
        }
        if (legacy && method === "thread/turns/list") {
          return { error: { code: -32601, message: "unknown method" } };
        }
        return { error: { message: "disconnected" } };
      };

      await expect(recentCompletedSessions(request)).rejects.toThrow("disconnected");
    },
  );

  it("does not fall back for invalid pagination parameters", async () => {
    const request = vi.fn<RecentSessionsRequest>(async (method) => {
      if (method === "thread/list") {
        return { result: { data: [{ id: "invalid", cwd: "/one" }] } };
      }
      return {
        error: { code: -32600, message: "Invalid request: unknown variant `invalid-view`" },
      };
    });

    await expect(recentCompletedSessions(request)).rejects.toThrow("invalid-view");
    expect(request).not.toHaveBeenCalledWith("thread/read", expect.anything());
  });

  it("reports native history errors instead of presenting them as successful empty results", async () => {
    await expect(
      recentCompletedSessions(async () => ({ error: { message: "disconnected" } })),
    ).rejects.toThrow("disconnected");
  });
});
