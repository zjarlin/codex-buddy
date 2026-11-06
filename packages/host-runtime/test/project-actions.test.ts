import { GitWorkspace } from "../src/git-workspace.js";
import { GitRepositoryLinks } from "../src/git-repository-links.js";
import * as directories from "../src/local-workspace-directories.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_TERMINAL_OPEN_METHOD,
  PROJECT_WORKSPACE_OPEN_METHOD,
  LOCAL_WORKSPACE_PREPARE_METHOD,
  LOCAL_WORKSPACE_DIRECTORIES_METHOD,
  GIT_ORIGIN_METHOD,
} from "@codexhost/shared-contracts";

import * as terminal from "../src/thread-terminal.js";
import * as workspace from "../src/thread-workspace.js";
import { ProjectSyncPeer } from "../src/project-sync-peer.js";
import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

afterEach(() => vi.restoreAllMocks());

describe("project actions", () => {
  it("routes origin lookup and local folder browsing without official RPC", async () => {
    vi.spyOn(GitRepositoryLinks.prototype, "resolve").mockResolvedValue("/project");
    const origin = vi
      .spyOn(GitWorkspace.prototype, "origin")
      .mockResolvedValue("https://example.test/project.git");
    const browse = vi.spyOn(directories, "localWorkspaceDirectories").mockResolvedValue({
      project: "/local",
      path: "/local",
      parent: "/",
      entries: [],
      truncated: false,
    });
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: GIT_ORIGIN_METHOD,
        params: { cwd: "/project" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { remote: "https://example.test/project.git" } });
      expect(origin).toHaveBeenCalledWith("/project");
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: LOCAL_WORKSPACE_DIRECTORIES_METHOD,
        params: { path: "/missing/project" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ result: { path: "/local" } });
      expect(browse).toHaveBeenCalledWith(expect.any(GitWorkspace), "/missing/project");
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("prepares a local workspace through Host RPC without forwarding to Codex", async () => {
    const prepare = vi
      .spyOn(ProjectSyncPeer.prototype, "prepareLocalWorkspace")
      .mockResolvedValue({ path: "/local/project", cloned: true });
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: LOCAL_WORKSPACE_PREPARE_METHOD,
        params: { path: "/local/project", remote: "https://example.test/project.git" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { path: "/local/project", cloned: true } });
      expect(prepare).toHaveBeenCalledWith("/local/project", "https://example.test/project.git");
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: LOCAL_WORKSPACE_PREPARE_METHOD,
        params: { path: "/local/project", command: "unexpected" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ error: { code: -32602 } });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("returns preparation failures instead of reporting a ready workspace", async () => {
    vi.spyOn(ProjectSyncPeer.prototype, "prepareLocalWorkspace").mockRejectedValue(
      new Error("clone failed"),
    );
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: LOCAL_WORKSPACE_PREPARE_METHOD,
        params: { path: "/local/project" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ error: { code: -32094, message: "clone failed" } });
    } finally {
      await stopFixture(fixture);
    }
  });

  it("routes terminal and VS Code project requests to the local Host", async () => {
    const openTerminal = vi.fn(async () => ({
      workspace: "/repo",
      terminal: "ghostty" as const,
    }));
    const openWorkspace = vi.fn(async () => ({
      workspace: "/repo",
      application: "vscode" as const,
    }));
    vi.spyOn(terminal, "openProjectTerminal").mockImplementation(openTerminal);
    vi.spyOn(workspace, "openProjectWorkspace").mockImplementation(openWorkspace);
    const fixture = createFixture();
    const officialWrite = vi.fn();
    fixture.official.stdin.on("data", officialWrite);
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: PROJECT_TERMINAL_OPEN_METHOD,
        params: { path: "/repo", terminalId: "ghostty" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ result: { workspace: "/repo", terminal: "ghostty" } });
      expect(openTerminal).toHaveBeenCalledWith("/repo", "ghostty", {
        environment: expect.objectContaining({ CODEXHOST_DATA_DIR: expect.any(String) }),
      });

      writeRequest(fixture.desktopInput, {
        id: 2,
        method: PROJECT_WORKSPACE_OPEN_METHOD,
        params: { path: "/repo" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ result: { workspace: "/repo", application: "vscode" } });
      expect(openWorkspace).toHaveBeenCalledWith("/repo", {
        environment: expect.objectContaining({ CODEXHOST_DATA_DIR: expect.any(String) }),
      });
      expect(officialWrite).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("rejects injected parameters before launching a local application", async () => {
    const openTerminal = vi.spyOn(terminal, "openProjectTerminal");
    const openWorkspace = vi.spyOn(workspace, "openProjectWorkspace");
    const fixture = createFixture();
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: PROJECT_TERMINAL_OPEN_METHOD,
        params: { path: "/repo", command: "rm -rf /" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 1)),
      ).resolves.toMatchObject({ error: { code: -32101 } });

      writeRequest(fixture.desktopInput, {
        id: 2,
        method: PROJECT_WORKSPACE_OPEN_METHOD,
        params: { path: "relative" },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 2)),
      ).resolves.toMatchObject({ error: { code: -32102 } });
      expect(openTerminal).not.toHaveBeenCalled();
      expect(openWorkspace).not.toHaveBeenCalled();
    } finally {
      await stopFixture(fixture);
    }
  });
});
