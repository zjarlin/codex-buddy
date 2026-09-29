import { describe, expect, it, vi } from "vitest";

import {
  searchQueuedTransferTargets,
  transferQueuedMessage,
  type QueuedTransferManager,
} from "../src/renderer-queued-transfer.js";

function fixture() {
  const image = { src: "data:image/png;base64,cG5n", previewSrc: "data:image/png;base64,cG5n" };
  const message = {
    id: "queued-1",
    text: "这部分怎么解决？",
    cwd: "/source",
    context: {
      prompt: "这部分怎么解决？",
      workspaceRoots: ["/source"],
      messageThreadId: "source-message-thread",
      imageAttachments: [image],
      fileAttachments: [],
    },
    submission: { status: "queued" },
  };
  const messages = [message];
  const disposed = vi.fn();
  const coordinator = {
    loadMessages: vi.fn(async () => undefined),
    readMessages: vi.fn(() => messages),
    removeQueuedMessage: vi.fn(async (_threadId: string, id: string) => {
      const index = messages.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      const [removed] = messages.splice(index, 1);
      return {
        message: removed,
        index,
        previousMessageId: null,
        nextMessageId: null,
      };
    }),
    restoreQueuedMessage: vi.fn(async (_threadId: string, removed: { message: typeof message }) => {
      messages.push(removed.message);
      return removed.message.id;
    }),
    deferAutomaticTurns: vi.fn(() => ({
      [(Symbol as unknown as { dispose: symbol }).dispose]: disposed,
    })),
  };
  const sendFollowUpMessage = vi.fn(async () => "target-turn");
  const manager: QueuedTransferManager = {
    sendRequest: vi.fn(),
    getTurnCoordinator: () => coordinator,
    getConversationCwd: () => "/target",
    getConversation: () => null,
    sendFollowUpMessage,
  };
  const target = { id: "target", title: "另一个中文会话", cwd: "/target" };
  return { manager, coordinator, disposed, image, message, messages, sendFollowUpMessage, target };
}

describe("queued message conversation transfer", () => {
  it("searches Chinese titles across pages and excludes the source and non-input threads", async () => {
    const f = fixture();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { id: "source", name: "源会话", cwd: "/source" },
          { id: "target", name: "中文目标", cwd: "/target" },
          { id: "subagent", name: "中文子任务", cwd: "/target", canAcceptDirectInput: false },
        ],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        data: [{ id: "another", name: null, preview: "中文预览\n第二行", cwd: "/other" }],
        nextCursor: null,
      });
    f.manager.sendRequest = request;

    await expect(searchQueuedTransferTargets(f.manager, "source", "中文")).resolves.toEqual([
      { id: "target", title: "中文目标", cwd: "/target" },
      { id: "another", title: "中文预览", cwd: "/other" },
    ]);
    expect(request.mock.calls).toEqual([
      ["thread/list", expect.objectContaining({ searchTerm: "中文", archived: false })],
      ["thread/list", expect.objectContaining({ searchTerm: "中文", cursor: "next" })],
    ]);
  });

  it("moves text and image context through Desktop's follow-up path", async () => {
    const f = fixture();
    await transferQueuedMessage({
      manager: f.manager,
      sourceThreadId: "source",
      messageId: f.message.id,
      target: f.target,
    });

    expect(f.messages).toEqual([]);
    expect(f.sendFollowUpMessage).toHaveBeenCalledWith("target", {
      prompt: "这部分怎么解决？",
      attachmentContext: expect.objectContaining({
        imageAttachments: [f.image],
        workspaceRoots: ["/target"],
        messageThreadId: undefined,
      }),
    });
    expect(f.disposed).toHaveBeenCalledOnce();
  });

  it("restores the original position and attachments when delivery fails", async () => {
    const f = fixture();
    f.sendFollowUpMessage.mockRejectedValueOnce(new Error("target unavailable"));
    await expect(
      transferQueuedMessage({
        manager: f.manager,
        sourceThreadId: "source",
        messageId: f.message.id,
        target: f.target,
      }),
    ).rejects.toThrow("target unavailable");

    expect(f.messages).toEqual([f.message]);
    expect(f.coordinator.restoreQueuedMessage).toHaveBeenCalledOnce();
    expect(f.disposed).toHaveBeenCalledOnce();
  });

  it("rejects in-flight messages before changing either conversation", async () => {
    const f = fixture();
    f.message.submission.status = "sending";
    await expect(
      transferQueuedMessage({
        manager: f.manager,
        sourceThreadId: "source",
        messageId: f.message.id,
        target: f.target,
      }),
    ).rejects.toThrow("正在发送或结果未知");
    expect(f.coordinator.removeQueuedMessage).not.toHaveBeenCalled();
    expect(f.sendFollowUpMessage).not.toHaveBeenCalled();
  });
});
