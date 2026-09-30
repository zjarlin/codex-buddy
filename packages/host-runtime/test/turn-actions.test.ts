import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostThreadIdSchema, harnessCommandCatalogSchema } from "@codexhost/shared-contracts";
import { TurnActions, type TurnActionContext } from "../src/turn-actions.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "turn-actions-"));
  homes.push(home);
  const context: TurnActionContext = {
    threadId: "019ccb31-9520-7120-bc17-556e9a92d860",
    harnessId: "pi",
    turns: [{ id: "source", status: "completed" }],
    busy: false,
    private: false,
    planMode: false,
    git: true,
    features: { git_changes: 2, git_conflicts: 0, git_ahead: 0, git_behind: 0 },
    commands: harnessCommandCatalogSchema.parse({
      commands: [
        { id: "pi.compact", label: "Compact", invocation: "/compact", argumentMode: "none" },
      ],
    }),
  };
  const start = vi.fn(async () => "execution");
  const options = {
    environment: { CODEXHOST_DATA_DIR: home },
    context: vi.fn(async () => context),
    privateMode: async () => context.private,
    start,
  };
  const actions = new TurnActions(options);
  const params = {
    threadId: hostThreadIdSchema.parse(context.threadId),
    sourceTurnId: "source",
    actionId: "git.commit",
    version: "1",
    invocationId: randomUUID(),
  };
  return { actions, context, start, options, params };
}

describe("turn actions", () => {
  it("starts one commit-only prompt for concurrent duplicates and replays the persisted receipt after restart", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.actions.execute(f.params), f.actions.execute(f.params)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      executionTurnId: "execution",
      sourceTurnId: "source",
      state: "running",
    });
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.start.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: expect.objectContaining({
            kind: "prompt",
            prompt: expect.stringContaining("不推送"),
          }),
        }),
      ]),
    );
    const restarted = new TurnActions(f.options);
    expect(await restarted.execute(f.params)).toEqual(a);
    expect(f.start).toHaveBeenCalledTimes(1);
    await expect(restarted.execute({ ...f.params, actionId: "git.commit_push" })).rejects.toThrow(
      "执行 ID",
    );
  });
  it.each(["busy", "private", "planMode"] as const)(
    "rejects %s without invoking or recording a start",
    async (state) => {
      const f = await fixture();
      f.context[state] = true;
      await expect(f.actions.execute(f.params)).rejects.toThrow();
      expect(f.start).not.toHaveBeenCalled();
      expect((await f.actions.inspect({ threadId: f.params.threadId })).invocations).toEqual([]);
    },
  );
  it("rejects stale turns, changed versions and unexpected parameters", async () => {
    const f = await fixture();
    await expect(f.actions.execute({ ...f.params, sourceTurnId: "old" })).rejects.toThrow("历史");
    await expect(f.actions.execute({ ...f.params, version: "2" })).rejects.toThrow("变化");
    await expect(f.actions.execute({ ...f.params, argumentText: "push" })).rejects.toThrow("参数");
    expect(f.start).not.toHaveBeenCalled();
  });
  it("revalidates after durable admission and does not start after the context changes", async () => {
    const f = await fixture();
    let count = 0;
    f.options.context.mockImplementation(async () => {
      if (++count > 1) f.context.busy = true;
      return f.context;
    });
    expect(await f.actions.execute(f.params)).toMatchObject({ state: "failed" });
    expect(f.start).not.toHaveBeenCalled();
  });
  it("does not replay an ambiguous start after a transport error or Host restart", async () => {
    const f = await fixture();
    f.start.mockRejectedValue(new Error("transport lost"));
    expect(await f.actions.execute(f.params)).toMatchObject({ state: "unknown" });
    expect(await new TurnActions(f.options).execute(f.params)).toMatchObject({ state: "unknown" });
    expect(f.start).toHaveBeenCalledTimes(1);
  });
  it("reconciles completion from the actual turn and suppresses automatic push for commit-only", async () => {
    const f = await fixture();
    await f.actions.execute(f.params);
    expect(await f.actions.completed(f.params.threadId, "execution", "completed")).toBe(true);
    const snapshot = await f.actions.inspect({ threadId: f.params.threadId });
    expect(snapshot.invocations[0]).toMatchObject({ state: "completed" });
    expect(await f.actions.completed(f.params.threadId, "unrelated", "completed")).toBe(false);
  });
  it("keeps an early completion ahead of the start acknowledgement", async () => {
    const f = await fixture();
    f.start.mockImplementation(async () => {
      expect(await f.actions.completed(f.params.threadId, "execution", "completed")).toBe(true);
      return "execution";
    });
    expect(await f.actions.execute(f.params)).toMatchObject({
      state: "completed",
      executionTurnId: "execution",
    });
  });
  it("uses live native commands and accepts optional plugin contributions without modifying old adapters", async () => {
    const f = await fixture();
    f.context.contributions = [
      {
        actionId: "pi.review",
        version: "1",
        label: "Review",
        description: "Review changes",
        argumentMode: "text",
        target: { kind: "prompt", prompt: "Review current changes" },
      },
    ];
    const snapshot = await f.actions.inspect({ threadId: f.params.threadId });
    const compact = snapshot.actions.find(({ label }) => label === "Compact");
    if (!compact) throw new Error("Missing compact");
    await f.actions.execute({ ...f.params, actionId: compact.actionId, version: compact.version });
    expect(f.start.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: { kind: "command", commandId: "pi.compact" } }),
      ]),
    );
    f.context.commands = { commands: [] };
    await expect(
      f.actions.execute({
        ...f.params,
        invocationId: randomUUID(),
        actionId: compact.actionId,
        version: compact.version,
      }),
    ).rejects.toThrow("变化");
    expect(snapshot.actions.find(({ actionId }) => actionId === "pi.review")).toMatchObject({
      kind: "prompt",
      argumentMode: "text",
    });
  });
  it("does not expose command executors or prompt bodies in public snapshots", async () => {
    const f = await fixture();
    const snapshot = await f.actions.inspect({ threadId: f.params.threadId });
    expect(JSON.stringify(snapshot)).not.toContain('"target"');
    expect(JSON.stringify(snapshot)).not.toContain("本次只提交");
  });
});
