import { expect, it, vi } from "vitest";
import { createRendererSshTurnActionsSender } from "../src/renderer-ssh-turn-actions.js";
import {
  TURN_ACTION_EXECUTE_METHOD,
  sshTurnActionsParamsSchema,
  TURN_ACTIONS_INSPECT_METHOD,
} from "@codexhost/shared-contracts";
const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
function fixture() {
  let current = true;
  const thread = {
    id: threadId,
    cwd: "/remote/repo",
    modelProvider: "gateway",
    path: `/remote/codex/sessions/2026/09/30/rollout-test-${threadId}.jsonl`,
    status: { type: "idle" },
    turns: [{ id: "turn-1", status: "completed" }],
  };
  const send = vi.fn(async (method: string) => {
    if (method === "thread/read") return { thread };
    if (method === "turn/start") return { turn: { id: "execution" } };
    throw { code: -32601 };
  });
  const sendGit = vi.fn(async () => ({
    workspace: "/remote/repo",
    branch: "main",
    head: "abc",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    changes: [],
    submodules: [],
    operation: null,
  }));
  const receipts = new Map<string, unknown>();
  const sendLocal = vi.fn(async (_method: string, raw: unknown) => {
    const p = sshTurnActionsParamsSchema.parse(raw);
    if (p.operation !== "inspect" && !p.invocation) throw new Error("Missing invocation");
    if (p.operation === "claim" && p.invocation) {
      const previous = receipts.get(p.invocation.invocationId);
      if (previous) return previous;
      const result = { ...p.invocation, state: "starting", updatedAt: 1 };
      receipts.set(result.invocationId, { ...result, state: "unknown" });
      return result;
    }
    if (p.operation === "update" && p.result) {
      receipts.set(p.result.invocationId, p.result);
      return p.result;
    }
    return {
      threadId,
      sourceTurnId: "turn-1",
      latestTurnId: "turn-1",
      busy: false,
      private: false,
      actions: [],
      invocations: [],
    };
  });
  const request = createRendererSshTurnActionsSender({
    hostId: "remote:fixture",
    send,
    sendGit,
    sendLocal,
    isCurrent: () => current,
  });
  const params = {
    threadId,
    sourceTurnId: "turn-1",
    invocationId: crypto.randomUUID(),
    actionId: "git.commit_push",
    version: "1",
  };
  return {
    request,
    send,
    sendGit,
    sendLocal,
    thread,
    params,
    retire: () => {
      current = false;
    },
  };
}
it("claims a receipt before native execution and retries by reading the same receipt", async () => {
  const f = fixture();
  expect(await f.request(TURN_ACTION_EXECUTE_METHOD, f.params)).toMatchObject({
    executionTurnId: "execution",
  });
  expect(await f.request(TURN_ACTION_EXECUTE_METHOD, f.params)).toMatchObject({
    executionTurnId: "execution",
  });
  expect(f.send.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  expect(f.sendLocal.mock.calls[0]?.[1]).toMatchObject({
    operation: "claim",
    target: { modelProvider: "gateway", hostId: "remote:fixture" },
  });
});
it("does not use native fallback for business errors", async () => {
  const f = fixture();
  f.send.mockRejectedValue(new Error("transport unavailable"));
  await expect(f.request(TURN_ACTIONS_INSPECT_METHOD, { threadId })).rejects.toThrow(
    "transport unavailable",
  );
  expect(f.sendLocal).not.toHaveBeenCalled();
});
it("does not start on a retired Host or a newly busy turn after claiming", async () => {
  const f = fixture();
  f.retire();
  await expect(f.request(TURN_ACTION_EXECUTE_METHOD, f.params)).rejects.toThrow("连接");
  expect(f.send).not.toHaveBeenCalled();
  const g = fixture();
  g.sendLocal.mockImplementation(async (_method, raw: unknown) => {
    const parsed = sshTurnActionsParamsSchema.parse(raw);
    g.thread.status.type = "active";
    return parsed.result ?? { ...parsed.invocation, state: "starting", updatedAt: 1 };
  });
  expect(await g.request(TURN_ACTION_EXECUTE_METHOD, g.params)).toMatchObject({ state: "unknown" });
  expect(g.send.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(0);
});
