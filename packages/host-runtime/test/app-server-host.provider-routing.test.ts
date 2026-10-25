import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@codexhost/protocol-core";
import { expect, it } from "vitest";
import {
  PROVIDER_ROUTING_METHOD,
  EMERGENCY_PROVIDER_METHOD,
  providerRoutingSnapshotSchema,
  buddySnapshotSchema,
} from "@codexhost/shared-contracts";
import { createFixture, stopFixture, writeRequest, requestId } from "./app-server-host-fixture.js";

it("serves provider settings and the legacy client contract without Buddy routing", async () => {
  const home = await mkdtemp(join(tmpdir(), "host-providers-"));
  const fixture = createFixture({ buddyRouting: false, environment: { CODEX_HOME: home } });
  let nextId = 100;
  const request = async (method: string, params: JsonObject) => {
    const id = ++nextId;
    writeRequest(fixture.desktopInput, { id, method, params });
    const response = await fixture.collector.waitFor((message) => requestId(message, id));
    expect(response.error).toBeUndefined();
    return response;
  };
  try {
    await fixture.ready;
    const saved = await request(PROVIDER_ROUTING_METHOD, {
      action: "save",
      provider: {
        id: "backup",
        name: "Backup",
        baseUrl: "https://backup.invalid/v1",
        enabled: true,
      },
      apiKey: "fixture-secret",
    });
    const snapshot = providerRoutingSnapshotSchema.parse(saved.result);
    expect(snapshot.providers[0]?.keyConfigured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("fixture-secret");
    const legacy = await request(EMERGENCY_PROVIDER_METHOD, {
      apiKey: "legacy-secret",
      baseURL: "https://legacy.invalid/v1",
      enabled: true,
    });
    expect(buddySnapshotSchema.parse(legacy.result)).toMatchObject({
      emergencyConfigured: true,
      emergencyEnabled: true,
      emergencyBaseUrl: "https://legacy.invalid/v1",
    });
    expect(JSON.stringify(legacy)).not.toContain("legacy-secret");
    const cleared = await request(EMERGENCY_PROVIDER_METHOD, {
      apiKey: "",
    });
    expect(buddySnapshotSchema.parse(cleared.result).emergencyConfigured).toBe(false);
    const remaining = await request(PROVIDER_ROUTING_METHOD, {
      action: "read",
    });
    expect(
      providerRoutingSnapshotSchema.parse(remaining.result).providers.map((value) => value.id),
    ).toEqual(["backup"]);
  } finally {
    await stopFixture(fixture);
    await rm(home, { recursive: true, force: true });
  }
});
