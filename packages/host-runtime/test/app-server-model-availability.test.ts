import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFixture, stopFixture, writeRequest } from "./app-server-host-fixture.js";

describe("model availability Host RPC", () => {
  it("reads without network and probes asynchronously without creating a Thread", async () => {
    const home = await mkdtemp(join(tmpdir(), "model-availability-host-"));
    const completions: ServerResponse[] = [];
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/v1/models") {
        response.end(JSON.stringify({ data: [{ id: "catalog-model" }] }));
        return;
      }
      completions.push(response);
      request.resume();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing fixture address");
    }
    await writeFile(
      join(home, "config.toml"),
      `model_provider = "fixture"
[model_providers.fixture]
base_url = "http://127.0.0.1:${address.port}/v1"
env_key = "FIXTURE_API_KEY"
wire_api = "responses"
`,
    );
    const fixture = createFixture({
      environment: { CODEX_HOME: home, FIXTURE_API_KEY: "fixture-key" },
    });
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 9100,
        method: "codexhost/models/availability",
        params: { action: "read" },
      });
      expect(await fixture.collector.waitFor((message) => message.id === 9100)).toMatchObject({
        result: { checkedAt: null, results: [] },
      });
      expect(requests).toBe(0);
      writeRequest(fixture.desktopInput, {
        id: 9101,
        method: "codexhost/models/availability",
        params: { action: "probe", modelIds: ["Favorite/Exact:ID"] },
      });
      await vi.waitFor(() => expect(completions).toHaveLength(2));
      writeRequest(fixture.desktopInput, {
        id: 9102,
        method: "codexhost/sessions/loaded/list",
        params: {},
      });
      expect(await fixture.collector.waitFor((message) => message.id === 9102)).toMatchObject({
        result: [],
      });
      for (const response of completions) {
        response.end(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "OK" }],
              },
            ],
          }),
        );
      }
      expect(await fixture.collector.waitFor((message) => message.id === 9101)).toMatchObject({
        result: {
          provider: "fixture",
          results: [
            { id: "catalog-model", status: "available" },
            { id: "Favorite/Exact:ID", status: "available" },
          ],
        },
      });
      expect(fixture.official.stdin.read()).toBeNull();
      expect(fixture.adapter.sessions).toHaveLength(0);
      expect(requests).toBe(3);
    } finally {
      await stopFixture(fixture);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("allows model discovery with legacy privacy settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "model-availability-private-"));
    await writeFile(join(home, "buddy-router.json"), JSON.stringify({ privateMode: true }));
    const fixture = createFixture({ buddyRouting: true, environment: { CODEX_HOME: home } });
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 9200,
        method: "codexhost/models/availability",
        params: { action: "probe" },
      });
      const response = await fixture.collector.waitFor((message) => message.id === 9200);
      expect(response).toMatchObject({ error: { code: -32602 } });
      expect(JSON.stringify(response)).not.toContain("隐私模式");
      writeRequest(fixture.desktopInput, {
        id: 9201,
        method: "codexhost/models/availability",
        params: { action: "read" },
      });
      expect(await fixture.collector.waitFor((message) => message.id === 9201)).toMatchObject({
        result: { checkedAt: null, results: [] },
      });
      expect(fixture.official.stdin.read()).toBeNull();
    } finally {
      await stopFixture(fixture);
      await rm(home, { recursive: true, force: true });
    }
  });
});
