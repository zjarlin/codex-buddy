import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonObject, JsonRpcRequest } from "@codexhost/protocol-core";
import { BuddyRouter } from "../../src/buddy/router.js";
import { chooseModels, modelTier } from "../../src/buddy/models.js";
import { TypeSafeClient } from "@codexhost/jev";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((clean) => clean()));
});

/**
 * 让路由用例用 System One 表达分类意图，而不是依赖已删除的本地正则。
 * `conversational` 表示普通问答，`advanced` 表示复杂任务，`push` 表示推送旁路；
 * `forText` 可按请求文本给出不同结论。
 */
interface SystemOneProfile {
  forText?: (text: string) => SystemOneProfile;
  advanced?: boolean;
  conversational?: boolean;
  push?: boolean;
  role?: "git" | "io" | "executor";
  destructive?: boolean;
}

function profileClient(profile: SystemOneProfile): TypeSafeClient {
  const fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      state?: { request?: string };
      questions?: {
        commandIndex?: { criteria?: Record<string, unknown> };
        gitAction?: { criteria?: Record<string, unknown> };
      };
    };
    const resolved =
      typeof profile.forText === "function"
        ? profile.forText(request.state?.request ?? "")
        : profile;
    const criteria = Object.keys(request.questions?.commandIndex?.criteria ?? { none: "" });
    const role = resolved.role ?? "executor";
    const actionCriteria = Object.keys(request.questions?.gitAction?.criteria ?? { none: "" });
    const actionChoice = resolved.push ? "commit-push" : "none";
    const actionSelected = actionCriteria.includes(actionChoice) ? actionChoice : "none";
    const route = resolved.advanced ? "plan" : resolved.conversational ? "inspect" : "code";
    return Response.json(
      {
        model: "typesafe/jev",
        answers: {
          route: {
            type: "choice",
            choice: route,
            probabilities:
              route === "plan"
                ? { code: 0.03, inspect: 0.02, plan: 0.93, other: 0.02 }
                : route === "inspect"
                  ? { code: 0.05, inspect: 0.9, plan: 0.03, other: 0.02 }
                  : { code: 0.9, inspect: 0.05, plan: 0.03, other: 0.02 },
            confidence: 0.92,
          },
          complexity: {
            type: "score",
            score: resolved.advanced ? 2 : resolved.conversational ? 0 : 1,
            legend: {
              "0": "简单：单次读取、信息查询或简短交流",
              "1": "常规：范围明确的小改动或验证",
              "2": "复杂：设计、重构、跨模块或多步骤",
            },
            probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
            confidence: 0.92,
          },
          destructive: { type: "noul", noul: resolved.destructive ? 0.98 : 0.03 },
          push: { type: "noul", noul: resolved.push ? 0.98 : 0.02 },
          gitAction: {
            type: "choice",
            choice: actionSelected,
            probabilities: Object.fromEntries(
              actionCriteria.map((id) => [id, id === actionSelected ? 1 : 0]),
            ),
            confidence: 0.92,
          },
          commitMessage: { type: "noul", noul: resolved.push ? 0.95 : 0.05 },
          role: {
            type: "choice",
            choice: role,
            probabilities: Object.fromEntries(
              ["git", "io", "executor"].map((id) => [id, id === role ? 0.94 : 0.03]),
            ),
            confidence: 0.92,
          },
          conversational: { type: "noul", noul: resolved.conversational ? 0.98 : 0.03 },
          followUp: { type: "noul", noul: 0.03 },
          exactCommand: { type: "noul", noul: 0.02 },
          commandIndex: {
            type: "choice",
            choice: "none",
            probabilities: Object.fromEntries(criteria.map((id) => [id, id === "none" ? 1 : 0])),
            confidence: 0.9,
          },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      },
      { status: 200 },
    );
  });
  return new TypeSafeClient({
    apiKey: "test-only-key",
    baseURL: "https://jev.invalid",
    logLevel: "off",
    retry: { maxRetries: 0 },
    fetch,
  });
}

