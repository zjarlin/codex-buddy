import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSelectionPolicy, type SelectionPolicy } from "../../src/buddy/model-policy.js";
import { chooseModels, discoverModels } from "../../src/buddy/models.js";
import { buddySettingsSchema } from "@codexhost/shared-contracts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

describe("economic execution pools", () => {
  const ids = [
    "gpt-planner",
    "primary-flash",
    "cheap-coder",
    "tiny-reader",
    "specialist",
    "no-tools",
    "not-native",
  ];
  const policy: SelectionPolicy = {
    assessments: new Map([
      ["primary-flash", { capability: 80, economy: 60 }],
      ["cheap-coder", { capability: 75, economy: 90 }],
      ["tiny-reader", { capability: 40, economy: 99 }],
      ["specialist", { capability: 99, economy: 100, purpose: "specialized" }],
      ["no-tools", { capability: 99, economy: 100, tools: false }],
      ["not-native", { capability: 99, economy: 100 }],
    ]),
    standardThreshold: 70,
    clientModels: new Map([
      ["primary-flash", ["low", "high"]],
      ["tiny-reader", []],
    ]),
  };
  const native = {
    ids: new Set(ids.filter((id) => id !== "not-native")),
    contextWindows: new Map<string, number>([
      ["tiny-reader", 13_000],
      ["cheap-coder", 32_000],
      ["primary-flash", 32_000],
    ]),
  };

  it("chooses economy after capability and keeps differently sized child candidates", () => {
    const result = chooseModels(ids, native, {}, { policy, tier: "standard" });
    expect(result.executor).toBe("cheap-coder");
    expect(result.executors.map((model) => model.id)).toEqual(["cheap-coder", "primary-flash"]);
    expect(result.parallelExecutors).toEqual([
      {
        id: "primary-flash",
        capability: 80,
        economy: 60,
        level: "standard",
        efforts: ["low", "high"],
      },
    ]);
    expect(chooseModels(ids, native, {}, { policy, tier: "simple" }).executor).toBe("cheap-coder");
  });

  it("filters known context windows that cannot accept normal routed input", () => {
    const result = chooseModels(
      ids,
      {
        ...native,
        contextWindows: new Map([
          ["cheap-coder", 13_000],
          ["primary-flash", 32_000],
        ]),
      },
      {},
      { policy, tier: "standard" },
    );
    expect(result.executor).toBe("primary-flash");
    expect(result.models.find((model) => model.id === "cheap-coder")?.eligible).toBe(false);
  });

  it("keeps models with unknown context windows rather than inventing a limit", () => {
    const result = chooseModels(
      ids,
      { ids: native.ids, contextWindows: new Map() },
      {},
      { policy, tier: "standard" },
    );
    expect(result.executor).toBe("cheap-coder");
  });

  it("respects an explicit compatible UI preference without removing other candidates", () => {
    const result = chooseModels(
      ids,
      native,
      { executor: "primary-flash" },
      { policy, tier: "standard" },
    );
    expect(result.executor).toBe("primary-flash");
    expect(result.executors).toHaveLength(2);
  });

  it("does not invent child availability when the capability snapshot is absent", () => {
    const result = chooseModels(
      ids,
      native,
      {},
      { policy: { ...policy, clientModels: new Map() }, tier: "standard" },
    );
    expect(result.parallelExecutors).toEqual([]);
    expect(result.executor).toBe("cheap-coder");
  });

  it("uses model_catalog_json context windows when filtering discovery", async () => {
    const home = await mkdtemp(join(tmpdir(), "buddy-model-catalog-"));
    directories.push(home);
    const server: Server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "cheap-coder" }, { id: "primary-flash" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture address");
      await writeFile(
        join(home, "config.toml"),
        `model_provider = "fixture"\nmodel_catalog_json = "catalog.json"\n[model_providers.fixture]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nexperimental_bearer_token = "fixture-only"\n`,
      );
      await writeFile(
        join(home, "catalog.json"),
        JSON.stringify({
          models: [
            { slug: "cheap-coder", context_window: 13_000 },
            { slug: "primary-flash", context_window: 32_000 },
          ],
        }),
      );
      const inventory = await discoverModels({
        home,
        environment: { CODEX_HOME: home },
        settings: buddySettingsSchema.parse({}),
        nativeModels: {
          ids: new Set(["cheap-coder", "primary-flash"]),
          provider: "fixture",
          contextWindows: new Map(),
        },
        signal: AbortSignal.timeout(1_000),
        tier: "standard",
      });
      expect(inventory.executor).toBe("primary-flash");
      expect(inventory.models.find((model) => model.id === "cheap-coder")?.eligible).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("scoped model advice", () => {
  const now = Date.now();
  const connection = {
    providerId: "fixture",
    url: new URL("http://localhost:9876/v1/models"),
    headers: new Headers({ authorization: "Bearer fixture-only" }),
  };
  async function fixture(overrides: Record<string, unknown> = {}, capabilityAge = 0) {
    const home = await mkdtemp(join(tmpdir(), "buddy-model-policy-"));
    directories.push(home);
    const directory = join(home, "model-router");
    await mkdir(directory);
    await writeFile(
      join(directory, "policy.json"),
      JSON.stringify({
        models: { "manual-coder": { capability: 80, economy: 75 } },
        planning: {
          executorModel: "old-pinned-flash",
          executorCapabilities: {
            observedAt: new Date(now - capabilityAge).toISOString(),
            models: [{ id: "cheap-coder", efforts: ["low"] }],
          },
        },
      }),
    );
    await writeFile(
      join(directory, "advice.json"),
      JSON.stringify({
        at: now,
        binding: createHash("sha256")
          .update(`${connection.url.origin}\n${connection.headers.get("authorization")}`)
          .digest("hex"),
        provider: connection.providerId,
        endpoint: connection.url.href,
        models: [{ id: "cheap-coder", capability: 75, economy: 90 }],
        ...overrides,
      }),
    );
    return readSelectionPolicy(home, connection, now);
  }
  it("uses fresh matching advice and explicit overrides", async () => {
    const result = await fixture();
    expect(result.assessments.get("cheap-coder")).toMatchObject({ economy: 90 });
    expect(result.assessments.get("manual-coder")).toMatchObject({ economy: 75 });
    expect(result.clientModels.get("cheap-coder")).toEqual(["low"]);
  });
  it.each([
    { at: now - 25 * 60 * 60 * 1000 },
    { at: now + 1000 },
    { binding: "different-account" },
    { provider: "different-provider" },
    { endpoint: "http://localhost:9876/other/models" },
  ])("ignores stale or differently scoped economic estimates: %j", async (overrides) => {
    const result = await fixture(overrides);
    expect(result.assessments.has("cheap-coder")).toBe(false);
    expect(result.assessments.has("manual-coder")).toBe(true);
  });
  it("rejects stale child model snapshots", async () => {
    const result = await fixture({}, 25 * 60 * 60 * 1000);
    expect(result.clientModels.size).toBe(0);
  });
});
