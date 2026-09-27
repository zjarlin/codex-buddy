import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";
import { LiveModelCatalog } from "../../src/buddy/live-model-catalog.js";

function model(slug: string, overrides: JsonObject = {}): JsonObject {
  return {
    slug,
    display_name: slug.toUpperCase(),
    description: null,
    supported_reasoning_levels: [],
    visibility: "list",
    supported_in_api: true,
    priority: 0,
    ...overrides,
  };
}

function rows(page: JsonObject): JsonObject[] {
  return page.data as JsonObject[];
}

describe("LiveModelCatalog", () => {
  it("sorts by priority, preserves equal-priority order and selects the first visible API model", () => {
    const catalog = new LiveModelCatalog({
      models: [
        model("last", { priority: 2 }),
        model("hidden", { priority: -1, visibility: "hide" }),
        model("unsupported", { priority: -2, supported_in_api: false }),
        model("first"),
        model("second"),
        model("none", { visibility: "none" }),
      ],
    });
    expect(catalog.visibleIds).toEqual(["first", "second", "last"]);
    expect(rows(catalog.list({})).map((row) => [row.model, row.isDefault])).toEqual([
      ["first", true],
      ["second", false],
      ["last", false],
    ]);
    expect(rows(catalog.list({ includeHidden: true })).map((row) => row.model)).toEqual([
      "hidden",
      "first",
      "second",
      "none",
      "last",
    ]);
  });

  it("projects native reasoning, service, access and upgrade metadata with native defaults", () => {
    const catalog = new LiveModelCatalog({
      models: [
        model("a", {
          default_reasoning_level: "max",
          supported_reasoning_levels: [{ effort: "max", description: "Deep reasoning" }],
          input_modalities: ["text", "audio"],
          model_specialty: "coding",
          multi_agent_version: "v2",
          service_tiers: [{ id: "priority", name: "Fast", description: "Speed" }],
          additional_speed_tiers: ["fast"],
          default_service_tier: "priority",
          availability_nux: { message: "Now available" },
          available_access_programs: { cyber: ["standard", "daybreak_blue", "future_program"] },
          upgrade: {
            model: "b",
            migration_markdown: "Use B",
            retirement_at: "2026-01-01T00:00:00Z",
          },
          context_window: 12345,
        }),
        model("b"),
      ],
    });
    expect(rows(catalog.list({}))[0]).toEqual({
      id: "a",
      model: "a",
      displayName: "A",
      description: "",
      modelSpecialty: "coding",
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: "max", description: "Deep reasoning" }],
      defaultReasoningEffort: "max",
      inputModalities: ["text", "audio"],
      supportsPersonality: false,
      multiAgentVersion: "v2",
      additionalSpeedTiers: ["fast"],
      serviceTiers: [{ id: "priority", name: "Fast", description: "Speed" }],
      defaultServiceTier: "priority",
      availableAccessPrograms: { cyber: ["standard", "daybreakBlue"] },
      availabilityNux: { message: "Now available" },
      upgrade: "b",
      upgradeInfo: {
        model: "b",
        upgradeCopy: null,
        modelLink: null,
        migrationMarkdown: "Use B",
        retirementAt: 1767225600,
      },
      isDefault: true,
    });
    expect(rows(catalog.list({}))[1]).toMatchObject({
      defaultReasoningEffort: "none",
      inputModalities: ["text", "image"],
      supportsPersonality: false,
      multiAgentVersion: null,
      additionalSpeedTiers: [],
      serviceTiers: [],
      defaultServiceTier: null,
      availableAccessPrograms: null,
      availabilityNux: null,
      upgrade: null,
      upgradeInfo: null,
    });
  });

  it("keeps independent immutable snapshots when models are added, removed or emptied", () => {
    const original = model("old");
    const source = { models: [original] };
    const old = new LiveModelCatalog(source);
    original.display_name = "MUTATED";
    const next = new LiveModelCatalog({ models: [model("new")] });
    const response = rows(old.list({}))[0];
    if (!response) {
      throw new Error("Expected the original model");
    }
    response.displayName = "RESPONSE MUTATION";
    (response.inputModalities as string[]).push("audio");
    old.visibleIds.push("not-in-catalog");
    expect(old.visibleIds).toEqual(["old"]);
    expect(rows(old.list({}))[0]).toMatchObject({
      displayName: "OLD",
      inputModalities: ["text", "image"],
    });
    expect(next.visibleIds).toEqual(["new"]);
    expect(new LiveModelCatalog({ models: [] }).list({})).toEqual({ data: [], nextCursor: null });
    expect(() => new LiveModelCatalog({ models: [model("bad", { display_name: 4 })] })).toThrow();
    expect(old.visibleIds).toEqual(["old"]);
  });

  it("retains native forward compatibility for unknown runtimes and malformed retirement metadata", () => {
    const catalog = new LiveModelCatalog({
      models: [
        model("a", {
          multi_agent_version: "future_runtime",
          available_access_programs: { cyber: [] },
          upgrade: { model: "b", migration_markdown: "", retirement_at: "2026-01-01" },
        }),
        model("b", { upgrade: { model: "c", migration_markdown: "", retirement_at: 42 } }),
      ],
    });
    const [first, second] = rows(catalog.list({}));
    expect(first).toMatchObject({
      multiAgentVersion: null,
      availableAccessPrograms: { cyber: [] },
      upgradeInfo: { retirementAt: null },
    });
    expect(second).toMatchObject({ upgradeInfo: { retirementAt: null } });
  });

  it("paginates one snapshot and rejects stale, foreign or mismatched cursors", () => {
    const source = { models: [model("a"), model("b"), model("c", { visibility: "hide" })] };
    const catalog = new LiveModelCatalog(source);
    const first = catalog.list({ limit: 1 });
    expect(rows(first).map((row) => row.model)).toEqual(["a"]);
    const cursor = first.nextCursor;
    if (typeof cursor !== "string") {
      throw new Error("Expected a next-page cursor");
    }
    const second = catalog.list({ cursor, limit: 1 });
    expect(rows(second).map((row) => row.model)).toEqual(["b"]);
    expect(second.nextCursor).toBeNull();
    expect(() => catalog.list({ cursor, includeHidden: true })).toThrow("筛选");
    expect(() => new LiveModelCatalog(source).list({ cursor })).toThrow("过期");
    expect(() => catalog.list({ cursor: "1" })).toThrow("游标无效");
    expect(() => catalog.list({ cursor: "codexhost-catalog:not-json" })).toThrow("游标无效");
  });

  it("honors page boundaries and rejects malformed or excessive parameters", () => {
    const catalog = new LiveModelCatalog({
      models: Array.from({ length: 101 }, (_, i) => model(`${i}`)),
    });
    expect(rows(catalog.list({}))).toHaveLength(100);
    expect(rows(catalog.list({ limit: 0 }))).toHaveLength(1);
    expect(rows(catalog.list({ limit: 1000 }))).toHaveLength(101);
    expect(rows(catalog.list({ limit: 0xffff_ffff }))).toHaveLength(101);
    for (const params of [
      { limit: -1 },
      { limit: 0x1_0000_0000 },
      { limit: 1.5 },
      { limit: "1" },
      { includeHidden: "true" },
    ]) {
      expect(() => catalog.list(params)).toThrow();
    }
  });

  it("marks a hidden model default only when no visible API model exists", () => {
    const catalog = new LiveModelCatalog({ models: [model("hidden", { visibility: "hide" })] });
    expect(catalog.visibleIds).toEqual([]);
    expect(catalog.list({})).toEqual({ data: [], nextCursor: null });
    expect(rows(catalog.list({ includeHidden: true })).map((row) => row.isDefault)).toEqual([true]);
  });

  it.each([
    null,
    "not-json",
    {},
    { models: {} },
    { models: [model("a"), model("a")] },
    { models: [model(" ")] },
    { models: [model("a", { display_name: null })] },
    { models: [model("a", { priority: 0.5 })] },
    { models: [model("a", { supported_in_api: "yes" })] },
    { models: [model("a", { supported_reasoning_levels: [{ effort: "high" }] })] },
    { models: [model("a", { input_modalities: ["video"] })] },
    { models: [model("a", { service_tiers: null })] },
    { models: [model("a", { available_access_programs: { cyber: [3] } })] },
  ])("rejects invalid catalog structure without synthesizing model capabilities: %j", (source) => {
    expect(() => new LiveModelCatalog(source)).toThrow();
  });
});
