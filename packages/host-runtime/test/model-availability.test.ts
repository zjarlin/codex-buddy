import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelAvailability } from "../src/model-availability.js";

const homes: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

function completed(text = "OK"): Response {
  return Response.json({
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  });
}

async function fixture(wireApi = "responses") {
  const home = await mkdtemp(join(tmpdir(), "model-availability-test-"));
  homes.push(home);
  await writeFile(
    join(home, "config.toml"),
    `model_provider = "gateway"\n[model_providers.gateway]\nbase_url = "https://fixture.invalid/custom/v1"\nwire_api = "${wireApi}"\nenv_key = "FIXTURE_KEY"\n[model_providers.gateway.query_params]\nversion = "fixture"\n`,
  );
  const environment = { FIXTURE_KEY: "fixture-secret-key" };
  const privateMode = vi.fn().mockResolvedValue(false);
  const options = { home, environment, privateMode };
  return { home, environment, privateMode, options, service: new ModelAvailability(options) };
}

describe("manual model availability", () => {
  it("probes every provider and extra visible model exactly once and only accepts valid completions", async () => {
    const { service, home } = await fixture();
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.searchParams.get("version")).toBe("fixture");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-secret-key");
      if (url.pathname.endsWith("/models")) {
        return Response.json({
          data: ["good", "http", "business", "empty", "good"].map((id) => ({ id })),
        });
      }
      expect(url.pathname).toBe("/custom/v1/responses");
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.model === "http")
        return Response.json({ error: "fixture-secret-key" }, { status: 503 });
      if (body.model === "business")
        return Response.json({ error: { message: "fixture-secret-key" }, status: "completed" });
      if (body.model === "empty") return completed("");
      return completed();
    });
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await service.handle({
      action: "probe",
      modelIds: ["good", "custom/model id"],
    });
    expect(snapshot.provider).toBe("gateway");
    expect(snapshot.results.map(({ id, status }) => [id, status])).toEqual([
      ["good", "available"],
      ["http", "unavailable"],
      ["business", "unavailable"],
      ["empty", "unavailable"],
      ["custom/model id", "available"],
    ]);
    expect(snapshot.results[1]?.error).toContain("HTTP 503");
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect(body).toMatchObject({
        input: "Reply only with OK.",
        stream: false,
        store: false,
      });
      expect(body).not.toHaveProperty("tools");
    }
    const persisted = await readFile(join(home, "model-availability.json"), "utf8");
    expect(persisted).not.toContain("fixture-secret-key");
    expect(persisted).not.toContain("fixture.invalid");
    if (process.platform !== "win32")
      expect((await stat(join(home, "model-availability.json"))).mode & 0o777).toBe(0o600);
  });

  it("uses configured chat semantics and rejects missing or unfinished messages", async () => {
    const { service } = await fixture("chat");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        if (url.pathname.endsWith("/models"))
          return Response.json({
            data: [{ id: "good" }, { id: "unfinished" }, { id: "business-error" }],
          });
        expect(url.pathname).toBe("/custom/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          messages: [{ role: "user", content: "Reply only with OK." }],
        });
        return Response.json({
          choices: [
            {
              finish_reason:
                body.model === "good" ? "stop" : body.model === "business-error" ? "error" : null,
              message: { role: "assistant", content: "OK" },
            },
          ],
        });
      }),
    );
    const snapshot = await service.handle({ action: "probe" });
    expect(snapshot.results.map(({ status }) => status)).toEqual([
      "available",
      "unavailable",
      "unavailable",
    ]);
  });

  it("reads persisted results after reopening without network or auth command execution and invalidates changed local identity", async () => {
    const { service, options, home, environment } = await fixture();
    const fetcher = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/models") ? Response.json({ data: [{ id: "good" }] }) : completed(),
    );
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await service.handle({ action: "probe" });
    fetcher.mockClear();
    const reopened = new ModelAvailability(options);
    expect(await reopened.handle({ action: "read" })).toEqual(snapshot);
    expect(fetcher).not.toHaveBeenCalled();
    const config = await readFile(join(home, "config.toml"), "utf8");
    await writeFile(
      join(home, "config.toml"),
      `model = "another-default-model"\nmodel_catalog_json = "updated-catalog.json"\n${config}\n[model_providers.other]\nbase_url = "https://other.invalid/v1"\n`,
    );
    expect(await reopened.handle({ action: "read" })).toEqual(snapshot);
    expect(fetcher).not.toHaveBeenCalled();
    environment.FIXTURE_KEY = "replacement-secret";
    expect(await reopened.handle({ action: "read" })).toEqual({
      provider: "",
      checkedAt: null,
      results: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
    environment.FIXTURE_KEY = "fixture-secret-key";
    await writeFile(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "another-account" }));
    expect((await reopened.handle({ action: "read" })).checkedAt).toBeNull();
  });

  it("never runs auth commands when validating a saved cache", async () => {
    const { home, service } = await fixture();
    const fetcher = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/models") ? Response.json({ data: [{ id: "good" }] }) : completed(),
    );
    vi.stubGlobal("fetch", fetcher);
    await service.handle({ action: "probe" });
    fetcher.mockClear();
    await writeFile(
      join(home, "config.toml"),
      'model_provider = "gateway"\n[model_providers.gateway]\nbase_url = "https://fixture.invalid/v1"\n[model_providers.gateway.auth]\ncommand = "/must-not-execute"\n',
    );
    expect(await service.handle({ action: "read" })).toEqual({
      provider: "",
      checkedAt: null,
      results: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("limits concurrency to four and shares simultaneous manual probes", async () => {
    const { service } = await fixture();
    const releases: (() => void)[] = [];
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/models"))
        return Response.json({
          data: Array.from({ length: 7 }, (_, index) => ({ id: `model-${index}` })),
        });
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return completed();
    });
    vi.stubGlobal("fetch", fetcher);
    const first = service.handle({ action: "probe" });
    const second = service.handle({ action: "probe" });
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.splice(0).forEach((release) => release());
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(maximum).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("records timeout as unavailable without automatic retries", async () => {
    const { service } = await fixture();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) =>
      timeout(milliseconds === 15_000 ? 1 : milliseconds),
    );
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "slow" }] });
      await new Promise<never>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error("aborted"));
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return completed();
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await service.handle({ action: "probe" })).results[0]).toMatchObject({
      id: "slow",
      status: "unavailable",
      error: "探测超时（15 秒）。",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("blocks online probes in privacy mode and preserves last results after catalog failure", async () => {
    const { service, privateMode } = await fixture();
    const fetcher = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/models") ? Response.json({ data: [{ id: "good" }] }) : completed(),
    );
    vi.stubGlobal("fetch", fetcher);
    const snapshot = await service.handle({ action: "probe" });
    fetcher.mockClear();
    privateMode.mockResolvedValue(true);
    await expect(service.handle({ action: "probe" })).rejects.toThrow("隐私模式");
    expect(await service.handle({ action: "read" })).toEqual(snapshot);
    expect(fetcher).not.toHaveBeenCalled();
    privateMode.mockResolvedValue(false);
    fetcher.mockResolvedValue(Response.json({ error: "fixture-secret-key" }));
    await expect(service.handle({ action: "probe" })).rejects.toThrow("无法读取供应商模型目录");
    expect(await service.handle({ action: "read" })).toEqual(snapshot);
  });

  it("does not replace saved results when provider configuration changes during a probe", async () => {
    const { service, home } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "good" }] });
        await writeFile(
          join(home, "auth.json"),
          JSON.stringify({ OPENAI_API_KEY: "changed-during-probe" }),
        );
        return completed();
      }),
    );
    await expect(service.handle({ action: "probe" })).rejects.toThrow("配置已变化");
    expect((await service.handle({ action: "read" })).checkedAt).toBeNull();
  });

  it("aborts in-flight requests and stops remaining workers when closed", async () => {
    const { service } = await fixture();
    let requests = 0;
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith("/models")) {
        return Response.json({
          data: Array.from({ length: 8 }, (_, index) => ({ id: `model-${index}` })),
        });
      }
      requests++;
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      });
      return completed();
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = service.handle({ action: "probe" });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(requests).toBe(4));
    service.close();
    await rejected;
    expect(requests).toBe(4);
    expect((await service.handle({ action: "read" })).checkedAt).toBeNull();
  });
});
