import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { SshGitMessageService } from "../src/ssh-git-message.js";
import { readSshGitMessageOnHost } from "../src/ssh-git-message-worker.js";

const exec = promisify(execFile);
const cleanup: string[] = [];
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
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function remoteFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "ssh-git-message-"));
  cleanup.push(directory);
  const home = path.join(directory, "remote-user");
  const codexHome = path.join(home, ".codex");
  const cwd = path.join(directory, "project");
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    path.join(codexHome, "config.toml"),
    'model_provider = "remote"\n[model_providers.remote]\nbase_url = "https://remote-provider.invalid/v1"\nexperimental_bearer_token = "remote-only-token"\n',
  );
  await exec("git", ["init", "-q", "-b", "main", cwd]);
  await writeFile(path.join(cwd, "remote.txt"), "changed on SSH host\n");
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete environment.CODEX_HOME;
  return { cwd, environment };
}

it("reads models and generates a message from the remote Codex home and Git workspace", async () => {
  const fixture = await remoteFixture();
  const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer remote-only-token");
    if (url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: "remote-fast" }, { id: "remote-embedding" }] });
    }
    expect(url.pathname).toBe("/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "remote-fast" });
    return Response.json({ choices: [{ message: { content: "fix: use remote SSH provider" } }] });
  });
  vi.stubGlobal("fetch", fetcher);

  await expect(readSshGitMessageOnHost({ kind: "models" }, fixture.environment)).resolves.toEqual({
    models: [
      expect.objectContaining({ id: "remote-fast", eligible: true, recommended: true }),
      expect.objectContaining({ id: "remote-embedding", eligible: false, recommended: false }),
    ],
    defaultModel: "remote-fast",
  });
  await expect(
    readSshGitMessageOnHost(
      { kind: "generate", cwd: fixture.cwd, model: "remote-fast", paths: [] },
      fixture.environment,
    ),
  ).resolves.toEqual({ message: "fix: use remote SSH provider", model: "remote-fast" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("sends only the fixed Git message worker through the saved SSH connection", async () => {
  const execute = vi.fn(async (input: { arguments: string[]; source: string }) => {
    expect(input.arguments.slice(0, -1)).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "SendEnv=-*",
      "saved-remote",
    ]);
    expect(input.arguments.at(-1)).toMatch(/^node --input-type=module - '[A-Za-z0-9+/=]+'$/u);
    expect(input.source).toBe("fixed-worker");
    return JSON.stringify({
      models: [
        {
          id: "remote-fast",
          label: "remote-fast",
          tier: "夯",
          eligible: true,
          recommended: true,
        },
      ],
      defaultModel: "remote-fast",
    });
  });
  const service = new SshGitMessageService(
    { arguments: ["saved-remote"], authority: "saved-remote" },
    process.env,
    { execute, workerSource: async () => "fixed-worker" },
  );
  await expect(service.messageModels()).resolves.toMatchObject({ defaultModel: "remote-fast" });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("executes the bundled worker with only remote Codex configuration and credentials", async () => {
  const fixture = await remoteFixture();
  const requests: { url: string | undefined; authorization: string | undefined }[] = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "remote-fast" }] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address");
  await writeFile(
    path.join(fixture.environment.HOME ?? "", ".codex", "config.toml"),
    `model_provider = "remote"\n[model_providers.remote]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nexperimental_bearer_token = "remote-only-token"\n`,
  );
  const { buildSshGitMessageWorker } = await import("../scripts/build-ssh-git-message-worker.mjs");
  const source = await buildSshGitMessageWorker(process.cwd());
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-", Buffer.from('{"kind":"models"}').toString("base64")],
    {
      cwd: fixture.cwd,
      env: { ...fixture.environment, OPENAI_API_KEY: "local-only-token" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(source);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  expect(code).toBe(0);
  expect(Buffer.concat(errors).toString()).toBe("");
  expect(JSON.parse(Buffer.concat(output).toString())).toMatchObject({
    models: [expect.objectContaining({ id: "remote-fast", eligible: true })],
    defaultModel: "remote-fast",
  });
  expect(requests).toEqual([{ url: "/v1/models", authorization: "Bearer remote-only-token" }]);
  expect(source).not.toContain("remote-only-token");
});
