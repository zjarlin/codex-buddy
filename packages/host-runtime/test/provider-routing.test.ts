import { createServer, type RequestListener, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRouting } from "../src/provider-routing/routing.js";
import { ProviderRoutingStore } from "../src/provider-routing/store.js";
import { ProviderFailoverProxy, type ProviderTarget } from "../src/provider-routing/proxy.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) {
    await dispose();
  }
  cleanup.length = 0;
});

async function upstream(handler: RequestListener): Promise<string> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("No listener");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function proxy(
  targets: ProviderTarget[],
  options: { firstByteTimeoutMs?: number; cooldownMs?: number } = {},
) {
  const routed = vi.fn();
  const instance = new ProviderFailoverProxy({ targets: async () => targets, routed, ...options });
  await instance.start();
  cleanup.push(() => instance.close());
  return { url: instance.endpoint("gateway"), routed, failures: () => instance.failures(targets) };
}

async function temporaryHome() {
  const home = await mkdtemp(join(tmpdir(), "provider-routing-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  return home;
}

describe("multi-provider failover transport", () => {
  it.each([200, 503])(
    "keeps new endpoint failures when the previous endpoint finishes late with HTTP %s",
    async (status) => {
      const opened = Promise.withResolvers<undefined>();
      let finishPrevious: (() => void) | undefined;
      const primary = await upstream((_request, response) => response.writeHead(503).end());
      const previous = await upstream((_request, response) => {
        finishPrevious = () => response.writeHead(status).end("previous");
        opened.resolve(undefined);
      });
      const replacement = await upstream((_request, response) =>
        response.writeHead(429).end("replacement"),
      );
      const targets = [
        { id: "primary", baseUrl: primary },
        { id: "backup", baseUrl: previous, apiKey: "old-key" },
      ];
      const route = await proxy(targets);
      const first = fetch(route.url + "/responses");
      await opened.promise;
      targets[1] = { id: "backup", baseUrl: replacement, apiKey: "new-key" };
      expect((await fetch(route.url + "/responses")).status).toBe(429);
      finishPrevious?.();
      expect(await (await first).text()).toBe("previous");
      expect(route.failures().find((failure) => failure.provider === "backup")).toMatchObject({
        status: 429,
      });
    },
  );

  it.each(["response.failed", "truncated"])(
    "cools HTTP 200 SSE %s for the next native retry without replaying its stream",
    async (outcome) => {
      const failed =
        'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"server_error"}}}\n\n';
      const incomplete = 'event: response.created\ndata: {"type":"response.created"}\n\n';
      const body = outcome === "response.failed" ? failed : incomplete;
      const primaryHit = vi.fn();
      const primary = await upstream((_request, response) => {
        primaryHit();
        response.writeHead(200, { "content-type": "text/event-stream" }).end(body);
      });
      const backupHit = vi.fn();
      const backup = await upstream((_request, response) => {
        backupHit();
        response.end("recovered");
      });
      const route = await proxy([
        { id: "primary", baseUrl: primary },
        { id: "backup", baseUrl: backup, apiKey: "key" },
      ]);
      expect(await (await fetch(route.url + "/responses")).text()).toBe(body);
      expect(route.routed).not.toHaveBeenCalled();
      expect(backupHit).not.toHaveBeenCalled();
      expect(route.failures()[0]).toMatchObject({
        provider: "primary",
        retryAt: expect.any(Number),
      });
      expect(await (await fetch(route.url + "/responses")).text()).toBe("recovered");
      expect(primaryHit).toHaveBeenCalledTimes(1);
    },
  );

  it("surfaces an SSE authentication error without cooling the provider or marking success", async () => {
    const body = 'event: error\ndata: {"type":"error","code":"invalid_api_key"}\n\n';
    const primary = await upstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" }).end(body);
    });
    const backupHit = vi.fn();
    const backup = await upstream((_request, response) => {
      backupHit();
      response.end("backup");
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    for (let index = 0; index < 2; index++) {
      expect(await (await fetch(route.url + "/responses")).text()).toBe(body);
    }
    expect(route.failures()[0]).toMatchObject({ kind: "http", status: 401, retryAt: 0 });
    expect(route.routed).not.toHaveBeenCalled();
    expect(backupHit).not.toHaveBeenCalled();
  });

  it("preserves the last upstream error and reports a credential-free failure", async () => {
    const baseUrl = await upstream((_request, response) => {
      response.writeHead(429, { "Retry-After": "17" }).end("quota exhausted");
    });
    const route = await proxy([{ id: "backup", baseUrl, apiKey: "fixture-secret" }]);
    const response = await fetch(route.url + "/responses");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(await response.text()).toBe("quota exhausted");
    expect(route.failures()).toEqual([
      {
        provider: "backup",
        kind: "http",
        status: 429,
        at: expect.any(Number),
        retryAt: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(route.failures())).not.toMatch(/fixture-secret|127\.0\.0\.1/);
    expect(route.routed).not.toHaveBeenCalled();
  });

  it("uses an edited endpoint immediately despite an old failure cooldown", async () => {
    const primary = await upstream((_request, response) => response.writeHead(503).end());
    const failing = await upstream((_request, response) => response.writeHead(502).end());
    const recovered = await upstream((_request, response) => response.end("new endpoint"));
    const targets = [
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: failing, apiKey: "old-key" },
    ];
    const route = await proxy(targets);
    expect((await fetch(route.url + "/responses")).status).toBe(502);
    expect(route.failures()).toHaveLength(2);
    targets[1] = { id: "backup", baseUrl: recovered, apiKey: "new-key" };
    expect(route.failures().map((failure) => failure.provider)).toEqual(["primary"]);
    expect(await (await fetch(route.url + "/responses")).text()).toBe("new endpoint");
  });

  it("retries the original upstream for private response IDs even during cooldown", async () => {
    let primaryFailed = true;
    const primaryHit = vi.fn();
    const primary = await upstream((_request, response) => {
      primaryHit();
      response.writeHead(primaryFailed ? 503 : 200).end("primary");
    });
    const backupHit = vi.fn();
    const backup = await upstream((_request, response) => {
      backupHit();
      response.end("fallback");
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    expect(await (await fetch(route.url + "/responses")).text()).toBe("fallback");
    primaryFailed = false;
    const response = await fetch(route.url + "/responses", {
      method: "POST",
      body: JSON.stringify({ previous_response_id: "private-response" }),
    });
    expect(await response.text()).toBe("primary");
    expect(primaryHit).toHaveBeenCalledTimes(2);
    expect(backupHit).toHaveBeenCalledTimes(1);
  });

  it("preserves the primary error for an unparseable body without attempting a fallback", async () => {
    const primary = await upstream((_request, response) =>
      response.writeHead(503).end("primary unavailable"),
    );
    const backupHit = vi.fn();
    const backup = await upstream((_request, response) => {
      backupHit();
      response.end();
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    const response = await fetch(route.url + "/responses", {
      method: "POST",
      body: "malformed JSON",
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("primary unavailable");
    expect(backupHit).not.toHaveBeenCalled();
  });

  it.each(["gzip", "zstd"])(
    "forwards a decoded %s context with the backup model",
    async (encoding) => {
      const primary = await upstream((_request, response) => response.writeHead(503).end());
      let received: unknown;
      let contentEncoding: unknown;
      const backup = await upstream(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        received = JSON.parse(Buffer.concat(chunks).toString());
        contentEncoding = request.headers["content-encoding"];
        response.end("ok");
      });
      const route = await proxy([
        { id: "primary", baseUrl: primary },
        { id: "backup", baseUrl: backup, apiKey: "key", model: "replacement" },
      ]);
      const body = Buffer.from(
        JSON.stringify({ model: "original", input: [{ role: "user", content: "context" }] }),
      );
      const compressed = encoding === "gzip" ? gzipSync(body) : zstdCompressSync(body);
      const response = await fetch(route.url + "/responses", {
        method: "POST",
        headers: { "content-encoding": encoding, "content-type": "application/json" },
        body: new Uint8Array(compressed),
      });
      expect(await response.text()).toBe("ok");
      expect(contentEncoding).toBeUndefined();
      expect(received).toEqual({
        model: "replacement",
        input: [{ role: "user", content: "context" }],
      });
    },
  );

  it("cancels the upstream without starting a fallback when the native client disconnects", async () => {
    const opened = Promise.withResolvers<undefined>();
    const closed = vi.fn();
    const primary = await upstream((_request, response) => {
      response.once("close", closed);
      opened.resolve(undefined);
    });
    const fallback = vi.fn();
    const backup = await upstream((_request, response) => {
      fallback();
      response.end();
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    const controller = new AbortController();
    const response = fetch(route.url + "/responses", { signal: controller.signal });
    const rejected = expect(response).rejects.toThrow();
    await opened.promise;
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(fallback).not.toHaveBeenCalled();
    expect(route.routed).not.toHaveBeenCalled();
    expect(route.failures()).toEqual([]);
  });

  it("keeps primary authentication and its API path", async () => {
    const received = vi.fn();
    const base = await upstream((request, response) => {
      received(request.url, request.headers.authorization);
      response.end("primary");
    });
    const fallback = vi.fn();
    const backup = await upstream((_request, response) => {
      fallback();
      response.end("backup");
    });
    const route = await proxy([
      { id: "primary", baseUrl: base + "/api/v1" },
      { id: "backup", baseUrl: backup, apiKey: "backup-key" },
    ]);
    const response = await fetch(route.url + "/responses?version=1", {
      headers: { Authorization: "Bearer primary-key" },
    });
    expect(await response.text()).toBe("primary");
    expect(received).toHaveBeenCalledWith("/api/v1/responses?version=1", "Bearer primary-key");
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "503", "429"])(
    "continues the same context through ordered fallbacks after %s without leaking credentials",
    async (failure) => {
      const primary = await upstream((request, response) => {
        if (failure === "disconnect") {
          request.socket.destroy();
        } else {
          response.writeHead(Number(failure)).end();
        }
      });
      const second = await upstream((_request, response) => response.writeHead(502).end());
      let received: unknown;
      const third = await upstream(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) {
          chunks.push(chunk);
        }
        received = {
          path: request.url,
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        };
        response.end("continued");
      });
      const route = await proxy([
        { id: "primary", baseUrl: primary },
        { id: "second", baseUrl: second, apiKey: "second-key" },
        { id: "third", baseUrl: third + "/custom/v1", apiKey: "third-key", model: "backup-model" },
      ]);
      const input = [
        { role: "user", content: "Keep this context" },
        { type: "function_call_output", call_id: "completed-tool", output: "already executed" },
      ];
      const response = await fetch(route.url + "/responses?api-key=primary-secret", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer primary-key",
          Cookie: "private=1",
          "X-Api-Key": "private-key",
          "OpenAI-Organization": "private-org",
        },
        body: JSON.stringify({ model: "original", input, tools: [{ name: "fixture" }] }),
      });
      expect(await response.text()).toBe("continued");
      expect(received).toMatchObject({
        path: "/custom/v1/responses",
        headers: { authorization: "Bearer third-key" },
        body: { model: "backup-model", input, tools: [{ name: "fixture" }] },
      });
      expect(JSON.stringify(received)).not.toMatch(
        /primary-secret|primary-key|private-org|private-key|private=1/,
      );
      expect(route.routed).toHaveBeenCalledWith(expect.objectContaining({ id: "third" }), true);
    },
  );

  it.each([400, 401, 403, 422])("surfaces HTTP %s without switching providers", async (status) => {
    const primary = await upstream((_request, response) =>
      response.writeHead(status).end("rejected"),
    );
    const backupHit = vi.fn();
    const backup = await upstream((_request, response) => {
      backupHit();
      response.end();
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    expect((await fetch(route.url + "/responses")).status).toBe(status);
    expect(backupHit).not.toHaveBeenCalled();
    expect(route.routed).not.toHaveBeenCalled();
    expect(route.failures()).toEqual([
      { provider: "primary", kind: "http", status, at: expect.any(Number), retryAt: 0 },
    ]);
  });

  it("switches on a first-byte timeout but permits a long active stream", async () => {
    const primary = await upstream(() => {});
    const backup = await upstream((_request, response) => {
      response.write("first");
      setTimeout(() => response.end("last"), 100);
    });
    const route = await proxy(
      [
        { id: "primary", baseUrl: primary },
        { id: "backup", baseUrl: backup, apiKey: "key" },
      ],
      { firstByteTimeoutMs: 50 },
    );
    expect(await (await fetch(route.url + "/responses")).text()).toBe("firstlast");
    expect(route.failures()[0]?.kind).toBe("timeout");
  });

  it("never splices a fallback into a partial stream and cools the failed provider for native retries", async () => {
    const primaryHit = vi.fn();
    const primary = await upstream((_request, response) => {
      primaryHit();
      response.write("partial");
      setTimeout(() => response.destroy(), 30);
    });
    const backupHit = vi.fn();
    const backup = await upstream((_request, response) => {
      backupHit();
      response.end("recovered");
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    const first = await fetch(route.url + "/responses");
    await expect(first.text()).rejects.toThrow();
    expect(backupHit).not.toHaveBeenCalled();
    expect(await (await fetch(route.url + "/responses")).text()).toBe("recovered");
    expect(primaryHit).toHaveBeenCalledTimes(1);
  });

  it("does not send a provider-private response ID to another upstream", async () => {
    const primary = await upstream((_request, response) => response.writeHead(503).end());
    const backupHit = vi.fn();
    const backup = await upstream((_request, response) => {
      backupHit();
      response.end();
    });
    const route = await proxy([
      { id: "primary", baseUrl: primary },
      { id: "backup", baseUrl: backup, apiKey: "key" },
    ]);
    const response = await fetch(route.url + "/responses", {
      method: "POST",
      body: JSON.stringify({ previous_response_id: "private-response" }),
    });
    expect(response.status).toBe(503);
    expect(backupHit).not.toHaveBeenCalled();
  });

  it("requires the unguessable local route and refuses browser-origin requests", async () => {
    const route = await proxy([]);
    expect((await fetch(new URL("/responses", route.url))).status).toBe(404);
    expect(
      (await fetch(route.url + "/responses", { headers: { Origin: "https://untrusted.invalid" } }))
        .status,
    ).toBe(403);
  });
});

describe("routing configuration and runtime ownership", () => {
  it("can retry startup after a malformed native config is repaired", async () => {
    const home = await temporaryHome();
    await writeFile(join(home, "config.toml"), "invalid = [");
    const routing = new ProviderRouting(home);
    await expect(routing.start()).rejects.toThrow();
    await writeFile(join(home, "config.toml"), "");
    await routing.start();
    cleanup.push(() => routing.close());
    expect((await routing.configure({ action: "read" })).ready).toBe(true);
  });

  it("keeps unsupported endpoints out of the credential-free snapshot and native overrides", async () => {
    const home = await temporaryHome();
    const urls = [
      "invalid",
      "https://user:secret@primary.invalid/v1",
      "https://primary.invalid/v1?api-key=secret",
      "https://primary.invalid/v1#secret",
    ];
    await writeFile(
      join(home, "config.toml"),
      urls
        .map((url, index) => `[model_providers.p${index}]\nbase_url = ${JSON.stringify(url)}\n`)
        .join("\n"),
    );
    const routing = new ProviderRouting(home);
    await routing.start();
    cleanup.push(() => routing.close());
    expect(routing.arguments(["app-server"])).toEqual(["app-server"]);
    expect((await routing.configure({ action: "read" })).primaryProviders).toEqual([]);
  });

  it("allows configuring providers after a partial legacy save", async () => {
    const home = await temporaryHome();
    await writeFile(
      join(home, "emergency-provider.json"),
      JSON.stringify({ apiKey: "unfinished" }),
    );
    expect(await new ProviderRoutingStore(home).read()).toEqual({ enabled: false, providers: [] });
  });

  it("migrates legacy settings once, protects secrets and preserves blank keys on edits", async () => {
    const home = await temporaryHome();
    await writeFile(
      join(home, "emergency-provider.json"),
      JSON.stringify({
        baseURL: "https://backup.invalid/v1",
        apiKey: "legacy-secret",
        enabled: true,
      }),
    );
    const routing = new ProviderRouting(home);
    const first = await routing.configure({ action: "read" });
    expect(first.providers[0]?.keyConfigured).toBe(true);
    expect(JSON.stringify(first)).not.toContain("legacy-secret");
    await routing.configure({
      action: "save",
      provider: {
        id: "legacy-emergency",
        name: "Renamed",
        baseUrl: "https://backup.invalid/v1",
        enabled: true,
        model: "",
      },
    });
    const file = join(home, "provider-routing.json");
    expect(await readFile(file, "utf8")).toContain("legacy-secret");
    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    await routing.configure({ action: "remove", id: "legacy-emergency" });
    expect((await routing.configure({ action: "read" })).providers).toEqual([]);
  });

  it("requires a fresh key for a changed endpoint and serializes concurrent updates", async () => {
    const store = new ProviderRoutingStore(await temporaryHome());
    const provider = {
      id: "one",
      name: "One",
      baseUrl: "https://one.invalid/v1",
      model: "",
      enabled: true,
    };
    await store.update({ action: "save", provider, apiKey: "one-key" });
    await expect(
      store.update({
        action: "save",
        provider: { ...provider, baseUrl: "https://other.invalid/v1" },
      }),
    ).rejects.toThrow("API key");
    await Promise.all([
      store.update({ action: "save", provider: { ...provider, id: "two" }, apiKey: "two-key" }),
      store.update({ action: "configure", enabled: true }),
    ]);
    expect(await store.read()).toMatchObject({
      enabled: true,
      providers: [{ id: "one" }, { id: "two" }],
    });
    await store.update({ action: "move", id: "two", direction: "up" });
    expect((await store.read()).providers.map((value) => value.id)).toEqual(["two", "one"]);
  });

  it("covers every configured custom Responses provider and enables fallbacks without restarting", async () => {
    const home = await temporaryHome();
    const primary = await upstream((_request, response) => response.writeHead(503).end());
    const backup = await upstream((_request, response) => response.end("backup"));
    const config = `model_provider = "company"\n[model_providers.company]\nname = "Company"\nbase_url = "${primary}/v1"\nwire_api = "responses"\n[model_providers.other]\nname = "Other"\nbase_url = "${primary}/other"\n`;
    await writeFile(join(home, "config.toml"), config);
    const routing = new ProviderRouting(home);
    await routing.start();
    cleanup.push(() => routing.close());
    const args = routing.arguments(["app-server"]);
    expect(args).toContain("model_providers.other.supports_websockets=false");
    const route = args.find((value) => value.startsWith("model_providers.company.base_url="));
    if (!route) {
      throw new Error("Missing route");
    }
    const url = JSON.parse(route.slice(route.indexOf("=") + 1)) as string;
    await routing.configure({
      action: "save",
      provider: { id: "backup", name: "Backup", baseUrl: backup, enabled: true, model: "" },
      apiKey: "key",
    });
    await routing.configure({ action: "configure", enabled: true });
    expect(await (await fetch(url + "/responses")).text()).toBe("backup");
    expect(
      (await routing.configure({ action: "read" })).primaryProviders.every(
        (value) => value.covered,
      ),
    ).toBe(true);
    expect(await readFile(join(home, "config.toml"), "utf8")).toBe(config);
  });
});
