import { afterEach, expect, test, vi } from "vitest";
import { hostThreadIdSchema, type GitWorkspaceStatus } from "@codexhost/shared-contracts";
import { RendererGitCache } from "../src/renderer-git-cache.js";
import type { RendererGitClient } from "../src/renderer-git-sidebar.js";

const threadId = hostThreadIdSchema.parse("thread-cache");
const status = { workspace: "/repo", changes: [] } as unknown as GitWorkspaceStatus;
const clientWith = (inspectGitStatus: RendererGitClient["inspectGitStatus"]) =>
  ({ inspectGitStatus }) as RendererGitClient;
afterEach(() => vi.useRealTimers());

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
  const first = cache.status(client, threadId);
  expect(cache.status(client, threadId)).toBe(first);
  resolve(status);
  await first;
  expect(await cache.status(client, threadId)).toBe(status);
  expect(read).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_001);
  expect(cache.peekStatus(client, threadId)).toBe(status);
  const refresh = cache.status(client, threadId);
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
  const pending = cache.status(client, threadId);
  const pushed = { ...status, ahead: 0 };
  cache.update(client, threadId, pushed);
  resolve(status);
  await pending;
  expect(cache.peekStatus(client, threadId)).toBe(pushed);
  expect(await cache.status(client, threadId)).toBe(pushed);
});

test("isolates hosts, retries failures, and evicts old entries", async () => {
  const cache = new RendererGitCache();
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(status);
  const client = clientWith(read);
  await expect(cache.status(client, threadId)).rejects.toThrow("offline");
  await cache.status(client, threadId);
  const other = clientWith(vi.fn().mockResolvedValue({ ...status, workspace: "/remote" }));
  expect((await cache.status(other, threadId)).workspace).toBe("/remote");
  cache.invalidate(client);
  expect(cache.peekStatus(other, threadId)?.workspace).toBe("/remote");
  for (let index = 0; index < 50; index += 1) {
    await cache.status(client, hostThreadIdSchema.parse(`thread-${index}`));
  }
  expect(cache.peekStatus(client, hostThreadIdSchema.parse("thread-0"))).toBeNull();
  expect(cache.peekStatus(client, hostThreadIdSchema.parse("thread-49"))).toBe(status);
});
