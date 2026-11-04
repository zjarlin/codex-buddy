import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import {
  createFixture,
  stopFixture,
  writeRequest,
  requestId,
  readJsonLine,
  startPiThread,
} from "./app-server-host-fixture.js";

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

it("verifies the native thread provider before saving a selection and rejects external Harness threads", async () => {
  const home = await mkdtemp(join(tmpdir(), "host-thread-providers-"));
  await writeFile(
    join(home, "config.toml"),
    '[model_providers.company]\nbase_url = "https://primary.invalid/v1"\n',
  );
  const fixture = createFixture({ buddyRouting: false, environment: { CODEX_HOME: home } });
  try {
    await fixture.ready;
    writeRequest(fixture.desktopInput, {
      id: 101,
      method: PROVIDER_ROUTING_METHOD,
      params: { action: "select", threadId: "native-thread", providerId: "primary:company" },
    });
    const read = await readJsonLine(fixture.official.stdin);
    expect(read).toMatchObject({
      method: "thread/read",
      params: { threadId: "native-thread", includeTurns: false },
    });
    fixture.official.stdout.write(
      JSON.stringify({
        id: read.id,
        result: { thread: { id: "native-thread", modelProvider: "company" } },
      }) + "\n",
    );
    const selected = await fixture.collector.waitFor((message) => requestId(message, 101));
    expect(selected.error).toBeUndefined();
    expect(providerRoutingSnapshotSchema.parse(selected.result).thread).toEqual({
      threadId: "native-thread",
      primaryProviderId: "company",
      providerId: "primary:company",
      covered: true,
    });
    const external = await startPiThread(fixture);
    writeRequest(fixture.desktopInput, {
      id: 102,
      method: PROVIDER_ROUTING_METHOD,
      params: { action: "select", threadId: external, providerId: "primary:company" },
    });
    const rejected = await fixture.collector.waitFor((message) => requestId(message, 102));
    expect(rejected.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining("not connected"),
    });
  } finally {
    await stopFixture(fixture);
    await rm(home, { recursive: true, force: true });
  }
});
