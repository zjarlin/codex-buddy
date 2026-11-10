import { describe, expect, it } from "vitest";

import {
  MOBILE_PAIRING_CLIENT_TTL_MS,
  MOBILE_PAIRING_INVITE_TTL_MS,
  MOBILE_PAIRING_MAX_CLIENTS,
  mobileClientHelloSchema,
  mobilePairingCredentialSchema,
  mobilePairingInviteSchema,
  mobilePairingRequestSchema,
  mobilePairingStatusSchema,
} from "../src/mobile-pairing.js";

const invite = "a".repeat(64);
const token = "b".repeat(64);

describe("mobile pairing contracts", () => {
  it("accepts one-time invites, per-device credentials, and status without secrets", () => {
    expect(
      mobilePairingInviteSchema.parse({
        schemaVersion: 1,
        origin: "http://192.168.1.20:4500",
        invite,
        expiresAt: 1_800_000_000_000,
      }),
    ).toMatchObject({ invite });
    expect(
      mobilePairingCredentialSchema.parse({
        schemaVersion: 1,
        clientId: "phone-0001",
        label: "Phone",
        token,
        expiresAt: 1_800_000_000_000,
      }),
    ).toMatchObject({ token });
    expect(
      mobilePairingStatusSchema.parse({
        clients: [
          {
            clientId: "phone-0001",
            label: "Phone",
            kind: "mobile",
            connected: true,
            pairedAt: 1,
            lastSeenAt: 2,
          },
        ],
      }),
    ).toMatchObject({ clients: [{ kind: "mobile" }] });
  });

  it("rejects an invite origin with a path, query, or credentials", () => {
    for (const origin of [
      "http://192.168.1.20:4500/path",
      "http://192.168.1.20:4500/?a=1",
      "https://192.168.1.20:4500",
      "http://user:pass@192.168.1.20:4500",
    ]) {
      expect(
        mobilePairingInviteSchema.safeParse({
          schemaVersion: 1,
          origin,
          invite,
          expiresAt: 1,
        }).success,
      ).toBe(false);
    }
  });

  it("binds hello to a mobile kind and a 64-hex token", () => {
    expect(
      mobileClientHelloSchema.parse({
        schemaVersion: 1,
        kind: "mobile",
        clientId: "phone-0001",
        label: "Phone",
        token,
      }),
    ).toMatchObject({ kind: "mobile" });
    expect(
      mobileClientHelloSchema.safeParse({
        schemaVersion: 1,
        kind: "desktop",
        clientId: "phone-0001",
        label: "Phone",
        token,
      }).success,
    ).toBe(false);
    expect(
      mobilePairingRequestSchema.safeParse({ invite, clientId: "phone-0001", label: "Phone" })
        .success,
    ).toBe(true);
  });

  it("keeps the documented limits", () => {
    expect(MOBILE_PAIRING_INVITE_TTL_MS).toBe(5 * 60 * 1000);
    expect(MOBILE_PAIRING_CLIENT_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(MOBILE_PAIRING_MAX_CLIENTS).toBe(16);
  });
});
