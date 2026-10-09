import { describe, expect, it } from "vitest";
import { buddySettingsSchema, buddySnapshotSchema } from "../src/buddy-router.js";

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
      privateMode: true,
      executorModel: "worker",
    });
    expect(snapshot.settings).not.toHaveProperty("planning");
    expect(snapshot.settings).not.toHaveProperty("plannerModel");
    expect(
      buddySettingsSchema.parse({ ...snapshot.settings, enabled: false, privateMode: false }),
    ).toMatchObject({ enabled: false, privateMode: false, executorModel: "worker" });
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
