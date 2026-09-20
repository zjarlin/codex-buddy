import { describe, expect, it, vi } from "vitest";
import { BuddyPlanner } from "../../src/buddy/planner.js";

function runningPlanner(question: { id: string; options: null | { label: string }[] }) {
  // The callbacks need the planner instance while it is being constructed.
  // eslint-disable-next-line prefer-const
  let planner!: BuddyPlanner;
  const respond = vi.fn(async (message) => {
    if ("result" in message) {
      planner.observe({
        method: "item/completed",
        params: {
          threadId: "planner",
          item: {
            type: "agentMessage",
            text: JSON.stringify({
              goal: "目标",
              steps: ["只修改目标文件"],
              checks: ["运行对应测试"],
              clarification: null,
            }),
          },
        },
      });
      planner.observe({
        method: "turn/completed",
        params: { threadId: "planner", turn: { status: "completed" } },
      });
    }
  });
  planner = new BuddyPlanner(
    async (method) => {
      if (method === "thread/start") return { result: { thread: { id: "planner" } } };
      if (method === "turn/start") {
        planner.observe({
          method: "turn/started",
          params: { threadId: "planner", turn: { id: "plan-turn" } },
        });
        planner.observe({
          id: "question",
          method: "item/tool/requestUserInput",
          params: { threadId: "planner", questions: [question] },
        });
        return { result: { turn: { id: "plan-turn" } } };
      }
      return { result: {} };
    },
    respond,
    () => undefined,
  );
  return { planner, respond };
}

describe("BuddyPlanner hidden requests", () => {
  it("answers missing free-text context without waiting for the user", async () => {
    const { planner, respond } = runningPlanner({ id: "url", options: null });
    await expect(
      planner.plan({
        model: "planner",
        cwd: "/tmp",
        task: [],
        context: "",
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ goal: "目标" });
    expect(respond).toHaveBeenCalledWith({
      id: "question",
      result: {
        answers: {
          url: { answers: [expect.stringContaining("未提供额外信息")] },
        },
      },
    });
  });

  it("still rejects planner choices instead of selecting for the user", async () => {
    const { planner, respond } = runningPlanner({
      id: "decision",
      options: [{ label: "A" }],
    });
    await expect(
      planner.plan({
        model: "planner",
        cwd: "/tmp",
        task: [],
        context: "",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("补充任务信息");
    expect(respond).toHaveBeenCalledWith({
      id: "question",
      error: { code: -32090, message: expect.stringContaining("补充任务信息") },
    });
  });
});
