import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  JevResponseError,
  RateLimitError,
  TypeSafeClient,
  choice,
  evaluateDecisions,
  noul,
  score,
} from "@codexhost/jev";
import type { DecisionPolicy, Questions } from "@codexhost/jev";

const questions = {
  route: choice("选择任务处理入口", { code: "修改代码", other: "其他任务" }),
  readiness: score("验收证据是否齐全", ["无证据", "仅测试通过", "测试和运行验证均通过"]),
  destructive: noul("工具是否会删除已有数据"),
};
const policies = {
  route: { automatic: 0.85, review: 0.6 },
  readiness: { automatic: 0.9, review: 0.6 },
  destructive: { automatic: 0.95, review: 0.75 },
};

function response() {
  return {
    model: "jev-test",
    answers: {
      route: {
        type: "choice",
        choice: "code",
        probabilities: { code: 0.9, other: 0.1 },
        confidence: 0.88,
      },
      readiness: {
        type: "score",
        score: 1.6,
        legend: { "0": "无证据", "1": "仅测试通过", "2": "测试和运行验证均通过" },
        probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 },
        confidence: 0.78,
      },
      destructive: { type: "noul", noul: 0.01 },
    },
    usage: { input_tokens: 120, output_tokens: 0 },
  };
}

function setup(body: unknown = response(), status = 200) {
  const fetch = vi.fn(async () => Response.json(body, { status }));
  const client = new TypeSafeClient({
    apiKey: "test-only-key",
    baseURL: "https://jev.invalid",
    defaultModel: "jev-latest",
    logLevel: "off",
    retry: { maxRetries: 0 },
    fetch,
  });
  return { client, fetch };
}

afterEach(() => vi.unstubAllEnvs());

