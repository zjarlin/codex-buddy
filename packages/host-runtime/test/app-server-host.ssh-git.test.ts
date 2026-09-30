import path from "node:path";
import { expect, it, vi } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";
import { GitWorkspace } from "../src/git-workspace.js";
import { GitRepositoryLinks } from "../src/git-repository-links.js";
import { SshGitWorkspaces } from "../src/ssh-git.js";
import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

it("routes SSH Git RPCs to the saved remote workspace without resolving a local thread", async () => {
  const fixture = createFixture();
  const git = new GitWorkspace(
    {},
    {
      paths: path.posix,
      nullDevice: "/dev/null",
      run: async () => ({ stdout: "", stderr: "" }),
      realpath: async (directory) => directory,
      exists: async () => true,
      listDirectories: async () => ["frontend", "backend"],
      files: {
        stat: async () => ({ size: 0, isDirectory: () => false }),
        readFile: async () => Buffer.alloc(0),
      },
    },
  );
  const links = new GitRepositoryLinks(fixture.mappingStoreDirectory, (cwd) => git.root(cwd));
  const resolve = vi.spyOn(links, "resolve").mockResolvedValue("/remote/project");
  const status = vi.spyOn(git, "status").mockResolvedValue({
    workspace: "/remote/project",
    branch: "main",
    detached: false,
    head: "abcdef",
    upstream: null,
    ahead: 0,
    behind: 0,
    operation: null,
    conflicts: [],
    submodules: [],
    changes: [],
  });
  const stage = vi.spyOn(git, "stage").mockImplementation((cwd) => git.status(cwd));
  const models = vi.spyOn(git, "messageModels");
  const remoteModels = vi.fn().mockResolvedValue({
    models: [
      {
        id: "remote-fast",
        label: "remote-fast",
        tier: "夯" as const,
        eligible: true,
        recommended: true,
      },
    ],
    defaultModel: "remote-fast",
  });
  const generateMessage = vi.fn().mockResolvedValue({
    message: "fix: generate from remote SSH",
    model: "remote-fast",
  });
  const forHost = vi
    .spyOn(SshGitWorkspaces.prototype, "forHost")
    .mockImplementation(async (hostId) => {
      if (hostId !== "saved-ssh-host") throw new Error("未找到该项目的 SSH 连接");
      return { git, links, messageModels: remoteModels, generateMessage };
    });
  let id = 700;
  const rpc = async (params: JsonObject) => {
    const request = ++id;
    writeRequest(fixture.desktopInput, { id: request, method: "codexhost/ssh/git", params });
    return fixture.collector.waitFor((message) => requestId(message, request));
  };
  const envelope = {
    hostId: "saved-ssh-host",
    method: "codexhost/git/status",
    params: { cwd: "/remote/project" },
  };
  try {
    await fixture.ready;
    expect(await rpc(envelope)).toMatchObject({
      result: { workspace: "/remote/project", branch: "main" },
    });
    expect(resolve).toHaveBeenCalledWith("/remote/project", undefined);
    expect(status).toHaveBeenCalledWith("/remote/project");
    expect(
      await rpc({
        ...envelope,
        method: "codexhost/git/stage",
        params: { cwd: "/remote/project", paths: ["app.ts"] },
      }),
    ).toHaveProperty("result");
    expect(stage).toHaveBeenCalledWith("/remote/project", ["app.ts"]);
    expect(await rpc({ ...envelope, method: "codexhost/git/message-models" })).toMatchObject({
      result: { models: [{ id: "remote-fast" }], defaultModel: "remote-fast" },
    });
    expect(
      await rpc({
        ...envelope,
        method: "codexhost/git/repository/directories",
        params: { cwd: "/remote/project", path: "/remote" },
      }),
    ).toMatchObject({
      result: {
        path: "/remote",
        entries: [
          { name: "backend", path: "/remote/backend" },
          { name: "frontend", path: "/remote/frontend" },
        ],
      },
    });
    expect(
      await rpc({
        ...envelope,
        method: "codexhost/git/message/generate",
        params: { cwd: "/remote/project", model: "remote-fast", paths: [] },
      }),
    ).toMatchObject({ result: { message: "fix: generate from remote SSH", model: "remote-fast" } });
    expect(generateMessage).toHaveBeenCalledWith({
      cwd: "/remote/project",
      model: "remote-fast",
      paths: [],
    });
    expect(models).not.toHaveBeenCalled();
    const accepted = forHost.mock.calls.length;
    for (const invalid of [
      { ...envelope, method: "process/exec" },
      { ...envelope, params: { cwd: "/remote/project", threadId: "local-thread" } },
      { ...envelope, params: { cwd: "relative" } },
      { ...envelope, arguments: ["arbitrary-host"] },
    ])
      expect(await rpc(invalid)).toHaveProperty("error");
    expect(forHost).toHaveBeenCalledTimes(accepted);
    expect(await rpc({ ...envelope, hostId: "unknown" })).toMatchObject({
      error: { message: expect.stringContaining("SSH 连接") },
    });
    expect(fixture.official.stdin.read()).toBeNull();
  } finally {
    vi.restoreAllMocks();
    await stopFixture(fixture);
  }
});