async function fixture(
  options: {
    ephemeral?: boolean;
    historyError?: { code: number; message: string };
    legacyHistoryError?: { code: number; message: string };
    historyTurns?: JsonObject[];
    historyItems?: JsonObject[];
    modelIds?: string[];
    modelRows?: JsonObject[];
    threadProvider?: string;
    recovery?: boolean;
    compact?: boolean;
    skills?: JsonObject[];
    skillsError?: boolean;
    jev?: TypeSafeClient;
    classify?: SystemOneProfile;
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
  const router: BuddyRouter = new BuddyRouter({
    environment: { CODEX_HOME: home },
    ...(options.jev
      ? { jev: options.jev }
      : options.classify
        ? { jev: profileClient(options.classify) }
        : {}),
    request: async (method, params) => {
      requested.push({ method, params });
      switch (method) {
        case "skills/list":
          return options.skillsError
            ? { error: { code: -1, message: "skills unavailable" } }
            : { result: { data: [{ cwd: home, skills: options.skills ?? [], errors: [] }] } };
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
        case "turn/start": {
          if (options.recovery && params.threadId === "work") {
            const turnId = `continued-${requested.filter((entry) => entry.method === "turn/start").length}`;
            router.observe({
              method: "turn/started",
              params: { threadId: "work", turn: { id: turnId } },
            });
            return { result: { turn: { id: turnId } } };
          }
          throw new Error(`Unexpected internal model call: ${method}`);
        }
        case "thread/compact/start": {
          if (!options.compact) throw new Error("Unexpected compaction");
          router.observe({
            method: "turn/started",
            params: { threadId: "work", turn: { id: "compact" } },
          });
          router.observe({
            method: "item/completed",
            params: { threadId: "work", turnId: "compact", item: { type: "contextCompaction" } },
          });
          options.historyTurns?.splice(0, options.historyTurns.length, {
            id: "compact",
            status: "completed",
            items: [{ type: "contextCompaction" }],
          });
          router.observe({
            method: "turn/completed",
            params: { threadId: "work", turn: { id: "compact", status: "completed" } },
          });
          return { result: {} };
        }
        default:
          return { result: {} };
      }
    },
    send: async (message) => {
      sent.push(message);
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
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return {
    router,
    turn,
    sent,
    forwarded,
    requested,
    home,
    providerRequests: () => providerRequests,
  };
}

// System One 一次批量返回全部原子判断；测试夹具覆盖 Host 实际问的十个问题。
const jevResponse = (
  route: string,
  complexity: number,
  push: number,
  role: string,
  extras: {
    conversational?: number;
    followUp?: number;
    exactCommand?: number;
    command?: string;
    destructive?: number;
    gitAction?: string;
    commitMessage?: number;
  } = {},
) => ({
  model: "typesafe/jev",
  answers: {
    route: {
      type: "choice",
      choice: route,
      probabilities:
        route === "plan"
          ? { code: 0.05, inspect: 0.05, plan: 0.9, other: 0 }
          : route === "inspect"
            ? { code: 0.05, inspect: 0.9, plan: 0.03, other: 0.02 }
            : { code: 0.9, inspect: 0.05, plan: 0.03, other: 0.02 },
      confidence: 0.92,
    },
    complexity: {
      type: "score",
      score: complexity,
      legend: {
        "0": "简单：单次读取、信息查询或简短交流",
        "1": "常规：范围明确的小改动或验证",
        "2": "复杂：设计、重构、跨模块或多步骤",
      },
      probabilities: { "0": 0.1, "1": 0.7, "2": 0.2 },
      confidence: 0.85,
    },
    destructive: { type: "noul", noul: extras.destructive ?? 0.05 },
    push: { type: "noul", noul: push },
    gitAction: {
      type: "choice",
      choice: extras.gitAction ?? (push > 0.5 ? "commit-push" : "none"),
      probabilities: { none: push > 0.5 ? 0 : 1 },
      confidence: 0.92,
    },
    commitMessage: { type: "noul", noul: extras.commitMessage ?? (push > 0.5 ? 0.95 : 0.05) },
    role: {
      type: "choice",
      choice: role,
      probabilities: {
        git: role === "git" ? 0.9 : 0.05,
        io: role === "io" ? 0.9 : 0.05,
        executor: role === "executor" ? 0.9 : 0.05,
      },
      confidence: 0.9,
    },
    conversational: { type: "noul", noul: extras.conversational ?? 0.05 },
    followUp: { type: "noul", noul: extras.followUp ?? 0.05 },
    exactCommand: { type: "noul", noul: extras.exactCommand ?? 0.02 },
    commandIndex: {
      type: "choice",
      choice: extras.command ?? "none",
      // 真实分布由 jevClient 按请求 criteria 重写；此处只保留选择结果。
      probabilities: { none: 1 },
      confidence: extras.command ? 0.95 : 0.9,
    },
  },
  usage: { input_tokens: 100, output_tokens: 0 },
});
// System One 只接受与请求 criteria 完全一致的分布，因此按请求动态补齐选项。
const jevClient = (body: unknown) =>
  new TypeSafeClient({
    apiKey: "test-only-key",
    baseURL: "https://jev.invalid",
    logLevel: "off",
    retry: { maxRetries: 0 },
    fetch: vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        questions?: {
          commandIndex?: { criteria?: Record<string, unknown> };
          gitAction?: { criteria?: Record<string, unknown> };
        };
      };
      const criteria = Object.keys(request.questions?.commandIndex?.criteria ?? { none: "" });
      const answers = {
        ...(
          body as {
            answers: Record<
              string,
              {
                type: string;
                choice?: string;
                probabilities?: Record<string, number>;
                confidence?: number;
              }
            >;
          }
        ).answers,
      };
      const choice = answers.commandIndex?.choice ?? "none";
      const selected =
        choice === "c1"
          ? (Object.entries(request.questions?.commandIndex?.criteria ?? {}).find(
              ([, command]) => command === "ls -la",
            )?.[0] ?? "none")
          : criteria.includes(choice)
            ? choice
            : "none";
      answers.commandIndex = {
        type: "choice",
        choice: selected,
        probabilities: Object.fromEntries(criteria.map((id) => [id, id === selected ? 1 : 0])),
        confidence: 0.95,
      };
      // gitAction 的选项集同样由请求定义；按选择结果重建分布以通过校验。
      const actionCriteria = Object.keys(request.questions?.gitAction?.criteria ?? { none: "" });
      const actionChoice = answers.gitAction?.choice ?? "none";
      const actionSelected = actionCriteria.includes(actionChoice) ? actionChoice : "none";
      answers.gitAction = {
        type: "choice",
        choice: actionSelected,
        probabilities: Object.fromEntries(
          actionCriteria.map((id) => [id, id === actionSelected ? 1 : 0]),
        ),
        confidence: 0.95,
      };
      return Response.json({ ...(body as object), answers }, { status: 200 });
    }),
  });

describe("Buddy family policy", () => {
  it("routes questions to Doubao and the next action back to the Agent", async () => {
    const f = await fixture({
      modelIds: ["gpt-planner", "deepseek-flash", "doubao"],
      classify: {
        forText: (text) => ({ conversational: text.includes("是什么意思"), role: "executor" }),
      },
    });
    await f.router.route(f.turn("数据库事务是什么意思？"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "doubao" });
    expect(JSON.stringify(f.forwarded[0]?.params)).toContain("本回合是纯问答旁路");
    expect(f.requested.some((entry) => entry.method === "thread/start")).toBe(false);
    expect((await f.router.snapshot()).decisions[0]?.reason).toContain("由 doubao 直接回答");
    f.router.observe({
      method: "turn/completed",
      params: { threadId: "work", turn: { id: "answer", status: "completed" } },
    });
    await f.router.route(f.turn("能帮我添加事务吗？"));
    expect(f.forwarded[1]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(JSON.stringify(f.forwarded[1]?.params)).not.toContain("本回合是纯问答旁路");
  });

  it.each([{ bypass: false }, { executorModel: "deepseek-flash" }, { jev: false }])(
    "keeps question bypass subordinate to explicit settings: %j",
    async (settings) => {
      const f = await fixture({
        modelIds: ["deepseek-flash", "doubao"],
        classify: { conversational: true },
      });
      await f.router.configure(settings);
      await f.router.route(f.turn("你好"));
      expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
      expect(JSON.stringify(f.forwarded[0]?.params)).not.toContain("本回合是纯问答旁路");
    },
  );

  it("shows a reason and retains the Agent when Doubao is unavailable", async () => {
    const f = await fixture({ classify: { conversational: true } });
    await f.router.route(f.turn("什么是数据库事务？"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect((await f.router.snapshot()).decisions[0]?.reason).toContain("没有可用 Doubao");
  });

  it("does not plan a complex knowledge question or change explicit Plan Mode", async () => {
    const f = await fixture({
      modelIds: ["gpt-planner", "doubao"],
      jev: jevClient(
        jevResponse("inspect", 2, 0.02, "executor", { conversational: 0.98, gitAction: "none" }),
      ),
    });
    await f.router.route(
      f.turn("解释分布式事务的不同实现", { collaborationMode: { mode: "plan", settings: {} } }),
    );
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "doubao",
      collaborationMode: { mode: "plan" },
    });
    expect(f.requested.some((entry) => entry.method === "thread/start")).toBe(false);
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      score: 15,
    });
  });

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

  it.each(["prompt_too_long", "network reset"])(
    "keeps native sends unchanged with Auto Router off and only compacts overflow: %s",
    async (message) => {
      const historyTurns: JsonObject[] = [{ id: "initial", status: "failed" }];
      const f = await fixture({ recovery: true, compact: true, historyTurns });
      await f.router.configure({ enabled: false });
      const request = f.turn("继续", {
        model: "deepseek-flash",
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly" },
        cwd: f.home,
      });
      const original = structuredClone(request);
      expect(await f.router.route(request)).toBe(false);
      expect(request).toEqual(original);
      f.router.track(request);
      f.router.observe({
        method: "turn/started",
        params: { threadId: "work", turn: { id: "initial" } },
      });
      f.router.observe({
        method: "turn/completed",
        params: { threadId: "work", turn: { id: "initial", status: "failed", error: { message } } },
      });
      if (message === "prompt_too_long") {
        await vi.waitFor(() =>
          expect(f.requested.filter((entry) => entry.method === "turn/start")).toHaveLength(1),
        );
        expect(f.requested.find((entry) => entry.method === "turn/start")?.params).toMatchObject({
          model: "deepseek-flash",
          approvalPolicy: "on-request",
          sandboxPolicy: { type: "readOnly" },
          cwd: f.home,
        });
        expect(
          f.requested.find((entry) => entry.method === "turn/start")?.params.collaborationMode,
        ).toBeUndefined();
        expect(f.requested.filter((entry) => entry.method === "thread/compact/start")).toHaveLength(
          1,
        );
      } else {
        await new Promise((resolve) => setImmediate(resolve));
        expect(f.requested).toEqual([]);
        expect(f.router.hasActiveWork).toBe(false);
      }
      expect(f.providerRequests()).toBe(0);
      expect(f.forwarded).toEqual([]);
    },
  );

  it("automatically compacts an overflow and continues with the original model and permissions", async () => {
    const historyTurns: JsonObject[] = [{ id: "initial", status: "failed" }];
    const f = await fixture({
      recovery: true,
      compact: true,
      historyTurns,
      classify: { conversational: true, role: "executor" },
    });
    await f.router.route(
      f.turn("hi", {
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly" },
        cwd: f.home,
      }),
    );
    const initial = (f.forwarded[0]?.params as JsonObject)?.model;
    f.router.observe({
      method: "turn/started",
      params: { threadId: "work", turn: { id: "initial" } },
    });
    f.router.observe({
      method: "turn/completed",
      params: {
        threadId: "work",
        turn: {
          id: "initial",
          status: "failed",
          error: {
            message: "HTTP 400 prompt is too long: 1232704 tokens > 1048576 maximum",
            code: 11115,
          },
        },
      },
    });
    await vi.waitFor(() =>
      expect(f.requested.filter((entry) => entry.method === "turn/start")).toHaveLength(1),
    );
    const resumed = f.requested.find((entry) => entry.method === "turn/start");
    expect(resumed?.params).toMatchObject({
      model: initial,
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "readOnly" },
      cwd: f.home,
    });
    expect(resumed?.params.collaborationMode).toMatchObject({ settings: { model: initial } });
    expect(resumed?.params.input).toEqual([
      { type: "text", text: expect.stringContaining("不要盲目重放") },
    ]);
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      turnId: "continued-1",
      acceptedModel: initial,
      phase: "executing",
      reason: expect.stringContaining("历史保存已确认"),
    });
    expect(f.requested.filter((entry) => entry.method === "thread/compact/start")).toHaveLength(1);
    historyTurns.splice(0, historyTurns.length, { id: "continued-1", status: "failed" });
    f.router.observe({
      method: "turn/completed",
      params: {
        threadId: "work",
        turn: { id: "continued-1", status: "failed", error: { code: 11115 } },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.requested.filter((entry) => entry.method === "turn/start")).toHaveLength(1);
    expect(f.router.hasActiveWork).toBe(false);
  });

  it("automatically continues native failures and changes both model fields after three failures", async () => {
    const historyTurns: JsonObject[] = [];
    const f = await fixture({
      recovery: true,
      historyTurns,
      modelIds: ["gpt-planner", "cheap-a-flash", "cheap-b-flash"],
      classify: { conversational: true, role: "executor" },
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
  it("keeps open-weight gpt-oss models out of the flagship tier", () => {
    expect(["gpt-oss-20b", "openai/gpt-oss-120b", "vendor:gpt-oss-20b"].map(modelTier)).toEqual([
      "垃",
      "垃",
      "垃",
    ]);
  });
  it("requires live and native availability and allows flagship execution", () => {
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
      executor: "gpt-6",
    });
  });
});

describe("Buddy native routing", () => {
  it("routes an advanced task once to a capable model without internal model turns", async () => {
    const f = await fixture({ classify: { advanced: true } });
    await f.router.route(
      f.turn("重构跨模块鉴权", {
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly" },
      }),
    );
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "gpt-planner",
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "readOnly" },
    });
    expect(
      f.requested.every(({ method }) => !["thread/start", "turn/start"].includes(method)),
    ).toBe(true);
    expect((await f.router.snapshot()).decisions[0]).not.toHaveProperty("plan");
    expect((await f.router.snapshot()).settings).not.toHaveProperty("planning");
  });

  it("keeps an explicit execution model for advanced work without injecting delegation guidance", async () => {
    const f = await fixture({ classify: { advanced: true } });
    await f.router.configure({ executorModel: "deepseek-flash" });
    await f.router.route(f.turn("重构跨模块鉴权"));
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(f.requested.some(({ method }) => method === "thread/start")).toBe(false);
    expect(JSON.stringify(f.forwarded)).not.toContain("经济型并行候选");
  });

  it("ignores old persisted planning choices and does not expose them to the renderer", async () => {
    const f = await fixture({ classify: { advanced: true } });
    await writeFile(
      join(f.home, "buddy-router.json"),
      JSON.stringify({ planning: true, plannerModel: "nonexistent" }),
    );
    await f.router.route(f.turn("重构鉴权"));
    const snapshot = await f.router.snapshot();
    expect(snapshot.settings).not.toHaveProperty("planning");
    expect(snapshot.settings).not.toHaveProperty("plannerModel");
    expect(f.forwarded).toHaveLength(1);
    expect(f.requested.some(({ method }) => method === "thread/start")).toBe(false);
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
    const f = await fixture({
      modelIds: ["gpt-planner", "deepseek-flash", "other-mini"],
      classify: { role: "executor" },
    });
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
    expect(guidance).not.toContain("经济型并行候选");
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
  });
  it("uses a lightweight model for greetings without changing explicit Plan Mode", async () => {
    const f = await fixture({
      modelIds: ["deepseek-flash"],
      classify: { conversational: true, role: "executor" },
    });
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
  ])("answers %s directly with the available execution model", async (text) => {
    const f = await fixture({
      modelIds: ["deepseek-flash"],
      classify: { conversational: true, role: "executor" },
    });
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
    });
  });
  it("uses an available flagship directly when it is the only execution candidate", async () => {
    const f = await fixture({ modelIds: ["gpt-planner"] });
    const refreshed = await f.router.refreshModels();
    expect(refreshed.models).toEqual([{ id: "gpt-planner", tier: "夯", eligible: true }]);
    expect(refreshed.modelRefresh).toEqual({ returned: 1, synchronized: 1, eligible: 1 });
    await f.router.route(f.turn("更新README"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "gpt-planner" });
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "executing",
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
    expect((await f.router.snapshot()).decisions[0]?.executorModel).toBe("gpt-planner");
  });
  it.runIf(process.platform !== "win32")(
    "bypasses both discovery and inference and keeps a failing real exit code",
    async () => {
      // System One 选中项目清单里的 ls -la 候选，Host 直接走零模型旁路。
      const f = await fixture({
        jev: jevClient(
          jevResponse("inspect", 0, 0.02, "io", { exactCommand: 0.98, command: "c1" }),
        ),
      });
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
    const f = await fixture({ classify: { role: "executor" } });
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
  it("does not classify an unmatched ordinary question as complex", async () => {
    const f = await fixture({ modelIds: ["deepseek-flash"], classify: { role: "executor" } });
    await f.router.route(f.turn("一句话概括这个项目"));
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({ phase: "executing" });
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(f.requested.map((request) => request.method)).toEqual(["thread/read", "model/list"]);
    expect((await f.router.snapshot()).decisions[0]?.score).toBe(45);
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
      classify: { advanced: true },
    });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toHaveLength(1);
    expect(f.requested.some((request) => request.method === "turn/start")).toBe(false);
    expect(f.forwarded[0]?.params).toMatchObject({
      input: [{ type: "text", text: "设计数据库迁移" }],
    });
  });
  it("sends the first message when legacy history has no turns", async () => {
    const f = await fixture({
      historyError: { code: -32600, message: "thread/items/list is not supported yet" },
    });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.forwarded).toHaveLength(1);
    expect((await f.router.snapshot()).decisions[0]?.phase).toBe("executing");
  });
  it("does not request unavailable persisted history for an ephemeral thread", async () => {
    const f = await fixture({ ephemeral: true, classify: { role: "executor" } });
    await f.router.route(f.turn("设计数据库迁移"));
    expect(f.requested.some((request) => request.method === "thread/items/list")).toBe(false);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
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
  it("assesses a short follow-up with bounded history without creating another thread", async () => {
    const f = await fixture({
      historyItems: [
        { type: "agentMessage", text: "先迁移数据库事务，再跨服务统一认证，最后验证并发登录。" },
        { type: "userMessage", content: [{ type: "text", text: "解决登录不一致" }] },
      ],
    });
    await f.router.route(f.turn("按你说的修"));
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      reason: expect.stringContaining("结合最近任务"),
    });
    expect(f.forwarded).toHaveLength(1);
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
  });
  it("uses the thread provider for model discovery and ignores candidates below the input limit", async () => {
    const f = await fixture({
      classify: { role: "executor" },
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
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
    { ids: ["gpt-planner", "q3-14b"], preferred: "gpt-planner", expected: "q3-14b" },
    { ids: ["q3-4b", "q3-14b"], preferred: "q3-4b", expected: "q3-4b" },
  ])(
    "migrates legacy privacy settings to ordinary fixed model $expected",
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
      expect((await f.router.snapshot()).settings).toMatchObject({
        privateMode: false,
        executorModel: expected,
      });
    },
  );
  it("preserves native planning, attachments and approvals for migrated q3 settings", async () => {
    const f = await fixture({ modelIds: ["q3-4b"] });
    await f.router.configure({ privateMode: true, executorModel: "q3-4b" });
    const request = f.turn("继续任务");
    request.params = {
      ...(request.params as JsonObject),
      input: [
        { type: "text", text: "继续任务" },
        { type: "image", url: "https://example.test/image.png" },
      ],
      approvalPolicy: "on-request",
      collaborationMode: { mode: "plan", settings: {} },
    };
    await f.router.route(request);
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "q3-4b",
      input: (request.params as JsonObject).input,
      approvalPolicy: "on-request",
      collaborationMode: { mode: "plan", settings: { model: "q3-4b" } },
    });
  });
  it("reports unavailable migrated fixed models through the ordinary route", async () => {
    const f = await fixture({ modelIds: ["gpt-planner", "deepseek-flash", "q3-4b-online"] });
    await f.router.configure({ privateMode: true });
    await f.router.route(f.turn("SYNTHETIC_PRIVATE"));
    expect(f.sent).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: -32090 }) }),
    ]);
    expect(f.forwarded).toEqual([]);
    expect(
      f.requested.every((request) => ["thread/read", "model/list"].includes(request.method)),
    ).toBe(true);
  });
});

