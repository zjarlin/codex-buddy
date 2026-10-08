import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { hostThreadIdSchema, type SshTurnActionsParams } from "@codexhost/shared-contracts";
import { readSshTurnActionsOnHost } from "../src/ssh-turn-actions-worker.js";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "ssh-actions-"));
  directories.push(home);
  const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
  const sessions = join(home, "sessions/2026/09/30");
  await mkdir(sessions, { recursive: true });
  const rolloutPath = join(sessions, `rollout-test-${threadId}.jsonl`);
  await writeFile(
    rolloutPath,
    JSON.stringify({ type: "session_meta", payload: { id: threadId, model_provider: "gateway" } }) +
      "\n",
  );
  await writeFile(
    join(home, "config.toml"),
    '[model_providers.gateway]\nbase_url="https://fixture.invalid/v1"\nenv_key="REMOTE_KEY"\n',
  );
  const params: SshTurnActionsParams = {
    target: { threadId, hostId: "remote-ssh:fixture", rolloutPath, modelProvider: "gateway" },
    operation: "inspect",
    sourceTurnId: "turn-1",
    latestTurnId: "turn-1",
    busy: false,
    planMode: false,
    git: true,
    features: { git_changes: 1, git_conflicts: 0, git_ahead: 0, git_behind: 0 },
  };
  const environment = {
    CODEX_HOME: "/wrong",
    CODEXHOST_DATA_DIR: join(home, "receipts"),
    REMOTE_KEY: "remote-secret",
  };
  return { home, params, environment };
}
it("keeps Provider reads and durable invocation receipts on the remote Host", async () => {
  const f = await fixture();
  const fetch = vi.fn(async (_url: URL, options: RequestInit) => {
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer remote-secret");
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  const snapshot = await readSshTurnActionsOnHost(f.params, f.environment);
  expect(snapshot).toMatchObject({ recommendation: { state: "unsupported" }, private: false });
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "POST"]);
  const invocation = {
    threadId: hostThreadIdSchema.parse(f.params.target.threadId),
    sourceTurnId: "turn-1",
    invocationId: randomUUID(),
    actionId: "git.commit",
    version: "1",
  };
  const request = { ...f.params, operation: "claim" as const, invocation };
  const receipt = await readSshTurnActionsOnHost(request, f.environment);
  expect(receipt).toMatchObject({ state: "starting" });
  expect(await readSshTurnActionsOnHost(request, f.environment)).toMatchObject({
    state: "unknown",
  });
  await expect(
    readSshTurnActionsOnHost(
      { ...request, invocation: { ...invocation, actionId: "git.commit_push" } },
      f.environment,
    ),
  ).rejects.toThrow("执行 ID");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects mismatched remote Provider and honors remote privacy before querying or claiming", async () => {
  const f = await fixture();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    readSshTurnActionsOnHost(
      { ...f.params, target: { ...f.params.target, modelProvider: "wrong" } },
      f.environment,
    ),
  ).rejects.toThrow("ownership");
  await writeFile(join(f.home, "buddy-router.json"), '{"privateMode":true}');
  expect(await readSshTurnActionsOnHost(f.params, f.environment)).toMatchObject({ private: true });
  await expect(
    readSshTurnActionsOnHost(
      {
        ...f.params,
        operation: "claim",
        invocation: {
          threadId: hostThreadIdSchema.parse(f.params.target.threadId),
          sourceTurnId: "turn-1",
          invocationId: randomUUID(),
          actionId: "git.commit",
          version: "1",
        },
      },
      f.environment,
    ),
  ).rejects.toThrow("隐私");
  expect(fetch).not.toHaveBeenCalled();
});

it("runs the bundled action worker and preserves admission across separate processes", async () => {
  const f = await fixture();
  const { buildAutoModelRoutesWorker } =
    await import("../scripts/build-auto-model-routes-worker.mjs");
  const source = await buildAutoModelRoutesWorker(process.cwd());
  const params = {
    ...f.params,
    operation: "claim",
    invocation: {
      threadId: f.params.target.threadId,
      sourceTurnId: f.params.sourceTurnId,
      invocationId: randomUUID(),
      actionId: "git.commit",
      version: "1",
    },
  };
  const run = () =>
    new Promise<unknown>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-", Buffer.from(JSON.stringify(params)).toString("base64")],
        {
          cwd: f.home,
          env: { ...process.env, ...f.environment },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(errors).toString("utf8")));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(output).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(source);
    });
  expect(await run()).toMatchObject({
    state: "starting",
    invocationId: params.invocation.invocationId,
  });
  expect(await run()).toMatchObject({
    state: "unknown",
    invocationId: params.invocation.invocationId,
  });
});
