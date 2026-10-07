import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAutoModelRoutes } from "../src/auto-model-routes.js";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const route = {
  request_id: "019ccb31-9520-7120-bc17-556e9a92d861",
  session_id: threadId,
  turn_id: "turn-1",
  requested_model: "auto",
  selected_model: "first",
  resolved_model: "actual",
  attempted_models: ["first", "actual"],
  state: "completed",
  started_at: 1,
  updated_at: 2,
};
const homes: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "auto-routes-"));
  homes.push(home);
  await writeFile(
    join(home, "config.toml"),
    `model_provider = "wrong"\n[model_providers.gateway]\nbase_url = "https://fixture.invalid/custom/v1"\nenv_key = "TEST_KEY"\n[model_providers.gateway.query_params]\nversion = "v1"\n`,
  );
  return {
    params: { threadId },
    environment: { CODEX_HOME: home, TEST_KEY: "fixture-secret" },
    privateMode: vi.fn(async () => false),
    readThread: vi.fn(async () => ({
      result: { thread: { id: threadId, modelProvider: "gateway" } },
    })),
  };
}

describe("gateway Auto route observations", () => {
  it("preserves vertical operations for explicit models and pending video tasks", async () => {
    const input = await fixture();
    const video = {
      ...route,
      requested_model: "ask",
      state: "queued",
      operation: {
        kind: "video_generation",
        provider: "grok",
        task_id: "video-123",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ object: "list", data: [video] })),
    );
    expect((await readAutoModelRoutes(input)).routes[0]).toEqual(video);
  });

  it("rejects executable artifact protocols", async () => {
    const input = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          object: "list",
          data: [
            {
              ...route,
              operation: {
                kind: "image_generation",
                artifacts: [{ kind: "image", url: "javascript:alert(1)" }],
              },
            },
          ],
        }),
      ),
    );
    await expect(readAutoModelRoutes(input)).rejects.toThrow(
      "Unable to read Auto route observations",
    );
  });
  it("queries a persisted run and rejects a mismatched run", async () => {
    const input = await fixture();
    const scoped = { ...input, params: { threadId, runId: "turn-1" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        expect(url.searchParams.get("run_id")).toBe("turn-1");
        return Response.json({ object: "list", data: [{ ...route, run_id: "turn-1" }] });
      }),
    );
    expect((await readAutoModelRoutes(scoped)).routes[0]?.run_id).toBe("turn-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ object: "list", data: [{ ...route, run_id: "other-run" }] }),
      ),
    );
    await expect(readAutoModelRoutes(scoped)).rejects.toThrow(
      "Unable to read Auto route observations",
    );
  });

  it("preserves the full candidate plan and more than 128 fallback attempts", async () => {
    const input = await fixture();
    const candidates = Array.from({ length: 700 }, (_, index) => ({
      model: `vendor/model-${index}`,
      platform: "openai",
      eligible: true,
      order: index + 1,
    }));
    const inventory = {
      ...route,
      candidates,
      attempted_models: candidates.map((entry) => entry.model),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ object: "list", data: [inventory] })),
    );
    const result = await readAutoModelRoutes(input);
    expect(result.routes[0]?.candidates).toEqual(candidates);
    expect(result.routes[0]?.attempted_models).toHaveLength(700);
  });

  it("uses the actual Thread provider and Host credentials, strips extra fields", async () => {
    const input = await fixture();
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe("/custom/v1/auto/routes");
      expect(url.searchParams.get("session_id")).toBe(threadId);
      expect(url.searchParams.get("version")).toBe("v1");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-secret");
      expect(init?.redirect).toBe("error");
      return Response.json({
        object: "list",
        data: [{ ...route, account_id: 180, api_key: "secret" }],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await readAutoModelRoutes(input);
    expect(result).toEqual({ supported: true, routes: [route] });
    expect(input.readThread).toHaveBeenCalledWith(threadId);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not contact the provider in privacy mode", async () => {
    const input = await fixture();
    input.privateMode.mockResolvedValue(true);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await readAutoModelRoutes(input)).toEqual({
      supported: false,
      routes: [],
      unavailableReason: "private",
    });
    expect(input.readThread).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discards an in-flight result after privacy mode changes", async () => {
    const input = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        input.privateMode.mockResolvedValue(true);
        return Response.json({ object: "list", data: [route] });
      }),
    );
    expect(await readAutoModelRoutes(input)).toEqual({
      supported: false,
      routes: [],
      unavailableReason: "private",
    });
  });

  it.each([404, 405])("treats HTTP %s as an unsupported extension", async (status) => {
    const input = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not supported", { status })),
    );
    expect(await readAutoModelRoutes(input)).toEqual({
      supported: false,
      routes: [],
      unavailableReason: "provider",
    });
  });

  it.each([404, 503, "network"])(
    "hides an in-flight %s failure after privacy mode changes",
    async (failure) => {
      const input = await fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          input.privateMode.mockResolvedValue(true);
          if (typeof failure === "string") throw new Error("offline");
          return new Response("unavailable", { status: failure });
        }),
      );
      expect(await readAutoModelRoutes(input)).toEqual({
        supported: false,
        routes: [],
        unavailableReason: "private",
      });
    },
  );

  it.each([
    () => new Response("fixture-secret", { status: 401 }),
    () => new Response("fixture-secret", { status: 503 }),
    () => Response.json({ object: "list", data: [{ ...route, session_id: route.request_id }] }),
    () => Response.json({ object: "list", data: [{ ...route, state: "success-ish" }] }),
    () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    () => {
      throw new Error("redirected with fixture-secret");
    },
  ])(
    "rejects failures and untrusted or mismatched responses without leaking secrets",
    async (respond) => {
      const input = await fixture();
      vi.stubGlobal("fetch", vi.fn(respond));
      await expect(readAutoModelRoutes(input)).rejects.toThrow(
        "Unable to read Auto route observations from Provider",
      );
    },
  );

  it("rejects a native Thread identity mismatch before looking up credentials", async () => {
    const input = await fixture();
    input.readThread.mockResolvedValue({
      result: { thread: { id: route.request_id, modelProvider: "gateway" } },
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(readAutoModelRoutes(input)).rejects.toThrow("ownership");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