describe("Git push model bypass", () => {
  it("skips planning, attaches enabled native skills, and preserves the original input and permissions", async () => {
    const skills = [
      { name: "gitlab", path: "/skills/gitlab/SKILL.md", enabled: true },
      { name: "gh", path: "/skills/gh/SKILL.md", enabled: true },
      { name: "prskill", path: "/skills/prskill/SKILL.md", enabled: true },
      { name: "github-disabled", path: "/skills/disabled/SKILL.md", enabled: false },
      { name: "unrelated", path: "/skills/other/SKILL.md", enabled: true },
    ];
    const f = await fixture({ skills });
    const input = [
      { type: "text", text: "推送代码到 GitLab，先检查跨仓库的冲突和权限" },
      { type: "skill", name: "prskill", path: "/skills/prskill/SKILL.md" },
      { type: "localImage", path: "/tmp/context.png" },
    ];
    const sandboxPolicy = { type: "readOnly" };
    await f.router.route(f.turn("", { input, approvalPolicy: "on-request", sandboxPolicy }));
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
    expect(f.requested.some((request) => request.method === "turn/start")).toBe(false);
    expect(f.requested.find((request) => request.method === "skills/list")?.params).toEqual({
      cwds: [f.home],
      forceReload: true,
    });
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]).toMatchObject({
      method: "turn/start",
      params: {
        model: "deepseek-flash",
        approvalPolicy: "on-request",
        sandboxPolicy,
        input: [
          ...input,
          { type: "skill", name: "gitlab", path: "/skills/gitlab/SKILL.md" },
          { type: "skill", name: "gh", path: "/skills/gh/SKILL.md" },
        ],
        collaborationMode: {
          settings: {
            model: "deepseek-flash",
            developer_instructions: expect.stringContaining("不委派子代理或切换模型"),
          },
        },
      },
    });
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      role: "git",
      command: null,
      executorModel: "deepseek-flash",
      modelBypass: {
        kind: "git-push",
        skills: ["prskill", "gitlab", "gh"],
        skillWarning: null,
        successRate: null,
        total: 0,
      },
    });
  });

  it("uses only the cheap model in Plan Mode without changing the mode", async () => {
    const f = await fixture({ modelIds: ["deepseek-flash"] });
    await f.router.route(f.turn("推送代码", { collaborationMode: { mode: "plan", settings: {} } }));
    expect(f.forwarded[0]?.params).toMatchObject({
      model: "deepseek-flash",
      collaborationMode: {
        mode: "plan",
        settings: { developer_instructions: expect.stringContaining("不执行 Git 写操作") },
      },
    });
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
  });

  it("allows a flagship to execute Git when it is the only eligible model", async () => {
    const f = await fixture({ modelIds: ["gpt-planner"] });
    await f.router.route(f.turn("推送代码"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "gpt-planner" });
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "executing",
      modelBypass: { outcome: "pending", total: 0 },
    });
  });

  it("reports unavailable skills while keeping the cheap execution path", async () => {
    const f = await fixture({ skillsError: true });
    await f.router.route(f.turn("推送代码"));
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toMatchObject({
      skills: [],
      skillWarning: expect.stringContaining("skills unavailable"),
    });
  });

  it("counts each native terminal result once and excludes cancellations and stale turns", async () => {
    const f = await fixture();
    const complete = (id: string, status: string): void => {
      f.router.observe({
        method: "turn/completed",
        params: { threadId: "work", turn: { id, status } },
      });
    };
    const start = async (id: string): Promise<void> => {
      await f.router.route(f.turn("推送代码"));
      f.router.observe({ id: 2, result: { turn: { id } } });
    };
    await start("first");
    complete("stale", "completed");
    expect((await f.router.snapshot()).decisions[0]?.modelBypass?.total).toBe(0);
    complete("first", "completed");
    complete("first", "completed");
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toMatchObject({
      successRate: 100,
      succeeded: 1,
      total: 1,
    });
    await start("second");
    complete("first", "completed");
    complete("second", "failed");
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      phase: "failed",
      modelBypass: { successRate: 50, succeeded: 1, total: 2 },
    });
    expect(f.router.hasActiveWork).toBe(false);
    await start("third");
    complete("third", "interrupted");
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toMatchObject({
      outcome: "cancelled",
      successRate: 50,
      total: 2,
    });
    await f.router.route(f.turn("推送代码"));
    f.router.observe({ id: 2, error: { code: -1, message: "model rejected" } });
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toMatchObject({
      outcome: "failed",
      successRate: 33,
      total: 3,
    });
    await f.router.route(f.turn("修改按钮文案"));
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toBeUndefined();
  });

  it("honors the bypass switch and leaves complex requests on the ordinary route", async () => {
    const f = await fixture();
    await f.router.configure({ bypass: false });
    await f.router.route(f.turn("推送代码，检查跨仓库冲突"));
    expect(f.forwarded).toHaveLength(1);
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toBeUndefined();
  });

  it("loads persisted settings with future keys without rejecting the runtime", async () => {
    const f = await fixture();
    await writeFile(
      join(f.home, "buddy-router.json"),
      JSON.stringify({ enabled: true, planning: true, futureSwitch: "ignored" }),
      { mode: 0o600 },
    );

    expect((await f.router.snapshot()).settings).toMatchObject({
      enabled: true,
    });
    await expect(f.router.configure({ futureSwitch: true } as never)).rejects.toThrow();
  });
});