describe("Jev batch evaluation", () => {
  it("sends one native request and preserves typed answers and usage", async () => {
    const { client, fetch } = setup();
    const state = { request: "修复登录", tool: { name: "read_file", path: "src/login.ts" } };
    const result = await evaluateDecisions(client, { state, questions }, policies);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://jev.invalid/v1/systemone");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-only-key");
    expect(JSON.parse(String(init.body))).toEqual({ model: "jev-latest", state, questions });
    expect(result.answers).toEqual(response().answers);
    expect(result.model).toBe("jev-test");
    expect(result.usage.input_tokens).toBe(120);
    expect(result.decisions.route.status).toBe("automatic");
    expect(result.decisions.readiness.status).toBe("review");
    expect(result.decisions.destructive).toEqual({
      status: "automatic",
      basis: "outcome-probability",
      strength: 0.99,
    });
    expectTypeOf(result.answers.route.choice).toEqualTypeOf<"code" | "other">();
    expectTypeOf(result.answers.destructive.noul).toEqualTypeOf<number>();
    expectTypeOf(result.answers.readiness.score).toEqualTypeOf<number>();
  });

  it.each([
    [0.5, "defer"],
    [0.74, "defer"],
    [0.75, "review"],
    [0.95, "automatic"],
    [0.04, "automatic"],
  ])("interprets Noul %s with two-sided probability thresholds", async (value, status) => {
    const { client } = setup({
      ...response(),
      answers: { judgment: { type: "noul", noul: value } },
    });
    const result = await evaluateDecisions(
      client,
      { state: "待判断", questions: { judgment: noul("是否需要升级处理") } },
      { judgment: { automatic: 0.95, review: 0.75 } },
    );
    expect(result.decisions.judgment.status).toBe(status);
    expect(result.answers.judgment.noul).toBe(value);
  });

  it("requires both Choice confidence and selected probability", async () => {
    const body = response();
    body.answers.route.confidence = 0.99;
    body.answers.route.probabilities = { code: 0.55, other: 0.45 };
    const { client } = setup(body);
    const result = await evaluateDecisions(client, { state: "任务", questions }, policies);
    expect(result.decisions.route.status).toBe("defer");
  });

  it("snapshots questions and policies and does not send extra request fields", async () => {
    const { client, fetch } = setup();
    const localQuestions = structuredClone(questions);
    const localPolicies = structuredClone(policies);
    const request = {
      state: "任务",
      questions: localQuestions,
      model: "jev-pinned",
      private: "local",
    };
    const pending = evaluateDecisions(client, request, localPolicies);
    Reflect.set(localQuestions.route.criteria, "code", "已修改");
    localPolicies.route.automatic = 1;
    const result = await pending;
    expect(result.decisions.route.status).toBe("automatic");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      state: "任务",
      model: "jev-pinned",
      questions,
    });
  });

  it.each([
    { automatic: 0.8, review: 0.8 },
    { automatic: 1.1, review: 0.6 },
    { automatic: NaN, review: 0.6 },
    { automatic: 0.8, review: -1 },
    { automatic: 0.8, review: 0.5 },
  ])("rejects unsafe or invalid Noul thresholds before sending", async (policy) => {
    const { client, fetch } = setup();
    await expect(
      evaluateDecisions(client, { state: "任务", questions }, { ...policies, destructive: policy }),
    ).rejects.toThrow("Jev policy");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects missing policy, empty batch, and invalid Choice sizes before sending", async () => {
    const { client, fetch } = setup();
    const missing: Record<string, DecisionPolicy> = {};
    const dynamicQuestions: Questions = { a: noul("判断") };
    await expect(
      evaluateDecisions(client, { state: "任务", questions: dynamicQuestions }, missing),
    ).rejects.toThrow("Jev policy");
    await expect(evaluateDecisions(client, { state: "任务", questions: {} }, {})).rejects.toThrow();
    for (const count of [0, 256]) {
      const criteria = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [index, null]),
      );
      await expect(
        evaluateDecisions(
          client,
          { state: "任务", questions: { a: choice("判断", criteria) } },
          { a: policies.route },
        ),
      ).rejects.toThrow("1 and 255");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing answer",
      (body: ReturnType<typeof response>) => Reflect.deleteProperty(body.answers, "route"),
    ],
    ["wrong type", (body: ReturnType<typeof response>) => (body.answers.route.type = "score")],
    [
      "unknown choice",
      (body: ReturnType<typeof response>) => (body.answers.route.choice = "unknown"),
    ],
    [
      "nonwinning choice",
      (body: ReturnType<typeof response>) => (body.answers.route.choice = "other"),
    ],
    [
      "bad probability",
      (body: ReturnType<typeof response>) => (body.answers.destructive.noul = 1.2),
    ],
    ["bad confidence", (body: ReturnType<typeof response>) => (body.answers.route.confidence = -1)],
    [
      "unnormalized distribution",
      (body: ReturnType<typeof response>) => (body.answers.route.probabilities.code = 0.7),
    ],
    [
      "out of range score",
      (body: ReturnType<typeof response>) => (body.answers.readiness.score = 3),
    ],
    [
      "changed legend",
      (body: ReturnType<typeof response>) => (body.answers.readiness.legend["0"] = "其他"),
    ],
    [
      "missing level",
      (body: ReturnType<typeof response>) =>
        Reflect.deleteProperty(body.answers.readiness.probabilities, "0"),
    ],
  ])("rejects %s instead of manufacturing a decision", async (_, mutate) => {
    const body = response();
    mutate(body);
    const { client } = setup(body);
    await expect(
      evaluateDecisions(client, { state: "任务", questions }, policies),
    ).rejects.toBeInstanceOf(JevResponseError);
  });

  it("rejects malformed responses without echoing their body", async () => {
    const { client } = setup("private upstream content");
    await expect(evaluateDecisions(client, { state: "任务", questions }, policies)).rejects.toThrow(
      "Invalid Jev response: answer or metadata fields do not match the System One schema",
    );
  });

  it.each([
    [401, AuthenticationError],
    [429, RateLimitError],
  ] as const)("preserves SDK error for HTTP %s", async (status, error) => {
    const { client, fetch } = setup({ error: "test failure" }, status);
    await expect(
      evaluateDecisions(client, { state: "任务", questions }, policies),
    ).rejects.toBeInstanceOf(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses the SDK retry policy for overload responses", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ error: "overloaded" }, { status: 529 }));
    await evaluateDecisions(client, { state: "任务", questions }, policies, {
      retry: { maxRetries: 1, backoffInitialMs: 0, backoffMaxMs: 0 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not send already-cancelled work", async () => {
    const { client, fetch } = setup();
    await expect(
      evaluateDecisions(client, { state: "任务", questions }, policies, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["timeout", "cancel"])("propagates %s without a decision", async (mode) => {
    const controller = new AbortController();
    const client = new TypeSafeClient({
      apiKey: "test-only-key",
      logLevel: "off",
      retry: { maxRetries: 0 },
      fetch: async (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
          if (mode === "cancel") {
            controller.abort();
          }
        }),
    });
    await expect(
      evaluateDecisions(client, { state: "任务", questions }, policies, {
        timeout: 10,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(mode === "timeout" ? APITimeoutError : APIUserAbortError);
  });

  it("uses the official environment-based credential configuration", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-env-key");
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-env-key");
      return Response.json(response());
    });
    const client = new TypeSafeClient({ fetch, logLevel: "off" });
    await evaluateDecisions(client, { state: "任务", questions }, policies);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
