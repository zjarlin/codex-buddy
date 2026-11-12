import { describe, expect, it, vi } from "vitest";
import { createRendererModelClient } from "../src/renderer-model-client.js";

const threadId = "019a6f81-f363-7b0a-8c7a-177196428999";

describe("workspace chat creation", () => {
  function fixture(existing = true) {
    const sendRequest = vi.fn(async (method: string): Promise<unknown> => {
      if (method === "thread/start") return { thread: { id: threadId, cwd: "/repo" } };
      if (method === "project/list") {
        return { data: existing ? [{ id: "project", roots: [{ path: "/repo" }] }] : [] };
      }
      return {};
    });
    const client = createRendererModelClient([{ sendRequest }]);
    if (!client?.createThread) throw new Error("Fixture client unavailable");
    return { sendRequest, create: client.createThread };
  }

  it("uses native defaults and attaches the chat to the existing project", async () => {
    const { sendRequest, create } = fixture();
    await expect(create("/repo")).resolves.toBe(threadId);
    expect(sendRequest.mock.calls).toEqual([
      [
        "thread/start",
        { cwd: "/repo", experimentalRawEvents: false, persistExtendedHistory: true },
        { priority: "interactive" },
      ],
      [
        "project/list",
        { limit: 1000, sortKey: "position", sortDirection: "asc" },
        { priority: "interactive" },
      ],
      ["thread/metadata/update", { threadId, projectId: "project" }, { priority: "interactive" }],
    ]);
  });

  it("registers the selected repository as a project when needed", async () => {
    const { sendRequest, create } = fixture(false);
    await create("/repo");
    expect(sendRequest).toHaveBeenLastCalledWith(
      "project/import",
      expect.objectContaining({
        name: "repo",
        roots: [{ path: "/repo" }],
        threads: [threadId],
      }),
      { priority: "interactive" },
    );
  });

  it("rejects an unconfirmed creation without retrying", async () => {
    const { sendRequest, create } = fixture();
    sendRequest.mockResolvedValueOnce({ thread: {} });
    await expect(create("/repo")).rejects.toThrow("未返回有效的会话 ID");
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects a workspace mismatch and retains the created identity", async () => {
    const { sendRequest, create } = fixture();
    sendRequest.mockResolvedValueOnce({ thread: { id: threadId, cwd: "/other" } });
    await expect(create("/repo")).rejects.toThrow(threadId);
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("retains the chat identity when project registration fails", async () => {
    const { sendRequest, create } = fixture();
    sendRequest.mockImplementation(async (method) => {
      if (method === "thread/start") return { thread: { id: threadId, cwd: "/repo" } };
      throw new Error("project service unavailable");
    });
    await expect(create("/repo")).rejects.toThrow(`会话 ${threadId} 已创建，但项目登记失败`);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });
});
