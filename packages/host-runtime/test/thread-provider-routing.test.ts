import { createServer, type RequestListener } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { ProviderRouting } from "../src/provider-routing/routing.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function upstream(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function fixture(primaryStatus = 200) {
  const seen: {
    provider: string;
    authorization: string | undefined;
    cookie: string | undefined;
    body: unknown;
  }[] = [];
  const handler =
    (provider: string, status: number): RequestListener =>
    async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      seen.push({
        provider,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      response.writeHead(status).end(provider);
    };
  const primary = await upstream(handler("primary", primaryStatus));
  const backup = await upstream(handler("backup", 200));
  const home = await mkdtemp(join(tmpdir(), "thread-provider-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(home, "config.toml"),
    `[model_providers.company]\nbase_url = "${primary}"\nwire_api = "responses"\n`,
  );
  const start = async () => {
    const routing = new ProviderRouting(home);
    await routing.start();
    cleanups.push(() => routing.close());
    const override = routing
      .arguments(["app-server"])
      .find((arg) => arg.startsWith("model_providers.company.base_url="));
    if (!override) throw new Error("Proxy override missing");
    const endpoint = JSON.parse(override.slice(override.indexOf("=") + 1));
    const request = (
      threadId = "thread-a",
      body = { model: "native", input: [{ role: "user", content: "keep history" }] } as Record<
        string,
        unknown
      >,
      metadata = false,
    ) =>
      fetch(`${endpoint}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer primary-secret",
          Cookie: "private=primary",
          ...(metadata
            ? {
                "x-codex-turn-metadata": JSON.stringify({ thread_id: threadId, turn_id: "turn-a" }),
              }
            : { session_id: threadId }),
        },
        body: JSON.stringify(body),
      });
    return { routing, request };
  };
  const started = await start();
  await started.routing.configure({
    action: "save",
    provider: {
      id: "backup",
      name: "Backup",
      baseUrl: backup,
      enabled: false,
      model: "replacement",
    },
    apiKey: "backup-secret",
  });
  const threadId = hostThreadIdSchema.parse("thread-a");
  const thread = { threadId, primaryProviderId: "company" };
  return {
    ...started,
    home,
    seen,
    start,
    thread,
    select: (providerId: string | null) =>
      started.routing.configure({ action: "select", threadId, providerId }, thread),
  };
}

it.each([false, true])(
  "pins only the selected thread with its own credentials and full context (metadata=%s)",
  async (metadata) => {
    const { select, request, seen, start } = await fixture();
    const selected = await select("backup");
    expect(selected.enabled).toBe(false);
    expect(selected.thread).toMatchObject({ providerId: "backup", covered: true });
    expect(JSON.stringify(selected)).not.toContain("secret");
    expect(await (await request("thread-a", undefined, metadata)).text()).toBe("backup");
    expect(seen[0]).toEqual({
      provider: "backup",
      authorization: "Bearer backup-secret",
      cookie: undefined,
      body: { model: "replacement", input: [{ role: "user", content: "keep history" }] },
    });
    expect(await (await request("thread-b")).text()).toBe("primary");
    expect(seen[1]?.authorization).toBe("Bearer primary-secret");
    const restarted = await start();
    expect(await (await restarted.request()).text()).toBe("backup");
    await select("primary:company");
    expect(await (await request()).text()).toBe("primary");
    await select(null);
    expect(await (await request()).text()).toBe("primary");
  },
);

it("recovers HTTP 502 automatically after returning a pinned thread to automatic routing", async () => {
  const { routing, select, request, seen } = await fixture(502);
  const config = await routing.store.read();
  const provider = config.providers[0];
  if (!provider) throw new Error("Missing backup provider");
  await routing.configure({ action: "save", provider: { ...provider, enabled: true } });
  await routing.configure({ action: "configure", enabled: true });
  await select("primary:company");
  expect((await request()).status).toBe(502);
  expect(seen.map((entry) => entry.provider)).toEqual(["primary"]);
  await select(null);
  expect(await (await request()).text()).toBe("backup");
  expect(seen.map((entry) => entry.provider)).toEqual(["primary", "backup"]);
});

it("refuses a private response ID on a manually selected gateway without contacting either upstream", async () => {
  const { select, request, seen } = await fixture();
  await select("backup");
  const response = await request("thread-a", {
    model: "native",
    previous_response_id: "private-id",
  });
  expect(response.status).toBe(409);
  expect(seen).toHaveLength(0);
});

it("rejects unknown providers and uncovered threads and clears selections when deleting a gateway", async () => {
  const { routing, select, thread } = await fixture();
  await expect(select("missing")).rejects.toThrow("Unknown thread provider");
  await expect(
    routing.configure(
      { action: "select", threadId: thread.threadId, providerId: "backup" },
      { ...thread, primaryProviderId: "openai" },
    ),
  ).rejects.toThrow("not connected");
  await expect(
    routing.configure({ action: "select", threadId: thread.threadId, providerId: "backup" }),
  ).rejects.toThrow("not connected");
  await select("backup");
  await expect(routing.configure({ action: "remove", id: "backup" })).resolves.toMatchObject({
    providers: [],
  });
  expect((await routing.store.read()).threadProviders).toEqual({});
});
