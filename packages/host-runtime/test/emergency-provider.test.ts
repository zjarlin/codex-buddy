import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { EmergencyProviderProxy } from "../src/emergency-provider-proxy.js";

describe("EmergencyProviderProxy", () => {
  let upstreamServer: Server | undefined;
  let proxy: EmergencyProviderProxy | undefined;

  afterEach(async () => {
    await proxy?.close();
    proxy = undefined;
    if (upstreamServer) {
      await new Promise<void>((resolve) => upstreamServer!.close(() => resolve()));
      upstreamServer = undefined;
    }
  });

  it("forwards requests to primary upstream when available", async () => {
    let receivedPath = "";
    let receivedAuth = "";
    upstreamServer = createServer((req, res) => {
      receivedPath = req.url ?? "";
      receivedAuth = req.headers.authorization ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => upstreamServer!.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstreamServer.address() as { port: number }).port;

    proxy = new EmergencyProviderProxy({
      readPrimaryUrl: async () => `http://127.0.0.1:${upstreamPort}`,
      emergencyBaseUrl: "http://127.0.0.1:1/dead",
      emergencyApiKey: "emergency-key",
    });
    const port = await proxy.start();

    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: "Bearer primary-key" },
    });
    expect(response.status).toBe(200);
    expect(receivedPath).toBe("/v1/models");
    expect(receivedAuth).toBe("Bearer primary-key");
  });

  it("falls back to emergency upstream when primary is unreachable", async () => {
    let emergencyHit = false;
    const emergencyServer = createServer((_req, res) => {
      emergencyHit = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ emergency: true }));
    });
    await new Promise<void>((resolve) => emergencyServer.listen(0, "127.0.0.1", resolve));
    const emergencyPort = (emergencyServer.address() as { port: number }).port;

    proxy = new EmergencyProviderProxy({
      readPrimaryUrl: async () => "http://127.0.0.1:1/dead",
      emergencyBaseUrl: `http://127.0.0.1:${emergencyPort}`,
      emergencyApiKey: "emergency-key",
    });
    const port = await proxy.start();

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test" }),
    });
    expect(response.status).toBe(200);
    expect(emergencyHit).toBe(true);
    const body = await response.json();
    expect(body).toEqual({ emergency: true });

    await new Promise<void>((resolve) => emergencyServer.close(() => resolve()));
  });

  it("persists config with 0600 permissions", async () => {
    const home = await mkdtemp(join(tmpdir(), "emergency-provider-test-"));
    try {
      const config = { apiKey: "sk-test", baseURL: "https://example.com", enabled: true };
      const file = join(home, "emergency-provider.json");
      await writeFile(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
      const content = JSON.parse(await readFile(file, "utf8"));
      expect(content.apiKey).toBe("sk-test");
      expect(content.baseURL).toBe("https://example.com");
      expect(content.enabled).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
