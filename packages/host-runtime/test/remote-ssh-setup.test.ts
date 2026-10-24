import { describe, expect, it } from "vitest";
import { runRemoteSshSetup } from "../src/remote-ssh-setup.js";

describe("Buddy SSH release source", () => {
  it.each(["install", "update"] as const)(
    "rejects %s before launching an upstream npm installer",
    async (action) => {
      await expect(
        runRemoteSshSetup(
          "/unavailable/runtime.mjs",
          {},
          {
            hostname: "ssh-alias",
            port: null,
            identity: null,
            action,
            version: "0.10.123",
          },
        ),
      ).rejects.toThrow("upstream npm versions are not interchangeable");
    },
  );
});
