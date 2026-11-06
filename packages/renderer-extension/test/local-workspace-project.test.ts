import { describe, expect, it, vi } from "vitest";
import {
  cachedLocalWorkspaceProject,
  resolveLocalWorkspaceProject,
} from "../src/local-workspace-project.js";
import type { LocalWorkspaceContext } from "../src/local-workspace-context.js";

const context: LocalWorkspaceContext = {
  hostId: "ssh:mac",
  threadId: "chat",
  cwd: "/old",
  remote: "https://example.test/old.git",
  title: "chat",
  text: "history",
  capturedAt: 1000,
  truncated: false,
};
function fixture() {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
  const sendRequest = vi.fn(async () => ({ remote: "https://example.test/current.git" }));
  return {
    context,
    cwd: "/current",
    manager: { sendRequest },
    local: null,
    storage,
    isCurrent: () => true,
  };
}

describe("local continuation project metadata", () => {
  it("reads the current project and retains its origin across failure and another conversation", async () => {
    const input = fixture();
    const online = await resolveLocalWorkspaceProject(input);
    expect(input.manager.sendRequest).toHaveBeenCalledWith(
      "codexhost/git/origin",
      { cwd: "/current" },
      expect.anything(),
    );
    expect(online.context).toMatchObject({
      cwd: "/current",
      remote: "https://example.test/current.git",
      text: "history",
    });
    input.manager.sendRequest.mockRejectedValue(new Error("offline"));
    const offline = await resolveLocalWorkspaceProject({
      ...input,
      context: { ...context, threadId: "another" },
    });
    expect(cachedLocalWorkspaceProject(input.storage, { ...context, cwd: "/current" }).remote).toBe(
      online.context.remote,
    );
    expect(offline.cached).toBe(true);
    expect(offline.context.remote).toBe(online.context.remote);
  });

  it("does not reuse another host or moved project's origin", async () => {
    const input = fixture();
    await resolveLocalWorkspaceProject(input);
    input.manager.sendRequest.mockRejectedValue(new Error("offline"));
    expect(
      (
        await resolveLocalWorkspaceProject({
          ...input,
          context: { ...context, hostId: "ssh:other" },
        })
      ).context.remote,
    ).toBe("");
    expect((await resolveLocalWorkspaceProject({ ...input, cwd: "/new" })).context.remote).toBe("");
  });

  it("clears a removed origin instead of reviving stale thread metadata", async () => {
    const input = fixture();
    await resolveLocalWorkspaceProject(input);
    const empty = { sendRequest: vi.fn(async () => ({ remote: null })) };
    const result = await resolveLocalWorkspaceProject({ ...input, manager: empty });
    expect(result.cached).toBe(false);
    expect(result.context.remote).toBe("");
    input.manager.sendRequest.mockRejectedValue(new Error("offline"));
    expect((await resolveLocalWorkspaceProject(input)).context.remote).toBe("");
  });

  it("uses the existing local SSH Git channel when the remote extension is unavailable", async () => {
    const input = fixture();
    input.manager.sendRequest.mockRejectedValue(
      Object.assign(new Error("unsupported"), { code: -32601 }),
    );
    const local = { sendRequest: vi.fn(async () => ({ remote: "https://example.test/ssh.git" })) };
    const result = await resolveLocalWorkspaceProject({ ...input, local });
    expect(local.sendRequest).toHaveBeenCalledWith(
      "codexhost/ssh/git",
      { hostId: "ssh:mac", method: "codexhost/git/origin", params: { cwd: "/current" } },
      expect.anything(),
    );
    expect(result.context.remote).toBe("https://example.test/ssh.git");
  });
});
