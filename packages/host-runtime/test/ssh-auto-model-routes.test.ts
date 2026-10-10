import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSshAutoModelRoutes } from "../src/ssh-auto-model-routes.js";
import { readSshAutoModelRoutesOnHost } from "../src/ssh-auto-model-routes-worker.js";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const route = {
  request_id: "019ccb31-9520-7120-bc17-556e9a92d861",
  session_id: threadId,
  turn_id: "turn-1",
  run_id: "turn-1",
  requested_model: "auto",
  selected_model: "first",
  resolved_model: "actual",
  attempted_models: ["first", "actual"],
  state: "completed",
  started_at: 1,
  updated_at: 2,
};
const homes: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function fixture(archived = false) {
  const directory = await mkdtemp(join(tmpdir(), "ssh-auto-routes-"));
  homes.push(directory);
  const home = join(directory, "remote-codex");
  const sessions = join(home, archived ? "archived_sessions" : "sessions/2026/09/29");
  await mkdir(sessions, { recursive: true });
  const rolloutPath = join(sessions, `rollout-2026-09-29T20-40-31-${threadId}.jsonl`);
  await writeFile(
    rolloutPath,
    JSON.stringify({
      type: "session_meta",
      payload: { id: threadId, model_provider: "gateway" },
    }) + "\n",
  );
  await writeFile(
    join(home, "config.toml"),
    'model_provider = "wrong"\n[model_providers.gateway]\nbase_url = "https://fixture.invalid/v1"\nenv_key = "REMOTE_KEY"\n',
  );
  return {
    home,
    params: {
      hostId: "remote-ssh-discovered:fixture",
      threadId,
      runId: "turn-1",
      modelProvider: "gateway",
      rolloutPath,
    },
    environment: { CODEX_HOME: "/must-not-use-default-home", REMOTE_KEY: "remote-secret" },
  };
}

