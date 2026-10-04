import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inspectSshRemoteProjects } from "../src/ssh-remote-projects.js";
import {
  inspectRemoteProjectsOnHost,
  syncRemoteProjectsOnHost,
} from "../src/ssh-remote-projects-worker.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function hostFixture(apiKey = "remote-secret-key") {
  const root = await mkdtemp(path.join(tmpdir(), "ssh-remote-projects-"));
  directories.push(root);
  const home = path.join(root, ".codex");
  const data = path.join(root, "codexhost-data");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: apiKey }));
  const fakeCodexScript = path.join(root, "fake-codex.mjs");
  await writeFile(
    fakeCodexScript,
    `#!/usr/bin/env node
import readline from "node:readline";
const input = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
input.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") return send({ id: request.id, result: { userAgent: "fixture" } });
  if (request.method === "project/list") return send({ id: request.id, result: { data: [{ id: "p1", name: "Shared project", roots: [{ path: "/remote/project" }] }] } });
  if (request.method === "thread/list") return send({ id: request.id, result: { data: [{ id: "019ccb31-9520-7120-bc17-556e9a92d860", name: "Shared conversation", updatedAt: 42 }] } });
  send({ id: request.id, result: {} });
});
`,
    { mode: 0o700 },
  );
  return {
    environment: {
      ...process.env,
      HOME: root,
      CODEX_HOME: home,
      CODEXHOST_DATA_DIR: data,
      CODEXHOST_STOCK_CODEX_PATH: fakeCodexScript,
    },
    data,
  };
}

describe("SSH remote project metadata", () => {
  it("publishes and reads projects without exposing the remote API key", async () => {
    const fixture = await hostFixture();
    const snapshot = await syncRemoteProjectsOnHost(fixture.environment);
    expect(snapshot.account.projects).toMatchObject([
      {
        name: "Shared project",
        roots: ["/remote/project"],
        threads: [
          {
            id: "019ccb31-9520-7120-bc17-556e9a92d860",
            name: "Shared conversation",
          },
        ],
      },
    ]);
    const metadata = await readFile(
      path.join(fixture.data, "codexhost-remote-projects", "shared-projects.json"),
      "utf8",
    );
    expect(metadata).not.toContain("remote-secret-key");
    expect(await inspectRemoteProjectsOnHost(fixture.environment)).toMatchObject({
      account: { id: snapshot.account.id, current: true },
    });
  });

  it("isolates metadata for different auth identities", async () => {
    const fixture = await hostFixture("first-key");
    const first = await syncRemoteProjectsOnHost(fixture.environment);
    await writeFile(
      path.join(fixture.environment.CODEX_HOME ?? "", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "second-key" }),
    );
    const second = await inspectRemoteProjectsOnHost(fixture.environment);
    expect(second.account.id).not.toBe(first.account.id);
    expect(second.account.projects).toEqual([]);
    expect(second.accounts.map((account) => account.id)).toContain(first.account.id);
  });

  it("uses the saved SSH connection and injects the target host id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ssh-remote-projects-desktop-"));
    directories.push(root);
    await writeFile(
      path.join(root, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          { hostId: "ssh", source: "discovered", sshAlias: "saved-remote" },
        ],
      }),
    );
    const execute = vi.fn(async (input: { arguments: string[]; source: string }) => {
      expect(input.arguments.slice(0, 8)).toEqual([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "SendEnv=-*",
        "saved-remote",
      ]);
      return JSON.stringify({
        account: { id: "0123456789abcdef", label: "API Key 01234567", current: true, projects: [] },
        accounts: [],
      });
    });
    const result = await inspectSshRemoteProjects({
      params: { hostId: "ssh" },
      environment: { ...process.env, CODEX_HOME: root },
      execute,
      source: async () => "fixed-worker",
    });
    expect(result.account.current).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ source: "fixed-worker" }));
  });

  it("does not pass remote errors or credentials through the SSH boundary", async () => {
    await expect(
      inspectSshRemoteProjects({
        params: { hostId: "ssh" },
        environment: process.env,
        execute: async () => {
          throw new Error("secret remote failure");
        },
        source: async () => "fixed-worker",
      }),
    ).rejects.toThrow("无法读取 SSH 主机上的共享项目");
  });
});
