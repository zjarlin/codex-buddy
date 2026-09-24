import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";
import { BuddyPlanner } from "../../src/buddy/planner.js";

function runningPlanner(options: null | { label: string }[] = [{ label: "A" }]) {
  const question = { id: "decision", header: "范围", question: "选哪个方案？", options };
  const inputChanged = vi.fn();
  const respond = vi.fn<(message: JsonObject) => Promise<void>>(async () => undefined);
  const request = vi.fn(async (method: string) => {
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
  });
  const planner = new BuddyPlanner(request, respond, () => undefined);
  const controller = new AbortController();
  const completion = planner.plan({
    ownerThreadId: "work",
    inputChanged,
    model: "planner",
    cwd: "/tmp",
    task: [],
    context: "",
    signal: controller.signal,
  });
  const answer = {
    threadId: "work",
    requestId: "question",
    answers: { decision: { answers: ["A"] } },
  };
  const finish = () => {
    planner.observe({
      method: "item/completed",
      params: {
        threadId: "planner",
        item: {
          type: "agentMessage",
          text: JSON.stringify({
            goal: "目标",
            steps: ["处理"],
            checks: ["验证"],
            clarification: null,
          }),
        },
      },
    });
    planner.observe({
      method: "turn/completed",
      params: { threadId: "planner", turn: { status: "completed" } },
    });
  };
  return { planner, request, respond, inputChanged, controller, completion, answer, finish };
}

afterEach(() => vi.useRealTimers());

describe("BuddyPlanner user input", () => {
  it.each([null, [{ label: "A" }]])(
    "waits for real answers and resumes the same plan (%j)",
    async (options) => {
      const f = runningPlanner(options);
      await vi.waitFor(() => expect(f.inputChanged).toHaveBeenCalled());
      expect(f.respond).not.toHaveBeenCalled();
      expect(f.inputChanged).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "question" }),
      );
      await f.planner.answer(f.answer);
      expect(f.respond).toHaveBeenCalledWith({
        id: "question",
        result: { answers: f.answer.answers },
      });
      expect(f.inputChanged).toHaveBeenLastCalledWith(null);
      f.finish();
      await expect(f.completion).resolves.toMatchObject({ goal: "目标" });
      expect(f.request.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(1);
      await expect(f.planner.answer(f.answer)).rejects.toThrow("失效");
    },
  );

  it("rejects wrong threads, stale requests and missing answers without responding", async () => {
    const f = runningPlanner();
    await vi.waitFor(() => expect(f.inputChanged).toHaveBeenCalled());
    await expect(f.planner.answer({ ...f.answer, threadId: "other" })).rejects.toThrow("失效");
    await expect(f.planner.answer({ ...f.answer, requestId: "old" })).rejects.toThrow("失效");
    await expect(f.planner.answer({ ...f.answer, answers: {} })).rejects.toThrow("所有问题");
    expect(f.respond).not.toHaveBeenCalled();
    const cancelled = expect(f.completion).rejects.toThrow("取消");
    f.controller.abort();
    await cancelled;
    expect(f.respond).toHaveBeenCalledWith({
      id: "question",
      error: expect.objectContaining({ code: -32800 }),
    });
    expect(f.inputChanged).toHaveBeenLastCalledWith(null);
    await expect(f.planner.answer(f.answer)).rejects.toThrow("失效");
  });

  it("pauses the timeout during input and restores it after the answer", async () => {
    vi.useFakeTimers();
    const f = runningPlanner();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(f.request.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
    await f.planner.answer(f.answer);
    const timeout = expect(f.completion).rejects.toThrow("超过三分钟");
    await vi.advanceTimersByTimeAsync(180_000);
    await timeout;
  });

  it("preserves the next question if it arrives while delivering the previous answer", async () => {
    const f = runningPlanner();
    await vi.waitFor(() => expect(f.inputChanged).toHaveBeenCalled());
    f.respond.mockImplementationOnce(async () => {
      f.planner.observe({
        id: "next",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "planner",
          questions: [{ id: "decision", header: "补充", question: "补充什么？", options: null }],
        },
      });
    });
    await f.planner.answer(f.answer);
    expect(f.inputChanged).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "next" }));
    await f.planner.answer({ ...f.answer, requestId: "next" });
    f.finish();
    await f.completion;
  });

  it("keeps answers retryable on send failure and prevents duplicate submissions", async () => {
    const f = runningPlanner();
    await vi.waitFor(() => expect(f.inputChanged).toHaveBeenCalled());
    f.respond.mockRejectedValueOnce(new Error("connection lost"));
    await expect(f.planner.answer(f.answer)).rejects.toThrow("connection lost");
    let release!: () => void;
    f.respond.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const sent = f.planner.answer(f.answer);
    await expect(f.planner.answer(f.answer)).rejects.toThrow("正在提交");
    release();
    await sent;
    f.finish();
    await f.completion;
  });
});
