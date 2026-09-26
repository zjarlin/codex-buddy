import { describe, expect, it } from "vitest";

import {
  threadTerminalListResultSchema,
  threadTerminalOpenParamsSchema,
  threadTerminalOpenResultSchema,
} from "../src/index.js";

describe("thread terminal contracts", () => {
  it("accepts a thread id and rejects any injected command or path", () => {
    expect(threadTerminalOpenParamsSchema.parse({ threadId: "thread-1" })).toEqual({
      threadId: "thread-1",
    });
    expect(
      threadTerminalOpenParamsSchema.parse({ threadId: "thread-1", terminalId: "ghostty" }),
    ).toEqual({ threadId: "thread-1", terminalId: "ghostty" });
    expect(threadTerminalOpenParamsSchema.safeParse({}).success).toBe(false);
    expect(threadTerminalOpenParamsSchema.safeParse({ threadId: " " }).success).toBe(false);
    expect(
      threadTerminalOpenParamsSchema.safeParse({ threadId: "thread-1", cwd: "/tmp" }).success,
    ).toBe(false);
    expect(
      threadTerminalOpenParamsSchema.safeParse({ threadId: "thread-1", command: "rm -rf /" })
        .success,
    ).toBe(false);
    expect(
      threadTerminalOpenParamsSchema.safeParse({ threadId: "thread-1", terminalId: "/bin/sh" })
        .success,
    ).toBe(false);
  });

  it("bounds the reported terminal and workspace", () => {
    expect(
      threadTerminalOpenResultSchema.parse({
        workspace: "/tmp/repo",
        terminal: "apple-terminal",
        mode: "resume",
      }),
    ).toEqual({ workspace: "/tmp/repo", terminal: "apple-terminal", mode: "resume" });
    expect(
      threadTerminalOpenResultSchema.safeParse({
        workspace: "",
        terminal: "apple-terminal",
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
        terminal: "apple-terminal",
        mode: "open",
      }).success,
    ).toBe(false);
  });

  it("bounds the advertised terminals and their installation state", () => {
    expect(
      threadTerminalListResultSchema.parse({
        terminals: [
          { id: "apple-terminal", name: "Terminal", installed: true, default: true },
          { id: "ghostty", name: "Ghostty", installed: false, default: false },
        ],
      }),
    ).toMatchObject({ terminals: [{ id: "apple-terminal" }, { id: "ghostty" }] });
    expect(
      threadTerminalListResultSchema.safeParse({
        terminals: [{ id: "arbitrary", name: "Arbitrary", installed: true, default: true }],
      }).success,
    ).toBe(false);
  });
});
