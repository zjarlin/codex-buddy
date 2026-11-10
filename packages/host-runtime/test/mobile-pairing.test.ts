import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MOBILE_PAIRING_CLIENT_TTL_MS,
  MOBILE_PAIRING_INVITE_TTL_MS,
  MOBILE_PAIRING_MAX_CLIENTS,
} from "@codexhost/shared-contracts";

import { MobilePairingError, MobilePairingStore } from "../src/mobile-pairing.js";

const directories: string[] = [];

async function statePath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codexhost-mobile-pairing-"));
  directories.push(directory);
  return path.join(directory, "mobile-pairing.json");
}

function client(index: number): { clientId: string; label: string } {
  return { clientId: `phone-${String(index).padStart(4, "0")}`, label: `Phone ${index}` };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MobilePairingStore", () => {
  it("redeems an invite once and stores only a token digest", async () => {
    const file = await statePath();
    const now = 1_800_000_000_000;
    const store = new MobilePairingStore({ file, now: () => now });
    const invite = await store.invite();
    const credential = await store.redeem(invite.secret, client(1));

    expect(credential.expiresAt).toBe(now + MOBILE_PAIRING_CLIENT_TTL_MS);
    await expect(store.redeem(invite.secret, client(2))).rejects.toMatchObject({
      code: "invalid-invite",
    });
    const state = await readFile(file, "utf8");
    expect(state).not.toContain(credential.token);
    expect(state).not.toContain(invite.secret);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("expires invites and client pairings", async () => {
    const file = await statePath();
    let now = 1_800_000_000_000;
    const store = new MobilePairingStore({ file, now: () => now });
    const invite = await store.invite();
    now += MOBILE_PAIRING_INVITE_TTL_MS + 1;
    await expect(store.redeem(invite.secret, client(1))).rejects.toMatchObject({
      code: "invalid-invite",
    });

    const fresh = await store.invite();
    const credential = await store.redeem(fresh.secret, client(2));
    now += MOBILE_PAIRING_CLIENT_TTL_MS + 1;
    await expect(
      store.hello({
        schemaVersion: 1,
        kind: "mobile",
        clientId: credential.clientId,
        label: credential.label,
        token: credential.token,
      }),
    ).rejects.toMatchObject({ code: "revoked" });
  });

  it("rejects a wrong token and revokes every connection for one client", async () => {
    const file = await statePath();
    const now = 1_800_000_000_000;
    const store = new MobilePairingStore({ file, now: () => now });
    const invite = await store.invite();
    const credential = await store.redeem(invite.secret, client(1));
    const hello = {
      schemaVersion: 1 as const,
      kind: "mobile" as const,
      clientId: credential.clientId,
      label: credential.label,
      token: credential.token,
    };
    const first = await store.hello(hello);
    const second = await store.hello(hello);
    expect((await store.status()).clients[0]?.connected).toBe(true);
    await expect(store.hello({ ...hello, token: "0".repeat(64) })).rejects.toMatchObject({
      code: "revoked",
    });

    expect(await store.revoke(credential.clientId)).toBe(true);
    await store.disconnect(first);
    await store.disconnect(second);
    await store.disconnect(first);
    expect((await store.status()).clients).toEqual([]);
    await expect(store.hello(hello)).rejects.toMatchObject({ code: "revoked" });
  });

  it("keeps client labels editable and limits the number of paired clients", async () => {
    const file = await statePath();
    const store = new MobilePairingStore({ file, now: () => 1_800_000_000_000 });
    const invite = await store.invite();
    const first = await store.redeem(invite.secret, client(1));
    const hello = {
      schemaVersion: 1 as const,
      kind: "mobile" as const,
      clientId: first.clientId,
      label: "Renamed phone",
      token: first.token,
    };
    await store.hello(hello);
    expect((await store.status()).clients[0]?.label).toBe("Renamed phone");

    for (let index = 2; index <= MOBILE_PAIRING_MAX_CLIENTS; index += 1) {
      const code = await store.invite();
      await store.redeem(code.secret, client(index));
    }
    const extra = await store.invite();
    await expect(
      store.redeem(extra.secret, client(MOBILE_PAIRING_MAX_CLIENTS + 1)),
    ).rejects.toMatchObject({
      code: "full",
    });
  });

  it("restores clients but not open connections after a restart", async () => {
    const file = await statePath();
    const now = 1_800_000_000_000;
    const first = new MobilePairingStore({ file, now: () => now });
    const invite = await first.invite();
    const credential = await first.redeem(invite.secret, client(1));
    await first.hello({
      schemaVersion: 1,
      kind: "mobile",
      clientId: credential.clientId,
      label: credential.label,
      token: credential.token,
    });

    const restarted = new MobilePairingStore({ file, now: () => now });
    const status = await restarted.status();
    expect(status.clients).toMatchObject([
      { clientId: credential.clientId, label: credential.label, connected: false },
    ]);
    await expect(restarted.revoke(credential.clientId)).resolves.toBe(true);
    await expect(
      restarted.hello({
        schemaVersion: 1,
        kind: "mobile",
        clientId: credential.clientId,
        label: credential.label,
        token: credential.token,
      }),
    ).rejects.toBeInstanceOf(MobilePairingError);
  });
});
