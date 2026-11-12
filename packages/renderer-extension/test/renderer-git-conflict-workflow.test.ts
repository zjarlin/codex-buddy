import { describe, expect, it, vi } from "vitest";
import { gitWorkspaceStatusSchema } from "@codexhost/shared-contracts";
import { startGitConflictThread } from "../src/renderer-git-conflict-workflow.js";

const status = gitWorkspaceStatusSchema.parse({
  workspace: "/linked",
  branch: "main",
  detached: false,
  head: "abc",
  upstream: "origin/main",
  ahead: 1,
  behind: 1,
  operation: "merge",
  conflicts: ["file.ts"],
  changes: [],
  submodules: [],
});

describe("independent Git conflict chat", () => {
  function fixture() {
    return {
      client: {
        createThread: vi.fn(async () => "new-thread"),
        sendThreadMessage: vi.fn(async () => "turn"),
      },
      open: vi.fn(async () => {}),
    };
  }

  it("creates in the selected repository and sends only to the new chat before opening it", async () => {
    const { client, open } = fixture();
    await startGitConflictThread(client, status, open, () => true);
    expect(client.createThread).toHaveBeenCalledExactlyOnceWith("/linked");
    expect(client.sendThreadMessage).toHaveBeenCalledExactlyOnceWith(
      "new-thread",
      expect.stringContaining('"conflicts":["file.ts"]'),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith("new-thread");
    expect(client.sendThreadMessage.mock.invocationCallOrder[0]).toBeLessThan(
      open.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not send or navigate after switching context during creation", async () => {
    const { client, open } = fixture();
    let current = true;
    client.createThread.mockImplementation(async () => {
      current = false;
      return "new-thread";
    });
    await expect(startGitConflictThread(client, status, open, () => current)).rejects.toThrow(
      "new-thread",
    );
    expect(client.sendThreadMessage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not reclaim navigation after switching context during submission", async () => {
    const { client, open } = fixture();
    let current = true;
    client.sendThreadMessage.mockImplementation(async () => {
      current = false;
      return "turn";
    });
    await expect(startGitConflictThread(client, status, open, () => current)).rejects.toThrow(
      "未自动打开",
    );
    expect(open).not.toHaveBeenCalled();
  });

  for (const step of ["create", "send", "open"] as const) {
    it(`reports ${step} failure without replaying or losing the created identity`, async () => {
      const { client, open } = fixture();
      const action = { create: client.createThread, send: client.sendThreadMessage, open }[step];
      action.mockRejectedValue(new Error("offline"));
      await expect(startGitConflictThread(client, status, open, () => true)).rejects.toThrow(
        step === "create" ? "offline" : "new-thread",
      );
      expect(client.createThread).toHaveBeenCalledTimes(1);
      expect(client.sendThreadMessage).toHaveBeenCalledTimes(step === "create" ? 0 : 1);
      expect(open).toHaveBeenCalledTimes(step === "open" ? 1 : 0);
    });
  }
});
