import { describe, expect, it, vi } from "vitest";
import type { NativeRequest } from "../src/buddy/planner.js";
import { recentCompletedSessions } from "../src/recent-sessions.js";

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
    const request = vi.fn<NativeRequest>(async (method, params) => {
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
    const request: NativeRequest = async (method) =>
      method === "thread/list"
        ? { result: { data: [{ id: "pending", cwd: "/two" }] } }
        : { result: { data: [{ status: "inProgress" }] } };
    expect((await recentCompletedSessions(request)).candidates).toEqual([]);
  });

  it("falls back to full history only when the native pagination method is unsupported", async () => {
    const request = vi.fn<NativeRequest>(async (method) => {
      if (method === "thread/list") return { result: { data: [{ id: "old", cwd: "/one" }] } };
      if (method === "thread/turns/list")
        return { error: { code: -32601, message: "unknown method" } };
      return { result: { thread: { id: "old", cwd: "/one", turns: [{ status: "completed" }] } } };
    });
    expect((await recentCompletedSessions(request)).candidates.map((row) => row.threadId)).toEqual([
      "old",
    ]);
  });

  it("reports native history errors instead of presenting them as successful empty results", async () => {
    await expect(
      recentCompletedSessions(async () => ({ error: { message: "disconnected" } })),
    ).rejects.toThrow("disconnected");
  });
});
