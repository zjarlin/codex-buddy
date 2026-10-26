import { expect, test, vi } from "vitest";
import { hostThreadIdSchema, type GitWorkspaceStatus } from "@codexhost/shared-contracts";
import { RendererGitCache } from "../src/renderer-git-cache.js";
import { gitStatusSignature, reuseGitStatus } from "../src/renderer-git-status.js";
import type { RendererGitClient } from "../src/renderer-git-sidebar.js";

const threadId = hostThreadIdSchema.parse("thread-status");
const status: GitWorkspaceStatus = {
  workspace: "/repo",
  branch: "main",
  detached: false,
  head: "abc123",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  operation: null,
  conflicts: [],
  submodules: [{ path: "vendor/lib", status: "uninitialized" }],
  changes: [
    {
      path: "src/app.ts",
      indexStatus: " ",
      workTreeStatus: "M",
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      submodule: null,
    },
  ],
};
const clientWith = (inspectGitStatus: RendererGitClient["inspectGitStatus"]) =>
  ({ inspectGitStatus }) as RendererGitClient;

test("reuses the previous status when a refresh returns the same content", () => {
  const next = structuredClone(status);
  expect(gitStatusSignature(next)).toBe(gitStatusSignature(status));
  expect(reuseGitStatus(status, next)).toBe(status);
  expect(reuseGitStatus(undefined, next)).toBe(next);
  const changed = { ...structuredClone(status), workTree: undefined, branch: "dev" };
  expect(reuseGitStatus(status, changed as GitWorkspaceStatus)).toBe(changed);
  const edited = structuredClone(status);
  edited.changes[0]!.workTreeStatus = "A";
  expect(reuseGitStatus(status, edited)).toBe(edited);
  const staged = structuredClone(status);
  staged.changes[0]!.staged = true;
  expect(reuseGitStatus(status, staged)).toBe(staged);
});

test("periodic refresh keeps object identity and explicit refresh still re-reads", async () => {
  const cache = new RendererGitCache();
  const read = vi.fn(async () => structuredClone(status));
  const client = clientWith(read);
  const first = await cache.status(client, { threadId });
  // 新鲜期内普通读取直接用缓存，不重复请求 Host。
  expect(await cache.status(client, { threadId })).toBe(first);
  expect(read).toHaveBeenCalledTimes(1);
  // 周期刷新跳过新鲜度判断重新读取，但内容相同即沿用同一对象，界面无需重建列表。
  const refreshed = await cache.status(client, { threadId }, undefined, { fresh: true });
  expect(read).toHaveBeenCalledTimes(2);
  expect(refreshed).toBe(first);
  expect(cache.peekStatus(client, { threadId })).toBe(first);
  read.mockResolvedValueOnce({ ...structuredClone(status), ahead: 2 });
  const advanced = await cache.status(client, { threadId }, undefined, { fresh: true });
  expect(advanced).not.toBe(first);
  expect(advanced.ahead).toBe(2);
  expect(cache.peekStatus(client, { threadId })).toBe(advanced);
});

test("refresh keeps child repository keys independent", async () => {
  const cache = new RendererGitCache();
  const read = vi.fn(async ({ repository }: { repository?: string }) => ({
    ...structuredClone(status),
    workspace: repository ?? "/repo",
  }));
  const client = clientWith(read);
  const parent = await cache.status(client, { threadId });
  const child = await cache.status(client, { threadId }, "/repo/child");
  expect(child.workspace).toBe("/repo/child");
  expect(await cache.status(client, { threadId }, "/repo/child", { fresh: true })).toBe(child);
  expect(await cache.status(client, { threadId }, undefined, { fresh: true })).toBe(parent);
});