describe("JEV judgment integration", () => {
  it("adopts the JEV route, role and difficulty and records the judgment", async () => {
    const f = await fixture({
      jev: jevClient(jevResponse("plan", 2, 0.02, "executor")),
      modelIds: ["gpt-planner", "deepseek-flash"],
    });
    await f.router.route(f.turn("实现一个跨模块的认证重构"));
    const decision = (await f.router.snapshot()).decisions[0];
    expect(decision).toMatchObject({
      role: "executor",
      difficulty: "advanced",
      executorModel: "gpt-planner",
      judgment: { source: "system-one", model: "typesafe/jev" },
    });
    expect(decision?.judgment?.decisions.route?.status).toBe("automatic");
  });

  it("routes a JEV-confirmed push to the cheap model without planning", async () => {
    const f = await fixture({ jev: jevClient(jevResponse("code", 1.2, 0.97, "git")) });
    await f.router.route(f.turn("把当前的改动同步到远端仓库"));
    expect(f.requested.some((request) => request.method === "thread/start")).toBe(false);
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      role: "git",
      modelBypass: { kind: "git-push" },
    });
  });

  it("keeps a JEV-negative push mention on the ordinary route", async () => {
    const f = await fixture({ jev: jevClient(jevResponse("code", 2, 0.05, "executor")) });
    await f.router.route(f.turn("推送代码这个功能的旁路要怎么实现"));
    expect((await f.router.snapshot()).decisions[0]).toMatchObject({
      executorModel: "gpt-planner",
    });
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toBeUndefined();
  });

  it("does not bypass when a question scores high on push but System One selects no Git action", async () => {
    const f = await fixture({
      jev: jevClient(
        jevResponse("inspect", 0.4, 0.95, "io", {
          conversational: 0.96,
          gitAction: "none",
        }),
      ),
    });
    await f.router.route(f.turn("推送代码为什么会被旁路？"));
    const decision = (await f.router.snapshot()).decisions[0];
    expect(decision?.modelBypass).toBeUndefined();
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
    expect(f.forwarded[0]?.params).not.toMatchObject({ model: "gpt-planner" });
  });

  it("does not bypass when gitAction stays none despite a high push score on a code turn", async () => {
    const f = await fixture({
      jev: jevClient(jevResponse("code", 1.2, 0.93, "executor", { gitAction: "none" })),
    });
    await f.router.route(f.turn("描述一下推送流程的旁路规则"));
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toBeUndefined();
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
  });

  it("routes each System One Git action to the cheap model with matching guidance", async () => {
    for (const [action, expected] of [
      ["commit", "只提交本地改动"],
      ["commit-push", "提交并推送"],
      ["push", "只推送已有提交"],
      ["sync", "拉取并同步远端"],
      ["merge-continue", "继续进行中的合并"],
    ] as const) {
      const f = await fixture({
        jev: jevClient(jevResponse("code", 1, 0.3, "git", { gitAction: action })),
      });
      await f.router.route(f.turn("处理一下当前的 Git 状态"));
      const decision = (await f.router.snapshot()).decisions[0];
      expect(decision?.modelBypass).toMatchObject({ kind: "git-push" });
      const instructions = String(
        (
          f.forwarded[0]?.params as {
            collaborationMode?: { settings?: { developer_instructions?: string } };
          }
        )?.collaborationMode?.settings?.developer_instructions ?? "",
      );
      expect(instructions).toContain(expected);
      // 推送被拒与冲突消解路径对每个 Git 动作都要交代。
      expect(instructions).toContain("non-fast-forward");
      expect(instructions).toContain("解决冲突");
    }
  });

  it("asks the model to author the commit message only when System One requests it", async () => {
    const authored = await fixture({
      jev: jevClient(
        jevResponse("code", 1, 0.3, "git", { gitAction: "commit", commitMessage: 0.95 }),
      ),
    });
    await authored.router.route(authored.turn("提交当前改动"));
    const instructions = String(
      (
        authored.forwarded[0]?.params as {
          collaborationMode?: { settings?: { developer_instructions?: string } };
        }
      )?.collaborationMode?.settings?.developer_instructions ?? "",
    );
    expect(instructions).toContain("提交消息由你根据真实改动生成");
  });

  it.runIf(process.platform !== "win32")(
    "executes the CLI entry selected by System One without calling a model",
    async () => {
      const f = await fixture({
        modelIds: ["gpt-planner", "deepseek-flash"],
        jev: jevClient(
          jevResponse("inspect", 0, 0.02, "io", { exactCommand: 0.98, command: "c1" }),
        ),
      });
      await f.router.route(f.turn("看看当前目录"));
      expect(f.providerRequests()).toBe(0);
      expect(f.forwarded[0]?.method).toBe("thread/shellCommand");
      expect((await f.router.snapshot()).decisions[0]).toMatchObject({
        phase: "bypass",
        role: "io",
        command: expect.stringContaining("'ls' '-la'"),
      });
    },
  );

  it("keeps a System One 'none' command answer on the ordinary model route", async () => {
    const f = await fixture({ jev: jevClient(jevResponse("code", 1, 0.02, "executor")) });
    await f.router.route(f.turn("看看当前目录"));
    expect(f.forwarded[0]?.method).toBe("turn/start");
    expect(f.forwarded[0]?.params).toMatchObject({ model: "deepseek-flash" });
  });

  it("reads history only when System One reports a follow-up", async () => {
    const plain = await fixture({ jev: jevClient(jevResponse("code", 1, 0.02, "executor")) });
    await plain.router.route(plain.turn("修改按钮文案"));
    expect(plain.requested.some((entry) => entry.method === "thread/items/list")).toBe(false);

    const followUp = await fixture({
      jev: jevClient(jevResponse("plan", 2, 0.02, "executor", { followUp: 0.97 })),
      historyItems: [{ type: "agentMessage", text: "已确认跨服务统一鉴权方案" }],
    });
    await followUp.router.route(followUp.turn("按你说的修"));
    expect(followUp.requested.some((entry) => entry.method === "thread/items/list")).toBe(true);
    expect((await followUp.router.snapshot()).decisions[0]).toMatchObject({
      difficulty: "advanced",
      executorModel: "gpt-planner",
    });
  });

  it("honors the System One model selector for the gateway platform", async () => {
    const f = await fixture({ classify: { role: "executor" } });
    await f.router.configure({ systemOneModel: "laya" });
    await f.router.route(f.turn("修改按钮文案"));
    // 配置通过 settings 持久化，快照可回读；真实平台选择由网关按模型名完成。
    expect((await f.router.snapshot()).settings.systemOneModel).toBe("laya");
  });

  it("falls back to local rules when JEV fails", async () => {
    const failing = new TypeSafeClient({
      apiKey: "k",
      baseURL: "https://jev.invalid",
      logLevel: "off",
      retry: { maxRetries: 0 },
      fetch: vi.fn(async () => Response.json({ error: "down" }, { status: 503 })),
    });
    const f = await fixture({ jev: failing });
    await f.router.route(f.turn("推送代码"));
    const decision = (await f.router.snapshot()).decisions[0];
    expect(decision?.modelBypass).toMatchObject({ kind: "git-push" });
    expect(decision?.judgment).toBeUndefined();
  });

  it("does not call JEV when the switch is off or no client exists", async () => {
    const fetch = vi.fn(async () =>
      Response.json(jevResponse("plan", 2, 0, "executor"), { status: 200 }),
    );
    const f = await fixture({
      jev: new TypeSafeClient({
        apiKey: "k",
        baseURL: "https://jev.invalid",
        logLevel: "off",
        retry: { maxRetries: 0 },
        fetch,
      }),
    });
    await f.router.configure({ jev: false });
    await f.router.route(f.turn("推送代码"));
    expect(fetch).not.toHaveBeenCalled();
    expect((await f.router.snapshot()).decisions[0]?.judgment).toBeUndefined();
    expect((await f.router.snapshot()).decisions[0]?.modelBypass).toMatchObject({
      kind: "git-push",
    });
  });
});

