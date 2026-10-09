import { describe, expect, it, vi } from "vitest";
import { NativeContextCompaction } from "../../src/buddy/context-compaction.js";
import type { NativeRequest } from "../../src/buddy/native.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  let turn = { id: "failed", status: "failed", items: [] as { type: string }[] };
  const request = vi.fn<NativeRequest>(async (method) => {
    if (method === "thread/read")
      return { result: { thread: { status: { type: "idle" }, turns: [turn] } } };
    return { result: {} };
  });
  const service = new NativeContextCompaction(request);
  const controller = new AbortController();
  const start = () => service.compact("thread", "failed", controller.signal);
  const event = (method: string, params: Record<string, never> | object) =>
    service.observe({ method, params: { threadId: "thread", ...params } });
  const started = () => event("turn/started", { turn: { id: "compact" } });
  const item = () =>
    event("item/completed", { turnId: "compact", item: { type: "contextCompaction" } });
  const complete = (status = "completed", persisted = true) => {
    if (persisted) turn = { id: "compact", status, items: [{ type: "contextCompaction" }] };
    event("turn/completed", {
      turn: { id: "compact", status, error: { message: "compact rejected" } },
    });
  };
  return { service, request, controller, start, started, item, complete, event };
}

describe("native context compaction", () => {
  it("reserves the thread before history reads and refuses concurrent compaction", async () => {
    const f = fixture();
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow("取消或超时");
    await expect(f.start()).rejects.toThrow("正在压缩");
    await flush();
    f.controller.abort();
    await rejected;
  });

  it("cancels a pending history read without sending a compact request", async () => {
    const f = fixture();
    f.request.mockImplementation(() => new Promise(() => {}));
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow("取消或超时");
    f.controller.abort();
    await rejected;
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(["thread/read"]);
  });

  it("waits for completion and saved history, not just the RPC acknowledgement", async () => {
    const f = fixture();
    const settled = vi.fn();
    const pending = f.start().then((id) => {
      settled(id);
      return id;
    });
    await flush();
    expect(f.request).toHaveBeenCalledWith("thread/compact/start", { threadId: "thread" });
    expect(settled).not.toHaveBeenCalled();
    f.started();
    f.item();
    await flush();
    expect(settled).not.toHaveBeenCalled();
    f.complete();
    await expect(pending).resolves.toBe("compact");
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      "thread/read",
      "thread/resume",
      "thread/read",
      "thread/compact/start",
      "thread/read",
    ]);
  });

  it.each(["failed", "interrupted"])("rejects a %s compact turn", async (status) => {
    const f = fixture();
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow("原生压缩未成功");
    await flush();
    f.started();
    f.item();
    f.complete(status);
    await rejected;
  });

  it("requires both the compact item and persisted latest compact turn", async () => {
    for (const missing of ["item", "history"]) {
      const f = fixture();
      const pending = f.start();
      const rejected = expect(pending).rejects.toThrow(
        missing === "item" ? "原生压缩未成功" : "历史未确认",
      );
      await flush();
      f.started();
      if (missing !== "item") f.item();
      f.complete("completed", missing !== "history");
      await rejected;
    }
  });

  it("does not accept a compact item from an unrelated turn", async () => {
    const f = fixture();
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow("原生压缩未成功");
    await flush();
    f.started();
    f.event("item/completed", { turnId: "other", item: { type: "contextCompaction" } });
    f.complete();
    await rejected;
  });

  it("stops on cancellation even when the compact RPC result is unknown", async () => {
    const f = fixture();
    f.request.mockImplementation(async (method) => {
      if (method === "thread/read")
        return { result: { thread: { turns: [{ id: "failed", status: "failed" }] } } };
      if (method === "thread/compact/start") return new Promise(() => {});
      return { result: {} };
    });
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow("取消或超时");
    await flush();
    f.controller.abort();
    await rejected;
  });

  it("rejects request errors without editing history or starting another turn", async () => {
    const f = fixture();
    f.request.mockImplementation(async (method) =>
      method === "thread/read"
        ? { result: { thread: { turns: [{ id: "failed", status: "failed" }] } } }
        : method === "thread/compact/start"
          ? { error: { message: "HTTP 400 prompt is too long" } }
          : { result: {} },
    );
    await expect(f.start()).rejects.toThrow("HTTP 400");
    expect(f.request.mock.calls.map(([method]) => method)).not.toContain("turn/start");
  });
});
