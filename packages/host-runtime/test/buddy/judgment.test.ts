import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BuddyRouter } from "../../src/buddy/router.js";
import { TypeSafeClient } from "@codexhost/jev";
import { createJevClient, judgeWithJev } from "../../src/buddy/judgment.js";

function client(body: unknown) {
  const fetch = vi.fn(async () => Response.json(body, { status: 200 }));
  return new TypeSafeClient({
    apiKey: "test-only-key",
    baseURL: "https://jev.invalid",
    defaultModel: "typesafe/jev",
    logLevel: "off",
    retry: { maxRetries: 0 },
    fetch,
  });
}

// System One 一次批量返回全部原子判断；夹具与 judgment.ts 的问题集保持一致。
function response(overrides: Record<string, unknown> = {}) {
  return {
    model: "typesafe/jev",
    answers: {
      route: {
        type: "choice",
        choice: "code",
        probabilities: { code: 0.9, inspect: 0.05, plan: 0.03, other: 0.02 },
        confidence: 0.9,
      },
      complexity: {
        type: "score",
        score: 1.2,
        legend: {
          "0": "简单：单次读取、信息查询或简短交流",
          "1": "常规：范围明确的小改动或验证",
          "2": "复杂：设计、重构、跨模块或多步骤",
        },
        probabilities: { "0": 0.1, "1": 0.7, "2": 0.2 },
        confidence: 0.85,
      },
      destructive: { type: "noul", noul: 0.05 },
      push: { type: "noul", noul: 0.98 },
      role: {
        type: "choice",
        choice: "io",
        probabilities: { git: 0.05, io: 0.9, executor: 0.05 },
        confidence: 0.9,
      },
      conversational: { type: "noul", noul: 0.05 },
      followUp: { type: "noul", noul: 0.02 },
      exactCommand: { type: "noul", noul: 0.02 },
      commandIndex: {
        type: "choice",
        choice: "none",
        // 该夹具不提供候选入口，因此 criteria 只有 none。
        probabilities: { none: 1 },
        confidence: 0.9,
      },
      ...overrides,
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  };
}

describe("JEV judgment", () => {
  it("creates a client only when the key is present", () => {
    expect(createJevClient({})).toBeNull();
    expect(createJevClient({ TYPESAFE_API_KEY: "  " })).toBeNull();
    expect(createJevClient({ TYPESAFE_API_KEY: "k" })).toBeInstanceOf(TypeSafeClient);
  });

  it("sends one batch request and maps route/complexity/push/role into Host fields", async () => {
    const c = client(response());
    const judgment = await judgeWithJev(c, { request: "推送代码", commands: [] });
    expect(judgment.tier).toBe("standard");
    expect(judgment.intent).toBe("project");
    expect(judgment.role).toBe("io");
    expect(judgment.isPush).toBe(true);
    expect(judgment.pushConfidence).toBeCloseTo(0.98);
    expect(judgment.model).toBe("typesafe/jev");
    expect(judgment.decisions.route?.status).toBe("automatic");
  });

  it("raises difficulty for plan routes, high complexity or destructive risk", async () => {
    const plan = await judgeWithJev(
      client(
        response({
          route: {
            type: "choice",
            choice: "plan",
            probabilities: { code: 0.05, inspect: 0.05, plan: 0.9, other: 0 },
            confidence: 0.92,
          },
        }),
      ),
      { request: "重构跨模块认证", commands: [] },
    );
    expect(plan.tier).toBe("advanced");
    const risky = await judgeWithJev(
      client(response({ destructive: { type: "noul", noul: 0.99 } })),
      { request: "删除历史", commands: [] },
    );
    expect(risky.tier).toBe("advanced");
  });

  it("propagates provider errors so the caller can fall back", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "nope" }, { status: 500 }));
    const c = new TypeSafeClient({
      apiKey: "k",
      baseURL: "https://jev.invalid",
      logLevel: "off",
      retry: { maxRetries: 0 },
      fetch,
    });
    await expect(judgeWithJev(c, { request: "任务", commands: [] })).rejects.toBeTruthy();
  });
});

describe("JEV API key persistence", () => {
  const makeRouter = (home: string, injected?: TypeSafeClient) =>
    new BuddyRouter({
      environment: { CODEX_HOME: home },
      ...(injected ? { jev: injected } : {}),
      request: async () => ({ result: {} }),
      send: async () => undefined,
      respond: async () => undefined,
      forward: async () => undefined,
      diagnose: () => undefined,
    });

  it("persists the key to a 0600 file without leaking it into settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "jev-key-test-"));
    const router = makeRouter(home);
    try {
      expect((await router.snapshot()).jevKeyConfigured).toBe(false);
      const snapshot = await router.configureJevKey({ apiKey: "sk-secret-value" });
      expect(snapshot.jevKeyConfigured).toBe(true);
      expect(JSON.stringify(snapshot)).not.toContain("sk-secret-value");
      const info = await stat(join(home, "buddy-jev.json"));
      if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
      const stored = JSON.parse(await readFile(join(home, "buddy-jev.json"), "utf8"));
      expect(stored).toEqual({ apiKey: "sk-secret-value" });
    } finally {
      router.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("persists a custom gateway baseURL and exposes it without the key", async () => {
    const home = await mkdtemp(join(tmpdir(), "jev-key-test-"));
    const router = makeRouter(home);
    try {
      const snapshot = await router.configureJevKey({
        apiKey: "sk-gateway",
        baseURL: "https://sub2api.internal/v1",
      });
      expect(snapshot.jevBaseUrl).toBe("https://sub2api.internal/v1");
      expect(snapshot.jevKeyConfigured).toBe(true);
      // baseURL 可回传，密钥绝不回传。
      expect(JSON.stringify(snapshot)).not.toContain("sk-gateway");
      const stored = JSON.parse(await readFile(join(home, "buddy-jev.json"), "utf8"));
      expect(stored).toEqual({
        apiKey: "sk-gateway",
        baseURL: "https://sub2api.internal/v1",
      });
      // 只改 baseURL 时省略 apiKey，保留已存密钥。
      const updated = await router.configureJevKey({ baseURL: null });
      expect(updated.jevBaseUrl).toBeNull();
      expect(updated.jevKeyConfigured).toBe(true);
      expect(JSON.parse(await readFile(join(home, "buddy-jev.json"), "utf8"))).toEqual({
        apiKey: "sk-gateway",
      });
    } finally {
      router.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("clears the persisted key and reloads it on a fresh router", async () => {
    const home = await mkdtemp(join(tmpdir(), "jev-key-test-"));
    const first = makeRouter(home);
    await first.configureJevKey({ apiKey: "sk-keep" });
    first.close();
    const second = makeRouter(home);
    try {
      expect((await second.snapshot()).jevKeyConfigured).toBe(true);
      const cleared = await second.configureJevKey({ apiKey: null });
      expect(cleared.jevKeyConfigured).toBe(false);
      await expect(stat(join(home, "buddy-jev.json"))).rejects.toThrow();
    } finally {
      second.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects UI key changes when a client was injected by the Host", async () => {
    const home = await mkdtemp(join(tmpdir(), "jev-key-test-"));
    const router = makeRouter(home, client(response()));
    try {
      await expect(router.configureJevKey({ apiKey: "sk-x" })).rejects.toThrow("已由 Host 注入");
    } finally {
      router.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