describe("Project Git workflow execution", () => {
  it("uses the Git executor without classification or planning and keeps native permissions", async () => {
    const f = await fixture({
      recovery: true,
      skills: [{ name: "gitlab", path: "/skills/gitlab/SKILL.md", enabled: true }],
    });
    const beforeStart = vi.fn(async () => undefined);
    const turnId = await f.router.startGitWorkflow("work", f.home, "项目推送工作流", beforeStart);
    expect(turnId).toMatch(/^continued-/u);
    expect(beforeStart).toHaveBeenCalledOnce();
    const turn = f.requested.find((entry) => entry.method === "turn/start");
    expect(turn?.params).toMatchObject({ threadId: "work", cwd: f.home, model: "deepseek-flash" });
    expect(turn?.params).not.toHaveProperty("approvalPolicy");
    expect(turn?.params).not.toHaveProperty("sandboxPolicy");
    expect(turn?.params.input).toContainEqual({
      type: "skill",
      name: "gitlab",
      path: "/skills/gitlab/SKILL.md",
    });
    expect(f.requested.some((entry) => entry.method === "thread/start")).toBe(false);
    expect(f.router.activeThreadIds).toContain("work");
    f.router.observe({
      method: "turn/completed",
      params: { threadId: "work", turn: { id: turnId, status: "completed" } },
    });
    expect(f.router.activeThreadIds).not.toContain("work");
  });

  it("rechecks project activity before starting a model turn", async () => {
    const f = await fixture();
    await expect(
      f.router.startGitWorkflow("work", f.home, "推送", async () => {
        throw new Error("project busy");
      }),
    ).rejects.toThrow("project busy");
    expect(f.requested.some((entry) => entry.method === "turn/start")).toBe(false);
    expect(f.router.activeThreadIds).toEqual([]);
  });
});
