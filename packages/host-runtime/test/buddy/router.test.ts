import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonObject, JsonRpcRequest } from "@codexhost/protocol-core";
import { BuddyRouter, specialist } from "../../src/buddy/router.js";
import { chooseModels, modelTier } from "../../src/buddy/models.js";
import type { SubagentRunner } from "../../src/buddy/subagent-scheduler.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((clean) => clean()));
});

async function fixture(
  options: {
    holdPlan?: boolean;
    plannerFails?: boolean;
    interactivePlan?: boolean;
    ephemeral?: boolean;
    historyError?: { code: number; message: string };
    legacyHistoryError?: { code: number; message: string };
    historyTurns?: JsonObject[];
    historyItems?: JsonObject[];
    modelIds?: string[];
    modelRows?: JsonObject[];
    threadProvider?: string;
    clarification?: string;
    planSteps?: string[];
    planChecks?: string[];
    recovery?: boolean;
    plan?: JsonObject;
    runSubagents?: SubagentRunner;
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), "buddy-router-test-"));
  let providerRequests = 0;
  const models =
    options.modelRows ??
    (options.modelIds ?? ["gpt-planner", "deepseek-flash"]).map((id) => ({ id }));
  const server: Server = createServer((req, res) => {
    providerRequests += 1;
    expect(req.url).toBe("/v1/models");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: models }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("No fixture address");
  }
  await writeFile(
    join(home, "config.toml"),
    `model_provider = "fixture"\nmodel = "gpt-planner"\n[model_providers.fixture]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nexperimental_bearer_token = "fixture-only"\n`,
  );
  const sent: JsonObject[] = [];
  const forwarded: JsonRpcRequest[] = [];
  const requested: { method: string; params: JsonObject }[] = [];
  const replies: JsonObject[] = [];
  const router: BuddyRouter = new BuddyRouter({
    environment: { CODEX_HOME: home },
    ...(options.runSubagents ? { runSubagents: options.runSubagents } : {}),
    request: async (method, params) => {
      requested.push({ method, params });
      switch (method) {
        case "model/list":
          return {
            result: { data: models, nextCursor: null },
          };
        case "thread/read":
          if (params.includeTurns && options.legacyHistoryError) {
            return { error: options.legacyHistoryError };
          }
          return {
            result: {
              thread: {
                ephemeral: options.ephemeral ?? false,
                ...(params.includeTurns ? { turns: options.historyTurns ?? [] } : {}),
              },
            },
          };
        case "thread/items/list":
          if (options.historyError) {
            return { error: options.historyError };
          }
          return {
            result: {
              data: options.historyItems ?? [
                { type: "agentMessage", text: "已确认目标目录" },
                { type: "userMessage", content: [{ type: "text", text: "原需求" }] },
              ],
            },
          };
        case "thread/start":
          return { result: { thread: { id: "planner" } } };
        case "turn/start": {
          if (options.recovery && params.threadId === "work") {
            const turnId = `continued-${requested.filter((entry) => entry.method === "turn/start").length}`;
            router.observe({
              method: "turn/started",
              params: { threadId: "work", turn: { id: turnId } },
            });
            return { result: { turn: { id: turnId } } };
          }
          if (options.plannerFails) {
            return { error: { code: -1, message: "fixture planning failure" } };
          }
          router.observe({
            method: "turn/started",
            params: { threadId: "planner", turn: { id: "plan-turn" } },
          });
          if (options.interactivePlan) {
            router.observe({
              id: "question",
              method: "item/tool/requestUserInput",
              params: { threadId: "planner" },
            });
          } else if (!options.holdPlan) {
            router.observe({
              method: "item/completed",
              params: {
                threadId: "planner",
                item: {
                  type: "agentMessage",
                  text: JSON.stringify(
                    options.plan ?? {
                      goal: "目标",
                      steps: options.clarification ? [] : (options.planSteps ?? ["只修改目标文件"]),
                      checks: options.clarification ? [] : (options.planChecks ?? ["运行对应测试"]),
                      clarification: options.clarification ?? null,
                    },
                  ),
                },
              },
            });
            router.observe({
              method: "turn/completed",
              params: { threadId: "planner", turn: { id: "plan-turn", status: "completed" } },
            });
          }
          return { result: { turn: { id: "plan-turn" } } };
        }
        default:
          return { result: {} };
      }
    },
    send: async (message) => {
      sent.push(message);
    },
    respond: async (message) => {
      replies.push(message);
    },
    forward: async (request) => {
      forwarded.push(request);
    },
    diagnose: () => undefined,
  });
  router.track({ id: 1, method: "thread/resume", params: { threadId: "work" } });
  router.observe({
    id: 1,
    result: {
      cwd: home,
      modelProvider: options.threadProvider ?? "fixture",
      model: "gpt-planner",
      sandbox: { type: "dangerFullAccess" },
      approvalPolicy: "never",
      thread: { id: "work", environments: [{ environmentId: "local" }] },
    },
  });
  const turn = (text: string, overrides: JsonObject = {}): JsonRpcRequest => ({
    id: 2,
    method: "turn/start",
    params: { threadId: "work", input: [{ type: "text", text }], ...overrides },
  });
  cleanups.push(async () => {
    router.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  return {
    router,
    turn,
    sent,
    forwarded,
    requested,
    replies,
    home,
    providerRequests: () => providerRequests,
  };
}

describe("Buddy family policy", () => {
  it("preserves explicit structured output requests without planning or model selection", async () => {
    const f = await fixture();
    const request = f.turn("为当前任务生成标题", {
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    });
    const original = structuredClone(request);
    expect(await f.router.route(request)).toBe(false);
    expect(request).toEqual(original);
    expect(f.requested).toEqual([]);
    expect(f.forwarded).toEqual([]);
    expect(f.sent).toEqual([]);
    expect(f.providerRequests()).toBe(0);
    expect((await f.router.snapshot()).decisions).toEqual([]);
  });

  it("automatically continues native failures and changes both model fields after three failures", async () => {
    const historyTurns: JsonObject[] = [];
    const f = await fixture({
      recovery: true,
      historyTurns,
      modelIds: ["gpt-planner", "cheap-a-flash", "cheap-b-flash"],
    });
    await f.router.route(
      f.turn("hi", {
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly" },
        cwd: f.home,
      }),
    );
    const initial = (f.forwarded[0]?.params as JsonObject | undefined)?.model;
    let turnId = "initial";
    f.router.observe({
      method: "turn/started",
      params: { threadId: "work", turn: { id: turnId } },
    });
    for (let i = 1; i <= 3; i++) {
      historyTurns.splice(0, historyTurns.length, { id: turnId, status: "failed" });
      f.router.observe({
        method: "turn/completed",
        params: {
          threadId: "work",
          turn: { id: turnId, status: "failed", error: { message: "network reset" } },
        },
      });
      await vi.waitFor(
        () => expect(f.requested.filter((entry) => entry.method === "turn/start")).toHaveLength(i),
        { timeout: 10_000, interval: 20 },
      );
      turnId = `continued-${i}`;
    }
    const attempts = f.requested.filter((entry) => entry.method === "turn/start");
    expect(attempts.slice(0, 2).map((entry) => entry.params.model)).toEqual([initial, initial]);
    const last = attempts[2]?.params;
    expect(last).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "readOnly" },
      cwd: f.home,
    });
    expect(last?.model).not.toBe(initial);
    expect(last?.collaborationMode).toMatchObject({ settings: { model: last?.model } });
    expect(last?.input).toEqual([{ type: "text", text: expect.stringContaining("不要盲目重放") }]);
    expect((await f.router.snapshot()).decisions[0]?.acceptedModel).toBe(last?.model);
    f.router.observe({
      method: "turn/completed",
      params: { threadId: "work", turn: { id: turnId, status: "completed" } },
    });
    expect(f.router.hasActiveWork).toBe(false);
  }, 20_000);
  it("uses the requested two tiers even when a name sounds powerful", () => {
    expect(
      ["gpt-6", "openai/gpt-6", "anthropic/claude-opus", "vendor:claude-4"].map(modelTier),
    ).toEqual(["夯", "夯", "夯", "夯"]);
    expect(
      ["deepseek-pro", "gemini-ultra", "o3", "fake-gpt-6", "gpt-image-1"].map(modelTier),
    ).toEqual(["垃", "垃", "垃", "垃", "夯"]);
  });
  it("requires live and native availability and never promotes a weak model", () => {
    const native = {
      ids: new Set(["gpt-6", "deepseek-flash", "gpt-image-1"]),
      contextWindows: new Map<string, number>(),
    };
    const chosen = chooseModels(["gpt-6", "deepseek-flash", "gemini-pro", "gpt-image-1"], native, {
      executor: "gemini-pro",
    });
    expect(chosen.executor).toBe("deepseek-flash");
    expect(chosen.models.find((model) => model.id === "gpt-image-1")?.eligible).toBe(false);
    expect(chooseModels(["gpt-6"], native, {})).toMatchObject({
      planner: "gpt-6",
      executor: null,
    });
  });
  it("does not mistake development of Git features for a Git operation", () => {
    expect(specialist("实现 Git 智能体功能", "git")).toBe("executor");
    expect(specialist("推送代码", "git")).toBe("git");
    expect(specialist("跑起来看看", "project")).toBe("io");
  });
});