describe("SSH Auto route observation transport", () => {
  it.each([false, true])(
    "uses the saved Thread home and provider, archived=%s",
    async (archived) => {
      const input = await fixture(archived);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL, init: RequestInit) => {
          expect(url.pathname).toBe("/v1/auto/routes");
          expect(url.searchParams.get("session_id")).toBe(threadId);
          expect(url.searchParams.get("run_id")).toBe("turn-1");
          expect(new Headers(init.headers).get("Authorization")).toBe("Bearer remote-secret");
          return Response.json({ object: "list", data: [route] });
        }),
      );
      expect(await readSshAutoModelRoutesOnHost(input.params, input.environment)).toEqual({
        supported: true,
        routes: [route],
      });
    },
  );

  it.each(["thread", "provider", "path"])(
    "rejects mismatched %s before contacting the gateway",
    async (mismatch) => {
      const input = await fixture();
      const params = { ...input.params };
      if (mismatch === "thread") {
        await writeFile(
          params.rolloutPath,
          JSON.stringify({
            type: "session_meta",
            payload: { id: route.request_id, model_provider: "gateway" },
          }) + "\n",
        );
      } else if (mismatch === "provider") {
        params.modelProvider = "another-provider";
      } else {
        params.rolloutPath = join(input.home, "config.toml");
      }
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(readSshAutoModelRoutesOnHost(params, input.environment)).rejects.toThrow(
        "Auto route Thread",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("ignores legacy remote privacy settings before and during observations", async () => {
    const input = await fixture();
    const fetcher = vi.fn(async () => {
      await writeFile(join(input.home, "buddy-router.json"), '{"privateMode":true}');
      return Response.json({ object: "list", data: [route] });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await readSshAutoModelRoutesOnHost(input.params, input.environment)).toEqual({
      supported: true,
      routes: [route],
    });
    expect(await readSshAutoModelRoutesOnHost(input.params, input.environment)).toEqual({
      supported: true,
      routes: [route],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized Thread metadata before reading credentials", async () => {
    const input = await fixture();
    await writeFile(input.params.rolloutPath, "x".repeat(2 * 1024 * 1024 + 1));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(readSshAutoModelRoutesOnHost(input.params, input.environment)).rejects.toThrow(
      "Auto route Thread metadata is unavailable",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not substitute another key when the remote Provider environment key is missing", async () => {
    const input = await fixture();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readSshAutoModelRoutesOnHost(input.params, { OPENAI_API_KEY: "another-provider-secret" }),
    ).rejects.toThrow("Auto route Provider connection is unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses only saved SSH connection arguments and strips extra result fields", async () => {
    const input = await fixture();
    await writeFile(
      join(input.home, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          { hostId: input.params.hostId, source: "discovered", alias: "remote-host" },
        ],
      }),
    );
    const execute = vi.fn(async (request: { arguments: string[]; source: string }) => {
      expect(request.arguments.slice(0, -1)).toEqual([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "SendEnv=-*",
        "remote-host",
      ]);
      const encoded = request.arguments
        .at(-1)
        ?.match(/^node --input-type=module - '([A-Za-z0-9+/=]+)'$/u)?.[1];
      expect(JSON.parse(Buffer.from(encoded ?? "", "base64").toString())).toEqual(input.params);
      expect(request.source).toBe("fixed-worker");
      return JSON.stringify({ supported: true, routes: [{ ...route, api_key: "must-strip" }] });
    });
    expect(
      await readSshAutoModelRoutes({
        params: input.params,
        environment: { CODEX_HOME: input.home },
        workerSource: async () => "fixed-worker",
        execute,
      }),
    ).toEqual({ supported: true, routes: [route] });
  });

  it.each(["session", "turn", "error"])(
    "rejects %s without exposing remote output",
    async (mismatch) => {
      const input = await fixture();
      await writeFile(
        join(input.home, ".codex-global-state.json"),
        JSON.stringify({
          "codex-managed-remote-connections": [
            { hostId: input.params.hostId, source: "discovered", alias: "remote-host" },
          ],
        }),
      );
      await expect(
        readSshAutoModelRoutes({
          params: input.params,
          environment: { CODEX_HOME: input.home },
          workerSource: async () => "fixed-worker",
          execute: async () => {
            if (mismatch === "error") throw new Error("remote-secret");
            return JSON.stringify({
              supported: true,
              routes: [
                {
                  ...route,
                  ...(mismatch === "session"
                    ? { session_id: route.request_id }
                    : { turn_id: "other-turn" }),
                },
              ],
            });
          },
        }),
      ).rejects.toThrow(/^Unable to read Auto route observations on SSH Host$/u);
    },
  );

  it("executes the bundled worker without installed packages and keeps credentials remote", async () => {
    const input = await fixture();
    const requests: { url: string | undefined; authorization: string | undefined }[] = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ object: "list", data: [route] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture address");
    await writeFile(
      join(input.home, "config.toml"),
      `[model_providers.gateway]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nrequires_openai_auth = true\n`,
    );
    await writeFile(join(input.home, "auth.json"), '{"OPENAI_API_KEY":"remote-auth-file-secret"}');
    const { buildAutoModelRoutesWorker } =
      await import("../scripts/build-auto-model-routes-worker.mjs");
    const source = await buildAutoModelRoutesWorker(process.cwd());
    const encoded = Buffer.from(JSON.stringify(input.params)).toString("base64");
    const child = spawn(process.execPath, ["--input-type=module", "-", encoded], {
      cwd: input.home,
      env: {
        ...process.env,
        CODEX_HOME: "/incorrect-default",
        OPENAI_API_KEY: "incorrect-default-key",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.stdin.end(source);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    expect(Buffer.concat(errors).toString()).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(Buffer.concat(output).toString())).toEqual({
      supported: true,
      routes: [route],
    });
    expect(requests).toEqual([
      {
        url: `/v1/auto/routes?session_id=${threadId}&run_id=turn-1`,
        authorization: "Bearer remote-auth-file-secret",
      },
    ]);
    expect(source).not.toContain("remote-auth-file-secret");
  });
});
