import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_TERMINAL_OPEN_METHOD,
  PROJECT_WORKSPACE_OPEN_METHOD,
} from "@codexhost/shared-contracts";

import * as terminal from "../src/thread-terminal.js";
import * as workspace from "../src/thread-workspace.js";
import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

afterEach(() => vi.restoreAllMocks());

describe("project actions", () => {
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