describe("Buddy native routing", () => {
  async function parallelFixture() {
    const runSubagents = vi.fn<SubagentRunner>(async (input) => ({
      taskId: input.requestId.split(":").at(-1) ?? "task",
      model: input.model,
      status: "completed",
      summary: "verified",
    }));
    const f = await fixture({
      modelIds: ["gpt-planner", "deepseek-flash", "other-mini"],
      runSubagents,
      plan: {
        version: 1,
        goal: "检查两个独立模块",
        diagnosis: { problem: "待检查", evidence: [], rootCause: "待验证", solution: "分别读取" },
        architecture: { recommendations: [], naming: [], placement: [], boundaries: [] },
        constraints: [],
        tasks: ["alpha", "bravo"].map((id) => ({
          id,
          title: id,
          objective: "只读检查",
          kind: "inspect",
          steps: ["读取文件"],
          acceptance: ["读取成功"],
          dependsOn: [],
          files: [`${id}.ts`],
          packages: [],
          writeScope: "none",
          executorRole: "io",
          risk: "low",
          parallelizable: true,
        })),
        checks: ["两个模块已检查"],
        clarification: null,
        execution: { delegateIndependentTasks: true, maxParallel: 2, delegationReason: "独立检查" },
      },
    });
    await mkdir(join(f.home, "model-router"));
    await writeFile(
      join(f.home, "model-router/policy.json"),
      JSON.stringify({
        planning: {
          executorCapabilities: {
            observedAt: new Date().toISOString(),
            models: [
              { id: "deepseek-flash", efforts: ["low"] },
              { id: "other-mini", efforts: [] },
            ],
          },
        },
      }),
    );
    return { ...f, runSubagents };
  }

  it("keeps a fixed executor alone even when the planner proposes parallel agents", async () => {
    const f = await parallelFixture();
    await f.router.configure({ executorModel: "deepseek-flash" });
    await f.router.route(
      f.turn("重构跨模块实现", { approvalPolicy: "never", sandbox: "danger-full-access" }),
    );
    expect(f.runSubagents).not.toHaveBeenCalled();
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    const guidance = JSON.stringify(f.forwarded[0]?.params);
    expect(guidance).toContain("不要启动、恢复或委派任何子代理");
    expect(guidance).not.toContain("经济型并行候选");
    const decision = (await f.router.snapshot()).decisions[0];
    expect(decision?.involvedModels).toEqual(["deepseek-flash", "gpt-planner"]);
    const packet = JSON.parse(decision?.plan ?? "null");
    expect(packet.plan.execution).toMatchObject({
      delegateIndependentTasks: false,
      maxParallel: 1,
    });
    expect(
      packet.plan.tasks.every((task: { parallelizable: boolean }) => !task.parallelizable),
    ).toBe(true);
    expect(packet.waves.map((wave: { tasks: unknown[] }) => wave.tasks.length)).toEqual([1, 1]);
    expect(
      f.requested.find((request) => request.method === "thread/start")?.params
        .developerInstructions,
    ).toContain("只允许单个执行者串行完成");
  });

  it("allows automatic delegation and retains all selected and reported models", async () => {
    const f = await parallelFixture();
    await f.router.route(
      f.turn("重构跨模块实现", { approvalPolicy: "never", sandbox: "danger-full-access" }),
    );
    expect(f.runSubagents).toHaveBeenCalledTimes(2);
    expect((await f.router.snapshot()).decisions[0]?.involvedModels).toEqual([
      "other-mini",
      "gpt-planner",
      "deepseek-flash",
    ]);
    f.router.observe({ id: 2, result: { turn: { id: "executing" } } });
    f.router.observe({
      method: "turn/started",
      params: { threadId: "work", turn: { id: "executing" } },
    });
    const event = {
      method: "item/completed",
      params: {
        threadId: "work",
        turnId: "executing",
        item: {
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          receiverThreadIds: ["child"],
          model: "reported-model",
        },
      },
    };
    f.router.observe(event);
    f.router.observe(event);
    f.router.observe({
      ...event,
      params: {
        ...event.params,
        turnId: "old",
        item: { ...event.params.item, model: "stale-model" },
      },
    });
    f.router.track({
      id: 22,
      method: "turn/start",
      params: { threadId: "work", model: "recovery-model" },
    });
    f.router.observe({ id: 22, result: { turn: { id: "recovery" } } });
    expect((await f.router.snapshot()).decisions[0]?.involvedModels).toEqual([
      "other-mini",
      "gpt-planner",
      "deepseek-flash",
      "reported-model",
      "recovery-model",
    ]);
    f.router.observe({
      method: "turn/completed",
      params: { threadId: "work", turn: { id: "recovery", status: "completed" } },
    });
    await f.router.route(f.turn("你好"));
    expect((await f.router.snapshot()).decisions[0]?.involvedModels).toEqual(["other-mini"]);
  });

  it("does not replace an unavailable fixed executor", async () => {
    const f = await fixture();
    await f.router.configure({ executorModel: "unavailable-model" });
    await f.router.route(f.turn("重构跨模块实现"));
    expect(f.forwarded).toEqual([]);
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
    expect((await f.router.snapshot()).decisions[0]?.reason).toContain(
      "指定的执行模型 unavailable-model 当前不可用",
    );
  });

  it("exposes multiple supported economic executors without inheriting the old single-model pin", async () => {
    const f = await fixture({ modelIds: ["gpt-planner", "deepseek-flash", "other-mini"] });
    await mkdir(join(f.home, "model-router"));
    await writeFile(
      join(f.home, "model-router/policy.json"),
      JSON.stringify({
        models: {
          "deepseek-flash": { capability: 80, economy: 60 },
          "other-mini": { capability: 75, economy: 90 },
        },
        planning: {
          executorModel: "deepseek-flash",
          executorCapabilities: {
            observedAt: new Date().toISOString(),
            models: [
              { id: "deepseek-flash", efforts: ["low", "high"] },
              { id: "other-mini", efforts: [] },
            ],
          },
        },
      }),
    );
    await f.router.route(f.turn("修改按钮文案"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "other-mini" });
    const guidance = JSON.stringify(f.forwarded[0]?.params);
    expect(guidance).toContain("经济型并行候选");
    expect(guidance).toContain("deepseek-flash");
    expect(guidance).toContain("写入范围不重叠");
    expect(guidance).toContain("不继承整段对话");
  });
  it("uses a lightweight model for greetings without changing explicit Plan Mode", async () => {
    const f = await fixture({ modelIds: ["deepseek-flash"] });
    await f.router.route(f.turn("hi", { collaborationMode: { mode: "plan", settings: {} } }));
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "deepseek-flash",
      collaborationMode: { mode: "plan", settings: { model: "deepseek-flash" } },
    });
    expect(
      f.requested.every((request) => ["thread/read", "model/list"].includes(request.method)),
    ).toBe(true);
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      score: 15,
      plannerModel: null,
    });
  });
  it.each([
    "hi",
    "你好！",
    "谢谢",
    "你是什么模型",
    "What model are you?",
    "解释数据库事务",
    "认证是什么意思？",
    "Explain database migrations",
  ])("skips planning for %s even without a planner model", async (text) => {
    const f = await fixture({ modelIds: ["deepseek-flash"] });
    await f.router.route(f.turn(text));
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]).toMatchObject({
      method: "turn/start",
      params: { model: "deepseek-flash" },
    });
    expect(
      f.requested.every((request) => ["thread/read", "model/list"].includes(request.method)),
    ).toBe(true);
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "executing",
      difficulty: "simple",
      score: 15,
      plannerModel: null,
      plan: null,
    });
  });
  it("keeps a strong-only catalog observable but refuses to use it for execution", async () => {
    const f = await fixture({ modelIds: ["gpt-planner"] });
    expect((await f.router.refreshModels()).models).toEqual([
      { id: "gpt-planner", tier: "夯", eligible: true },
    ]);
    await f.router.route(f.turn("更新README"));
    expect(f.forwarded).toEqual([]);
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "failed",
      acceptedModel: null,
    });
  });
  it("respects explicit plan mode without requiring or starting a weak executor", async () => {
    const f = await fixture({ modelIds: ["gpt-planner"] });
    await f.router.route(
      f.turn("设计数据库迁移", { collaborationMode: { mode: "plan", settings: {} } }),
    );
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "gpt-planner",
      collaborationMode: { mode: "plan" },
    });
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
    expect((await f.router.snapshot()).decisions[0]?.executorModel).toBe(null);
  });
  it.runIf(process.platform !== "win32")(
    "bypasses both discovery and inference and keeps a failing real exit code",
    async () => {
      const f = await fixture();
      await f.router.route(f.turn("查看当前目录文件"));
      expect(f.providerRequests()).toBe(0);
      expect(f.requested).toEqual([]);
      expect(f.forwarded[0]?.method).toBe("thread/shellCommand");
      f.router.observe({ id: 2, result: {} });
      f.router.observe({
        method: "turn/started",
        params: { threadId: "work", turn: { id: "shell", status: "inProgress" } },
      });
      f.router.observe({
        method: "item/completed",
        params: {
          threadId: "work",
          turnId: "shell",
          item: { type: "commandExecution", exitCode: 17, status: "completed" },
        },
      });
      f.router.observe({
        method: "turn/completed",
        params: { threadId: "work", turn: { id: "shell", status: "completed" } },
      });
      expect((await f.router.snapshot()).decisions[0]).toMatchObject({
        phase: "failed",
        exitCode: 17,
        acceptedModel: null,
      });
      expect(f.router.hasActiveWork).toBe(false);
      expect(f.sent[0]).toMatchObject({ id: 2, result: { turn: { id: "shell" } } });
    },
  );
  it.runIf(process.platform === "win32")(
    "keeps POSIX command bypass disabled on Windows",
    async () => {
      const f = await fixture();
      await f.router.route(f.turn("查看当前目录文件"));
      expect(f.providerRequests()).toBe(1);
      expect(f.forwarded[0]?.method).toBe("turn/start");
      expect(f.forwarded.some((request) => request.method === "thread/shellCommand")).toBe(false);
    },
  );
  it("uses the weak model for bounded work and synchronizes nested model settings", async () => {
    const f = await fixture();
    await f.router.route(
      f.turn("更新README", {
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly" },
        collaborationMode: {
          mode: "default",
          settings: {
            model: "gpt-planner",
            reasoning_effort: "high",
            developer_instructions: "保留原要求",
          },
        },
      }),
    );
    expect(f.providerRequests()).toBe(1);
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "deepseek-flash",
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "readOnly" },
      effort: null,
      collaborationMode: { settings: { model: "deepseek-flash", reasoning_effort: null } },
    });
    expect(JSON.stringify(f.forwarded[0]?.params)).toContain("保留原要求");
    expect((await f.router.snapshot()).decisions[0]?.acceptedModel).toBe(null);
    f.router.observe({ id: 2, result: { turn: { id: "execute" } } });
    expect((await f.router.snapshot()).decisions[0]?.acceptedModel).toBe("deepseek-flash");
  });
  it("actually completes a read-only strong planner before starting the weak executor", async () => {
    const f = await fixture();
    await f.router.route(f.turn("重构跨模块的鉴权实现"));
    const planner = f.requested.find((request) => request.method === "thread/start");
    expect(planner?.params).toMatchObject({
      model: "gpt-planner",
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(JSON.stringify(f.forwarded[0]?.params)).toContain("运行对应测试");
    expect(
      f.requested.find((request) => request.method === "thread/read")?.params.includeTurns,
    ).toBe(false);
    const planInput = f.requested.find((request) => request.method === "turn/start")?.params.input;
    expect(JSON.stringify(planInput)).toContain("原需求");
    expect(JSON.stringify(planInput)).toContain("已确认目标目录");
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "executing",
      plannerModel: "gpt-planner",
      executorModel: "deepseek-flash",
      score: 85,
    });
  });
  it.each([
    { planSteps: [], planChecks: [] },
    { planSteps: ["明确边界", "完成改动"], planChecks: [] },
    { planSteps: ["   "], planChecks: ["\n"] },
  ])("accepts lightweight or unnecessary TODOs without rejecting the turn: %j", async (options) => {
    const f = await fixture(options);
    await f.router.route(f.turn("设计数据库迁移方案"));
    expect(f.sent).toEqual([]);
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("executing");
  });
  it("does not classify an unmatched ordinary question as complex", async () => {
    const f = await fixture({ modelIds: ["deepseek-flash"] });
    await f.router.route(f.turn("一句话概括这个项目"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(
      f.requested.every((request) => ["thread/read", "model/list"].includes(request.method)),
    ).toBe(true);
    expect((await f.router.snapshot()).decisions[0]?.score).toBe(45);
  });
  it("cancellation stops planning without executing or replaying the original task", async () => {
    const f = await fixture({ holdPlan: true });
    const routing = f.router.route(f.turn("设计并实现数据库迁移"));
    await vi.waitFor(() =>
      expect(f.requested.some((request) => request.method === "turn/start")).toBe(true),
    );
    expect(f.router.hasActiveWork).toBe(true);
    f.router.cancel("work");
    await routing;
    expect(f.forwarded).toEqual([]);
    expect(f.sent[0]).toMatchObject({ id: 2, error: { code: -32800 } });
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("cancelled");
    expect(f.router.hasActiveWork).toBe(false);
  });
  it("returns clarification to native planning and replans after a short reply", async () => {
    const options = { clarification: "请提供完整页面地址。" };
    const f = await fixture(options);
    const original = f.turn("设计并修复截图中的跨模块问题");
    await f.router.route(original);
    expect(f.sent).toEqual([]);
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]?.params).toMatchObject({
      input: [{ type: "text", text: "设计并修复截图中的跨模块问题" }],
      model: "gpt-planner",
      collaborationMode: { mode: "plan", settings: { model: "gpt-planner" } },
    });
    const guidance = JSON.stringify(f.forwarded[0]?.params);
    expect(guidance).toContain(options.clarification);
    expect(guidance).not.toContain("按以下任务包实施并验收");
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "planning",
      plannerModel: "gpt-planner",
      executorModel: null,
    });
    expect(
      f.router.observe({
        id: "native-question",
        method: "item/tool/requestUserInput",
        params: { threadId: "work" },
      }),
    ).toBe(false);
    f.router.observe({
      method: "turn/completed",
      params: { threadId: "work", turn: { status: "completed" } },
    });
    options.clarification = "";
    await f.router.route(f.turn("hi"));
    expect(f.forwarded[1]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(f.requested.filter((request) => request.method === "turn/start")).toHaveLength(1);
    expect((await f.router.snapshot()).decisions[0]?.score).toBe(15);
    f.router.observe({
      method: "turn/completed",
      params: { threadId: "work", turn: { status: "completed" } },
    });
    await f.router.route(f.turn("https://example.test/page"));
    expect(f.forwarded).toHaveLength(3);
    expect(f.forwarded[2]?.params).toMatchObject({
      model: "deepseek-flash",
      collaborationMode: { mode: "default" },
    });
    const plans = f.requested.filter((request) => request.method === "turn/start");
    expect(plans).toHaveLength(2);
    expect(JSON.stringify(plans[1]?.params.input)).toContain("设计并修复截图中的跨模块问题");
    expect(JSON.stringify(plans[1]?.params.input)).toContain("https://example.test/page");
    expect(JSON.stringify(plans[1]?.params.input)).toContain("原需求");
    expect(f.requested.filter((request) => request.method === "thread/items/list")).toHaveLength(1);
  });
  it.each([
    { code: -32600, message: "thread/items/list is not supported yet" },
    { code: -32601, message: "Method not found" },
  ])("falls back to thread/read for unavailable item listing: $message", async (historyError) => {
    const f = await fixture({
      historyError,
      historyTurns: [
        { items: [{ type: "userMessage", content: [{ type: "text", text: "原需求" }] }] },
        { items: [{ type: "agentMessage", text: "已确认目标目录" }] },
      ],
    });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toHaveLength(1);
    const input = JSON.stringify(
      f.requested.find((request) => request.method === "turn/start")?.params.input,
    );
    expect(input).toContain("原需求");
    expect(input).toContain("已确认目标目录");
    expect(input.indexOf("原需求")).toBeLessThan(input.indexOf("已确认目标目录"));
  });
  it("sends the first message when legacy history has no turns", async () => {
    const f = await fixture({
      historyError: { code: -32600, message: "thread/items/list is not supported yet" },
    });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toHaveLength(1);
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("executing");
  });
  it("keeps long routed history to the recent bounded window", async () => {
    const oldHistory = Array.from({ length: 40 }, (_, index) => ({
      type: "userMessage",
      content: [{ type: "text", text: `OLD_HISTORY_${index}` }],
    }));
    const recent = [
      { type: "agentMessage", text: "RECENT_AGENT" },
      { type: "userMessage", content: [{ type: "text", text: "RECENT_USER" }] },
    ];
    const f = await fixture({ historyItems: [...recent, ...oldHistory.slice(-14).reverse()] });
    await f.router.route(f.turn("设计数据库迁移"));
    const planningInput = JSON.stringify(
      f.requested.find((request) => request.method === "turn/start")?.params.input,
    );
    expect(planningInput).toContain("RECENT_USER");
    expect(planningInput).toContain("RECENT_AGENT");
    expect(planningInput.match(/OLD_HISTORY_\d+/gu)?.length ?? 0).toBeLessThanOrEqual(16);
  });
  it("does not hide unrelated history failures", async () => {
    const f = await fixture({ historyError: { code: -32000, message: "permission denied" } });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toEqual([]);
    expect(f.requested.some((request) => request.params.includeTurns === true)).toBe(false);
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("failed");
  });
  it.each([
    {
      message:
        "thread work is not materialized yet; includeTurns is unavailable before first user message",
      forwarded: 1,
    },
    { message: "permission denied", forwarded: 0 },
  ])("handles legacy history errors narrowly: $message", async ({ message, forwarded }) => {
    const f = await fixture({
      historyError: { code: -32600, message: "thread/items/list is not supported yet" },
      legacyHistoryError: { code: -32600, message },
    });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toHaveLength(forwarded);
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe(
      forwarded ? "executing" : "failed",
    );
  });
  it("does not request unavailable persisted history for an ephemeral thread", async () => {
    const f = await fixture({ ephemeral: true });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.requested.some((request) => request.method === "thread/items/list")).toBe(false);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
  });
  it("rejects hidden planner interaction and releases the native request without execution", async () => {
    const f = await fixture({ interactivePlan: true });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toEqual([]);
    expect(f.replies[0]).toMatchObject({ id: "question", error: { code: -32090 } });
    expect(f.requested.some((request) => request.method === "turn/interrupt")).toBe(true);
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("failed");
  });
  it("planner rejection cannot silently start a strong executor or replay", async () => {
    const f = await fixture({ plannerFails: true });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toEqual([]);
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("failed");
  });
  it("never bypasses a shell expression, a Git write, or unconfirmed permissions", async () => {
    const f = await fixture();
    f.router.track({ id: 3, method: "thread/settings/update", params: { threadId: "work" } });
    await f.router.route(f.turn("pwd", { cwd: f.home }));
    expect(f.forwarded.every((request) => request.method !== "thread/shellCommand")).toBe(true);
    const g = await fixture();
    await g.router.route(g.turn("ls; echo hacked"));
    expect(g.forwarded.every((request) => request.method !== "thread/shellCommand")).toBe(true);
  });
  it("off keeps the original native request path untouched", async () => {
    const f = await fixture();
    await f.router.configure({ enabled: false });
    expect(await f.router.route(f.turn("重构数据库"))).toBe(false);
    expect(f.requested).toEqual([]);
    expect(f.providerRequests()).toBe(0);
  });
  it("assesses a short follow-up against the previous proposal before choosing to plan", async () => {
    const f = await fixture({
      historyItems: [
        { type: "agentMessage", text: "先迁移数据库事务，再跨服务统一认证，最后验证并发登录。" },
        { type: "userMessage", content: [{ type: "text", text: "解决登录不一致" }] },
      ],
    });
    await f.router.route(f.turn("按你说的修"));
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      difficulty: "advanced",
      reason: expect.stringContaining("结合最近任务"),
      plannerModel: "gpt-planner",
    });
    const planner = f.requested.find(
      (request) => request.method === "turn/start" && request.params.threadId === "planner",
    );
    expect(JSON.stringify(planner)).toContain("跨服务统一认证");
  });
  it("uses the thread provider for model discovery and ignores candidates below the input limit", async () => {
    const f = await fixture({
      modelRows: [
        { id: "gpt-planner", contextWindow: 32_000 },
        { id: "tiny-flash", contextWindow: 13_000 },
        { id: "deepseek-flash", contextWindow: 32_000 },
      ],
    });
    await f.router.route(f.turn("修改按钮文案"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(f.providerRequests()).toBe(1);
  });
  it("uses the selected provider's /models endpoint when the thread switches providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "buddy-router-provider-test-"));
    let selectedRequests = 0;
    const selected: Server = createServer((req, res) => {
      selectedRequests += 1;
      expect(req.url).toBe("/v1/models");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "selected-flash" }] }));
    });
    await new Promise<void>((resolve) => selected.listen(0, "127.0.0.1", resolve));
    const address = selected.address();
    if (!address || typeof address === "string") throw new Error("No fixture address");
    await writeFile(
      join(home, "config.toml"),
      `model_provider = "default"\nmodel = "default-planner"\n[model_providers.default]\nbase_url = "http://127.0.0.1:1/v1"\nexperimental_bearer_token = "fixture-only"\n[model_providers.selected]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nexperimental_bearer_token = "fixture-only"\n`,
    );
    const forwarded: JsonRpcRequest[] = [];
    const sent: JsonObject[] = [];
    const router = new BuddyRouter({
      environment: { CODEX_HOME: home },
      request: async (method) => {
        if (method === "thread/read") {
          return {
            result: {
              thread: {
                id: "work",
                cwd: home,
                modelProvider: "selected",
                ephemeral: false,
              },
            },
          };
        }
        if (method === "model/list") {
          return { result: { data: [{ id: "selected-flash" }], nextCursor: null } };
        }
        if (method === "thread/items/list") return { result: { data: [] } };
        if (method === "thread/start") return { result: { thread: { id: "planner" } } };
        if (method === "turn/start") return { result: { turn: { id: "turn" } } };
        return { result: {} };
      },
      send: async (message) => {
        sent.push(message);
      },
      respond: async () => undefined,
      forward: async (request) => {
        forwarded.push(request);
      },
      diagnose: () => undefined,
    });
    router.track({ id: 1, method: "thread/resume", params: { threadId: "work" } });
    router.observe({
      id: 1,
      result: {
        cwd: home,
        modelProvider: "selected",
        model: "default-planner",
        sandbox: { type: "dangerFullAccess" },
        approvalPolicy: "never",
        thread: { id: "work", environments: [{ environmentId: "local" }] },
      },
    });
    cleanups.push(async () => {
      router.close();
      selected.closeAllConnections();
      await new Promise<void>((resolve) => selected.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    });
    await router.route({
      id: 2,
      method: "turn/start",
      params: { threadId: "work", input: [{ type: "text", text: "hi" }] },
    });
    expect(selectedRequests).toBe(1);
    expect(sent).toEqual([]);
    expect(forwarded[0]?.params).toMatchObject({ model: "selected-flash" });
  });
  it.each([
    { ids: ["gpt-planner", "q3-4b", "q3-14b"], preferred: null, expected: "q3-14b" },
    { ids: ["gpt-planner", "q3-4b"], preferred: "gpt-planner", expected: "q3-4b" },
    { ids: ["q3-4b", "q3-14b"], preferred: "q3-4b", expected: "q3-4b" },
    { ids: ["q3-14b"], preferred: "q3-4b", expected: "q3-14b" },
  ])(
    "automatically selects private model $expected from $ids",
    async ({ ids, preferred, expected }) => {
      const f = await fixture({ modelIds: ids });
      await f.router.configure({ privateMode: true, enabled: false, executorModel: preferred });
      await f.router.route(f.turn("设计数据库迁移"));
      expect(f.forwarded).toHaveLength(1);
      expect(f.forwarded[0]?.params).toMatchObject({
        model: expected,
        collaborationMode: { settings: { model: expected } },
      });
      expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
      expect((await f.router.snapshot()).settings.executorModel).toBe(preferred);
    },
  );
  it("never falls back to an online or similarly named model in private mode", async () => {
    const f = await fixture({ modelIds: ["gpt-planner", "deepseek-flash", "q3-4b-online"] });
    await f.router.configure({ privateMode: true });
    await expect(f.router.route(f.turn("SYNTHETIC_PRIVATE"))).rejects.toThrow(
      "没有可用的离线 q3 模型",
    );
    expect(f.forwarded).toEqual([]);
    expect(
      f.requested.every((request) => ["thread/read", "model/list"].includes(request.method)),
    ).toBe(true);
  });
});
