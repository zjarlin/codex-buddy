import { describe, expect, it, vi } from "vitest";
import { createRendererSshAutoModelRoutesSender } from "../src/renderer-ssh-auto-model-routes.js";

const method = "codexhost/auto/routes";
const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const hostId = "remote-ssh-discovered:server";
const thread = {
  id: threadId,
  modelProvider: "remote-provider",
  path: `/remote/codex/sessions/2026/09/29/rollout-${threadId}.jsonl`,
};
const observations = { supported: true, routes: [] };

describe("native SSH Auto observations", () => {
  it.each([-32600, -32601])("reads native ownership before querying a turn (%s)", async (code) => {
    const send = vi.fn(async (name: string) => {
      if (name === "thread/read") return { thread };
      throw { code, message: `Invalid request: unknown variant \`${method}\`` };
    });
    const sendLocal = vi.fn().mockResolvedValue(observations);
    const request = createRendererSshAutoModelRoutesSender({
      hostId,
      send,
      sendLocal,
      isCurrent: () => true,
    });
    const priority = { priority: "background" } as const;
    expect(await request(method, { threadId, runId: "turn-1" }, priority)).toEqual(observations);
    expect(send).toHaveBeenLastCalledWith(
      "thread/read",
      { threadId, includeTurns: false },
      priority,
    );
    expect(sendLocal).toHaveBeenCalledWith(
      "codexhost/ssh/auto/routes",
      {
        hostId,
        threadId,
        runId: "turn-1",
        modelProvider: thread.modelProvider,
        rolloutPath: thread.path,
      },
      priority,
    );
    await request(method, { threadId, runId: "turn-2" });
    expect(send.mock.calls.filter(([name]) => name === method)).toHaveLength(1);
    expect(sendLocal.mock.calls.at(-1)?.[1]).toMatchObject({ runId: "turn-2" });
  });

  it.each([
    { code: -32000, message: "connection lost" },
    { code: -32600, message: "bad params" },
    new Error("provider unavailable"),
  ])("does not fall back after a transport or business error", async (failure) => {
    const sendLocal = vi.fn();
    const request = createRendererSshAutoModelRoutesSender({
      hostId,
      send: vi.fn().mockRejectedValue(failure),
      sendLocal,
      isCurrent: () => true,
    });
    await expect(request(method, { threadId })).rejects.toBe(failure);
    expect(sendLocal).not.toHaveBeenCalled();
  });

  it("preserves native results including privacy without probing SSH", async () => {
    const result = { supported: false, routes: [], unavailableReason: "private" };
    const sendLocal = vi.fn();
    const request = createRendererSshAutoModelRoutesSender({
      hostId,
      send: async () => result,
      sendLocal,
      isCurrent: () => true,
    });
    expect(await request(method, { threadId })).toBe(result);
    expect(sendLocal).not.toHaveBeenCalled();
  });

  it.each([
    { ...thread, id: "other" },
    { ...thread, path: null },
    { ...thread, modelProvider: null },
  ])("rejects missing or mismatched native ownership", async (nativeThread) => {
    const sendLocal = vi.fn();
    const request = createRendererSshAutoModelRoutesSender({
      hostId,
      send: async (name) => {
        if (name === "thread/read") return { thread: nativeThread };
        throw { code: -32601 };
      },
      sendLocal,
      isCurrent: () => true,
    });
    await expect(request(method, { threadId })).rejects.toThrow();
    expect(sendLocal).not.toHaveBeenCalled();
  });

  it.each(["thread", "observation"])(
    "discards retired connections during %s lookup",
    async (phase) => {
      let current = true;
      const sendLocal = vi.fn(async () => {
        current = false;
        return observations;
      });
      const request = createRendererSshAutoModelRoutesSender({
        hostId,
        send: async (name) => {
          if (name !== "thread/read") throw { code: -32601 };
          if (phase === "thread") current = false;
          return { thread };
        },
        sendLocal,
        isCurrent: () => current,
      });
      await expect(request(method, { threadId })).rejects.toThrow("SSH 连接已变化");
      expect(sendLocal).toHaveBeenCalledTimes(phase === "thread" ? 0 : 1);
    },
  );
});
