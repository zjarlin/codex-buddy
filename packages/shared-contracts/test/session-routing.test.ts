import { describe, expect, it } from "vitest";

import { sessionRouteParamsSchema } from "@codexhost/shared-contracts";

describe("Session routing contracts", () => {
  it("accepts an empty draft because recent history does not depend on message text", () => {
    expect(sessionRouteParamsSchema.parse({ message: "" })).toEqual({ message: "" });
    expect(sessionRouteParamsSchema.parse({ message: "   ", cwd: "/workspace/demo" })).toEqual({
      message: "",
      cwd: "/workspace/demo",
    });
  });

  it("still bounds the optional routing fields", () => {
    expect(sessionRouteParamsSchema.safeParse({ message: "x".repeat(12_001) }).success).toBe(false);
    expect(sessionRouteParamsSchema.safeParse({ message: "", cwd: "" }).success).toBe(false);
  });
});
