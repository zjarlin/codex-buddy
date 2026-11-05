import { describe, expect, it } from "vitest";
import {
  captureLocalWorkspaceContext,
  localContinuationMessage,
  readLocalWorkspaceContexts,
  saveLocalWorkspaceContext,
} from "../src/local-workspace-context.js";

const thread = {
  id: "remote-chat",
  cwd: "/remote/project",
  name: "Fix pagination",
  gitInfo: { repositoryUrl: "https://example.test/project.git" },
  turns: [
    {
      items: [
        {
          type: "userMessage",
          content: [
            { type: "text", text: "Keep the page in the URL" },
            { type: "image", url: "secret-image-data" },
          ],
        },
        { type: "agentMessage", text: "Use a query parameter" },
        { type: "reasoning", text: "private reasoning" },
        {
          type: "commandExecution",
          command: "git status",
          aggregatedOutput: "working tree clean",
          exitCode: 0,
        },
      ],
    },
  ],
};

describe("local continuation context", () => {
  it("preserves dialogue and tool results without copying attachments or reasoning", () => {
    const context = captureLocalWorkspaceContext("ssh:mac", thread.id, thread, 1000);
    expect(context.text).toContain("Keep the page in the URL");
    expect(context.text).toContain("Use a query parameter");
    expect(context.text).toContain("working tree clean");
    expect(context.text).toContain("attachment not copied");
    expect(context.text).not.toContain("secret-image-data");
    expect(context.text).not.toContain("private reasoning");
    expect(context.truncated).toBe(false);
    const message = localContinuationMessage(context, "/local/公司的项目");
    expect(message).toContain("Current workspace: /local/公司的项目");
    expect(message).toContain("1970-01-01T00:00:01.000Z");
    expect(message).toContain("Do not assume the remote task has stopped");
  });

  it("rejects mismatched identity and missing or empty history", () => {
    expect(() => captureLocalWorkspaceContext("ssh:other", "other", thread)).toThrow();
    expect(() => captureLocalWorkspaceContext("local", thread.id, thread)).toThrow();
    expect(() =>
      captureLocalWorkspaceContext("ssh:mac", thread.id, { ...thread, turns: [] }),
    ).toThrow();
    expect(() =>
      captureLocalWorkspaceContext("ssh:mac", thread.id, { ...thread, turns: undefined }),
    ).toThrow();
  });

  it("bounds large context and explicitly marks truncation", () => {
    const context = captureLocalWorkspaceContext("ssh:mac", thread.id, {
      ...thread,
      turns: [{ items: [{ type: "agentMessage", text: "x".repeat(130_000) + "latest decision" }] }],
    });
    expect(context.text.length).toBeLessThanOrEqual(120_000);
    expect(context.text.endsWith("latest decision")).toBe(true);
    expect(context.truncated).toBe(true);
    expect(localContinuationMessage(context, "/local")).toContain("Only the most recent part");
  });

  it("keeps offline snapshots isolated by host and retains the original capture time", () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, text: string) => {
        value = text;
      },
    };
    const first = captureLocalWorkspaceContext("ssh:a", thread.id, thread, 1000);
    const second = captureLocalWorkspaceContext("ssh:b", thread.id, thread, 2000);
    saveLocalWorkspaceContext(storage, first);
    saveLocalWorkspaceContext(storage, second);
    expect(readLocalWorkspaceContexts(storage)).toEqual([second, first]);
    saveLocalWorkspaceContext(storage, { ...first, text: "new", capturedAt: 3000 });
    expect(readLocalWorkspaceContexts(storage)).toHaveLength(2);
    expect(readLocalWorkspaceContexts(storage)[1]?.capturedAt).toBe(2000);
  });

  it("surfaces storage failures instead of claiming offline context was saved", () => {
    const context = captureLocalWorkspaceContext("ssh:a", thread.id, thread);
    expect(() =>
      saveLocalWorkspaceContext(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
        },
        context,
      ),
    ).toThrow("quota");
  });
});
