import { describe, expect, it, vi } from "vitest";

import { installRendererThreadArchive } from "../src/renderer-thread-archive.js";

const missingAccount = "Could not determine the account for worktree cleanup.";

function manager(add: (...args: unknown[]) => unknown, hostId = "local") {
  return { getHostId: () => hostId, pendingThreadArchives: { add } };
}

describe("native thread archive compatibility", () => {
  it("retains the directory when cleanup has no account and archives exactly once", async () => {
    const prepare = vi.fn(async (_id: unknown, options: unknown) => {
      if ((options as { cleanupWorktree: boolean }).cleanupWorktree) {
        throw new Error(missingAccount);
      }
    });
    const target = manager(prepare);
    const archive = vi.fn();
    const archiveConversation = async (threadId: string, options: unknown) => {
      await target.pendingThreadArchives.add(threadId, options);
      archive(threadId);
    };
    installRendererThreadArchive(target);
    const options = { cwd: "/project", cleanupWorktree: true };

    await archiveConversation("thread", options);

    expect(prepare.mock.calls).toEqual([
      ["thread", options],
      ["thread", { cwd: "/project", cleanupWorktree: false }],
    ]);
    expect(options.cleanupWorktree).toBe(true);
    expect(archive.mock.calls).toEqual([["thread"]]);
  });

  it("preserves successful native cleanup, its receiver, and result", async () => {
    const prepare = vi.fn(function (this: unknown) {
      return this;
    });
    const target = manager(prepare);
    installRendererThreadArchive(target);

    await expect(
      target.pendingThreadArchives.add("thread", { cwd: "/project", cleanupWorktree: true }),
    ).resolves.toBe(target.pendingThreadArchives);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it.each(["permission denied", "disk full", "connection lost"])(
    "propagates %s without another preparation attempt",
    async (message) => {
      const error = new Error(message);
      const prepare = vi.fn().mockRejectedValue(error);
      const target = manager(prepare);
      installRendererThreadArchive(target);

      await expect(
        target.pendingThreadArchives.add("thread", { cwd: "/project", cleanupWorktree: true }),
      ).rejects.toBe(error);
      expect(prepare).toHaveBeenCalledOnce();
    },
  );

  it("propagates the retained-directory registration failure", async () => {
    const error = new Error("registration failed");
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error(missingAccount))
      .mockRejectedValue(error);
    const target = manager(prepare);
    installRendererThreadArchive(target);

    await expect(
      target.pendingThreadArchives.add("thread", { cwd: "/project", cleanupWorktree: true }),
    ).rejects.toBe(error);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("keeps remote managers and unsupported coordination objects unchanged", () => {
    const remote = manager(vi.fn(), "ssh:remote");
    const inherited = Object.create({ add: vi.fn() });
    expect(installRendererThreadArchive(remote)).toBeNull();
    expect(
      installRendererThreadArchive({ getHostId: () => "local", pendingThreadArchives: inherited }),
    ).toBeNull();
    expect(installRendererThreadArchive({})).toBeNull();
  });

  it("does not retry when cleanup was already disabled", async () => {
    const error = new Error(missingAccount);
    const prepare = vi.fn().mockRejectedValue(error);
    const target = manager(prepare);
    installRendererThreadArchive(target);

    await expect(
      target.pendingThreadArchives.add("thread", { cwd: "/project", cleanupWorktree: false }),
    ).rejects.toBe(error);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("restores the native method on disposal and preserves subsequent replacements", () => {
    const target = manager(vi.fn());
    const original = target.pendingThreadArchives.add;
    const dispose = installRendererThreadArchive(target);
    expect(target.pendingThreadArchives.add).not.toBe(original);
    dispose?.();
    expect(target.pendingThreadArchives.add).toBe(original);

    const disposeAgain = installRendererThreadArchive(target);
    const replacement = vi.fn();
    target.pendingThreadArchives.add = replacement;
    disposeAgain?.();
    expect(target.pendingThreadArchives.add).toBe(replacement);
  });
});
