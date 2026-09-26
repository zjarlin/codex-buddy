import { describe, expect, it } from "vitest";

import { threadTerminalOpenParamsSchema, threadTerminalOpenResultSchema } from "../src/index.js";

describe("thread terminal contracts", () => {
  it("accepts a thread id and rejects any injected command or path", () => {
    expect(threadTerminalOpenParamsSchema.parse({ threadId: "thread-1" })).toEqual({
      threadId: "thread-1",
    });
    expect(threadTerminalOpenParamsSchema.safeParse({}).success).toBe(false);
    expect(threadTerminalOpenParamsSchema.safeParse({ threadId: " " }).success).toBe(false);
    expect(
      threadTerminalOpenParamsSchema.safeParse({ threadId: "thread-1", cwd: "/tmp" }).success,
    ).toBe(false);
    expect(
      threadTerminalOpenParamsSchema.safeParse({ threadId: "thread-1", command: "rm -rf /" })
        .success,
    ).toBe(false);
  });

  it("bounds the reported terminal and workspace", () => {
    expect(
      threadTerminalOpenResultSchema.parse({
        workspace: "/tmp/repo",
        terminal: "terminal",
        mode: "resume",
      }),
    ).toEqual({ workspace: "/tmp/repo", terminal: "terminal", mode: "resume" });
    expect(
      threadTerminalOpenResultSchema.safeParse({
        workspace: "",
        terminal: "terminal",
        mode: "resume",
      }).success,
    ).toBe(false);
    expect(
      threadTerminalOpenResultSchema.safeParse({
        workspace: "/tmp/repo",
        terminal: "bash",
        mode: "resume",
      }).success,
    ).toBe(false);
    expect(
      threadTerminalOpenResultSchema.safeParse({
        workspace: "/tmp/repo",
        terminal: "terminal",
        mode: "open",
      }).success,
    ).toBe(false);
  });
});
