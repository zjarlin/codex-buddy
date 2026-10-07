import { afterEach, expect, test, vi } from "vitest";
import {
  hostThreadIdSchema,
  type GitWorkspaceStatus,
  type GitWorkspaceParams,
} from "@codexhost/shared-contracts";
import { RendererGitCache } from "../src/renderer-git-cache.js";
import type { RendererGitClient } from "../src/renderer-git-sidebar.js";

const threadId = hostThreadIdSchema.parse("thread-cache");
const status = { workspace: "/repo", changes: [] } as unknown as GitWorkspaceStatus;
const clientWith = (inspectGitStatus: RendererGitClient["inspectGitStatus"]) =>
  ({ inspectGitStatus }) as RendererGitClient;
afterEach(() => vi.useRealTimers());

test("isolates repository snapshots within the same chat", async () => {
  const cache = new RendererGitCache();
  const read = vi.fn(async ({ repository }: GitWorkspaceParams) => ({
    ...status,
    workspace: repository ?? "/backend",
  }));
  const client = clientWith(read);
  await Promise.all([
    cache.status(client, { threadId }),
    cache.status(client, { threadId }, "/frontend"),
  ]);
  expect(cache.peekStatus(client, { threadId })?.workspace).toBe("/backend");
  expect(cache.peekStatus(client, { threadId }, "/frontend")?.workspace).toBe("/frontend");
  await cache.status(client, { threadId }, "/frontend");
  expect(read).toHaveBeenCalledTimes(2);
});

test("coalesces pending reads, reuses fresh status, and refreshes expired snapshots", async () => {
  vi.useFakeTimers();
  const cache = new RendererGitCache();
  let resolve!: (status: GitWorkspaceStatus) => void;
  const read = vi.fn(
    () =>
      new Promise<GitWorkspaceStatus>((done) => {
        resolve = done;
      }),
  );
  const client = clientWith(read);
  const first = cache.status(client, { threadId });
  expect(cache.status(client, { threadId })).toBe(first);
  resolve(status);
  await first;
  expect(await cache.status(client, { threadId })).toBe(status);
  expect(read).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_001);
  expect(cache.peekStatus(client, { threadId })).toBe(status);
  const refresh = cache.status(client, { threadId });
  resolve({ ...status, branch: "updated" });
  expect((await refresh).branch).toBe("updated");
  expect(read).toHaveBeenCalledTimes(2);
});

test("late reads cannot refill invalidated cache and writes seed the latest status", async () => {
  const cache = new RendererGitCache();
  let resolve!: (status: GitWorkspaceStatus) => void;
  const client = clientWith(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = cache.status(client, { threadId });
  const pushed = { ...status, ahead: 0 };
  cache.update(client, { threadId }, pushed);
  resolve(status);
  await pending;
  expect(cache.peekStatus(client, { threadId })).toBe(pushed);
  expect(await cache.status(client, { threadId })).toBe(pushed);
});

test("isolates hosts, retries failures, and evicts old entries", async () => {
  const cache = new RendererGitCache();
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(status);
  const client = clientWith(read);
  await expect(cache.status(client, { threadId })).rejects.toThrow("offline");
  await cache.status(client, { threadId });
  const other = clientWith(vi.fn().mockResolvedValue({ ...status, workspace: "/remote" }));
  expect((await cache.status(other, { threadId })).workspace).toBe("/remote");
  cache.invalidate(client);
  expect(cache.peekStatus(other, { threadId })?.workspace).toBe("/remote");
  for (let index = 0; index < 50; index += 1) {
    await cache.status(client, { threadId: hostThreadIdSchema.parse(`thread-${index}`) });
  }
  expect(cache.peekStatus(client, { threadId: hostThreadIdSchema.parse("thread-0") })).toBeNull();
  expect(cache.peekStatus(client, { threadId: hostThreadIdSchema.parse("thread-49") })).toBe(
    status,
  );
});

test("isolates draft projects, hosts and thread snapshots without sending a synthetic thread", async () => {
  const cache = new RendererGitCache();
  const read = vi.fn(async ({ cwd, repository }: GitWorkspaceParams) => ({
    ...status,
    workspace: repository ?? cwd ?? "/thread-project",
  }));
  const client = clientWith(read);
  const remote = clientWith(vi.fn(async () => ({ ...status, workspace: "/remote-project" })));
  await cache.status(client, { cwd: "/project-a" });
  await cache.status(client, { cwd: "/project-b" });
  await cache.status(client, { cwd: "/project-a" }, "/linked");
  await cache.status(client, { threadId });
  await cache.status(remote, { cwd: "/project-a" });
  expect(cache.peekStatus(client, { cwd: "/project-a" })?.workspace).toBe("/project-a");
  expect(cache.peekStatus(client, { cwd: "/project-b" })?.workspace).toBe("/project-b");
  expect(cache.peekStatus(client, { cwd: "/project-a" }, "/linked")?.workspace).toBe("/linked");
  expect(cache.peekStatus(client, { threadId })?.workspace).toBe("/thread-project");
  expect(cache.peekStatus(remote, { cwd: "/project-a" })?.workspace).toBe("/remote-project");
  await cache.status(client, { cwd: "/project-a" });
  expect(read.mock.calls.map(([input]) => input)).toEqual([
    { cwd: "/project-a" },
    { cwd: "/project-b" },
    { cwd: "/project-a", repository: "/linked" },
    { threadId },
  ]);
});

test("coalesces history and invalidates it after writes", async () => {
  const cache = new RendererGitCache();
  const result = { workspace: "/repo", branch: "main", head: null, refs: [], commits: [] };
  const read = vi.fn(async () => result);
  const client = { ...clientWith(vi.fn()), inspectGitLog: read };
  const first = cache.history(client, { threadId });
  expect(cache.history(client, { threadId })).toBe(first);
  await first;
  await cache.history(client, { threadId });
  expect(read).toHaveBeenCalledTimes(1);
  await cache.history(client, { threadId }, "/child");
  expect(read).toHaveBeenLastCalledWith({ threadId, repository: "/child", limit: 200 });
  cache.update(client, { threadId }, status);
  await cache.history(client, { threadId });
  expect(read).toHaveBeenCalledTimes(3);
});
