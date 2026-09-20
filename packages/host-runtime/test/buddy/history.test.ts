import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recentMessages } from "../../src/buddy/history.js";
import type { NativeRequest } from "../../src/buddy/planner.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Buddy unmaterialized history", () => {
  async function fixture(
    options: { preview?: string; forkedFromId?: string; exists?: boolean } = {},
  ) {
    const dir = await mkdtemp(join(tmpdir(), "buddy-history-test-"));
    directories.push(dir);
    const path = join(dir, "rollout.jsonl");
    if (options.exists) {
      await writeFile(path, "{}");
    }
    const request = vi.fn<NativeRequest>(async (method) => {
      if (method === "thread/read") {
        return {
          result: {
            thread: {
              ephemeral: false,
              preview: options.preview ?? "",
              forkedFromId: options.forkedFromId ?? null,
              path,
              turns: [],
            },
          },
        };
      }
      return {
        error: {
          code: -32600,
          message: "invalid paginated history lineage for work: missing source rollout",
        },
      };
    });
    return request;
  }

  it("does not request history before a blank non-forked thread has a rollout", async () => {
    const request = await fixture();
    await expect(recentMessages(request, "work")).resolves.toEqual([]);
    expect(request.mock.calls).toEqual([
      ["thread/read", { threadId: "work", includeTurns: false }],
    ]);
  });

  it.each([{ preview: "已有消息" }, { forkedFromId: "parent" }, { exists: true }])(
    "does not hide missing lineage for a potentially populated thread: %j",
    async (options) => {
      const request = await fixture(options);
      await expect(recentMessages(request, "work")).rejects.toThrow("missing source rollout");
      expect(request).toHaveBeenCalledWith("thread/items/list", expect.any(Object));
    },
  );
});
