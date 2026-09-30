import { describe, expect, it, vi } from "vitest";
import { createRendererSshGitSender } from "../src/renderer-ssh-git.js";

describe("native SSH Git transport", () => {
  it("resolves the native remote thread and forwards only the remote workspace", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "thread/read") return { thread: { cwd: "/remote/project" } };
      throw { code: -32601 };
    });
    const sendLocal = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({
      workspace: "/remote/project",
    }));
    const request = createRendererSshGitSender({
      hostId: "remote-ssh-discovered:server",
      send,
      sendLocal,
      isCurrent: () => true,
    });
    await request("codexhost/git/stage", { threadId: "same-as-local", paths: ["file.txt"] });
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "codexhost/git/stage",
      "thread/read",
    ]);
    expect(sendLocal).toHaveBeenCalledWith("codexhost/ssh/git", {
      hostId: "remote-ssh-discovered:server",
      method: "codexhost/git/stage",
      params: { cwd: "/remote/project", paths: ["file.txt"] },
    });
    await request("codexhost/git/stage", { cwd: "/remote/other", paths: ["other.txt"] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sendLocal.mock.calls.at(-1)?.[1]).toMatchObject({ params: { cwd: "/remote/other" } });
  });

  it.each([
    { code: -32000, message: "connection lost" },
    { code: -32094, message: "push rejected" },
  ])("never repeats a possibly executed mutation after %j", async (failure) => {
    const send = vi.fn().mockRejectedValue(failure);
    const sendLocal = vi.fn();
    const request = createRendererSshGitSender({
      hostId: "ssh",
      send,
      sendLocal,
      isCurrent: () => true,
    });
    await expect(request("codexhost/git/commit", { cwd: "/repo", message: "commit" })).rejects.toBe(
      failure,
    );
    expect(sendLocal).not.toHaveBeenCalled();
  });

  it("forwards repository directory browsing to the saved SSH host", async () => {
    const send = vi.fn().mockRejectedValue({ code: -32601 });
    const sendLocal = vi.fn().mockResolvedValue({
      project: "/remote/project",
      path: "/remote",
      parent: "/",
      entries: [{ name: "project", path: "/remote/project" }],
      truncated: false,
    });
    const request = createRendererSshGitSender({
      hostId: "ssh",
      send,
      sendLocal,
      isCurrent: () => true,
    });
    await expect(
      request("codexhost/git/repository/directories", {
        cwd: "/remote/project",
        path: "/remote",
      }),
    ).resolves.toMatchObject({ path: "/remote" });
    expect(sendLocal).toHaveBeenCalledWith("codexhost/ssh/git", {
      hostId: "ssh",
      method: "codexhost/git/repository/directories",
      params: { cwd: "/remote/project", path: "/remote" },
    });
  });

  it("keeps native extension support and unrelated methods on the original Host", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ branch: "main" })
      .mockRejectedValue({ code: -32601 });
    const sendLocal = vi.fn();
    const request = createRendererSshGitSender({
      hostId: "ssh",
      send,
      sendLocal,
      isCurrent: () => true,
    });
    expect(await request("codexhost/git/status", { cwd: "/repo" })).toEqual({ branch: "main" });
    await expect(request("codexhost/harness/inspect", {})).rejects.toMatchObject({ code: -32601 });
    expect(sendLocal).not.toHaveBeenCalled();
  });

  it("cancels fallback when the remote manager changes while reading thread metadata", async () => {
    let current = true;
    const send = vi.fn(async (method: string) => {
      if (method !== "thread/read") throw { code: -32601 };
      current = false;
      return { thread: { cwd: "/old" } };
    });
    const sendLocal = vi.fn();
    const request = createRendererSshGitSender({
      hostId: "ssh",
      send,
      sendLocal,
      isCurrent: () => current,
    });
    await expect(request("codexhost/git/push", { threadId: "old" })).rejects.toThrow(
      "SSH 连接已变化",
    );
    expect(sendLocal).not.toHaveBeenCalled();
  });
});
