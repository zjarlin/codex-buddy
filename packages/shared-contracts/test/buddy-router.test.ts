import { describe, expect, it } from "vitest";
import {
  buddyDecisionSchema,
  buddySettingsSchema,
  buddySnapshotSchema,
} from "../src/buddy-router.js";

describe("Buddy snapshot settings compatibility", () => {
  it("reads old Host settings without forwarding retired planning fields", () => {
    const snapshot = buddySnapshotSchema.parse({
      settings: {
        enabled: true,
        privateMode: true,
        executorModel: "worker",
        planning: true,
        plannerModel: "planner",
      },
      models: [],
      decisions: [],
    });

    expect(snapshot.settings).toMatchObject({
      enabled: true,
      privateMode: false,
      executorModel: "q3-14b",
    });
    expect(snapshot.settings).not.toHaveProperty("planning");
    expect(snapshot.settings).not.toHaveProperty("plannerModel");
    expect(
      buddySettingsSchema.parse({ ...snapshot.settings, enabled: false, privateMode: false }),
    ).toMatchObject({ enabled: false, privateMode: false, executorModel: "q3-14b" });
  });

  it("migrates q3 preferences and allows later unrestricted model selection", () => {
    const migrated = buddySettingsSchema.parse({
      privateMode: true,
      enabled: false,
      executorModel: "q3-4b",
    });
    expect(migrated).toMatchObject({
      privateMode: false,
      enabled: true,
      executorModel: "q3-4b",
      jev: false,
      bypass: false,
    });
    expect(
      buddySettingsSchema.parse({ ...migrated, executorModel: "any-provider-model" }).executorModel,
    ).toBe("any-provider-model");
  });

  it("still rejects unknown fields on settings writes", () => {
    for (const field of ["planning", "plannerModel", "enabeld"]) {
      expect(buddySettingsSchema.safeParse({ [field]: true }).success).toBe(false);
    }
  });

  it("still rejects invalid known settings in Host responses", () => {
    expect(
      buddySnapshotSchema.safeParse({
        settings: { enabled: "true", planning: true },
        models: [],
        decisions: [],
      }).success,
    ).toBe(false);
  });
});

describe("Buddy judgment source", () => {
  const decision = {
    threadId: "work",
    turnId: "turn",
    phase: "completed",
    role: "executor",
    difficulty: "standard",
    score: 45,
    reason: "reason",
    executorModel: "worker",
    acceptedModel: "worker",
    command: null,
    exitCode: null,
    updatedAt: "2026-10-09T00:00:00Z",
  };

  it("reads legacy decisions and preserves the actual source for new decisions", () => {
    expect(buddyDecisionSchema.parse(decision).judgment).toBeUndefined();
    for (const judgment of [
      { source: "system-one", model: "laya", decisions: {} },
      { source: "local-rules", model: null, decisions: {} },
    ]) {
      expect(buddyDecisionSchema.parse({ ...decision, judgment }).judgment).toEqual(judgment);
    }
  });

  it("rejects missing System One models and invented local model answers", () => {
    for (const judgment of [
      { source: "system-one", model: null, decisions: {} },
      { source: "system-one", model: "", decisions: {} },
      { source: "local-rules", model: "laya", decisions: {} },
      { source: "local-rules", model: null, decisions: { route: {} } },
    ]) {
      expect(buddyDecisionSchema.safeParse({ ...decision, judgment }).success).toBe(false);
    }
  });
});
