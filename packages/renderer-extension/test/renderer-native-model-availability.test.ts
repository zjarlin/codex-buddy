import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererModelClient } from "../src/renderer-model-client.js";

function fixture() {
  const listeners = new Set<(value: unknown) => void>();
  const emit = (method: string, params: unknown) => {
    for (const listener of listeners) listener({ method, params });
  };
  let provider = "remote-provider";
  let mode: "success" | "empty" | "failed" | "timeout" | "substitute" = "success";
  let sequence = 0;
  const sendRequest = vi.fn(async (method: string, input: unknown): Promise<unknown> => {
    const params = input as Record<string, unknown>;
    switch (method) {
      case "codexhost/models/availability":
        throw Object.assign(new Error("method not found"), { code: -32601 });
      case "config/read":
        return { config: { model_provider: provider } };
      case "account/read":
        return { account: { type: "apiKey" } };
      case "model/list":
        return params.cursor
          ? { data: [{ id: "alias-b", model: "remote-b" }], nextCursor: null }
          : { data: [{ id: "alias-a", model: "remote-a" }], nextCursor: "page-2" };
      case "thread/start":
        return {
          model: mode === "substitute" ? "different-model" : params.model,
          thread: { id: `probe-${++sequence}` },
        };
      case "turn/start": {
        const turn = {
          id: `turn-${params.threadId}`,
          status: mode === "failed" ? "failed" : "completed",
        };
        emit("turn/started", { threadId: params.threadId, turn });
        if (mode !== "timeout") {
          if (mode === "success")
            emit("item/completed", {
              threadId: params.threadId,
              item: { type: "agentMessage", text: "OK" },
            });
          emit("turn/completed", { threadId: params.threadId, turn });
        }
        return { turn };
      }
      case "thread/unsubscribe":
      case "turn/interrupt":
        return {};
      default:
        throw new Error(`Unexpected method: ${method}`);
    }
  });
  const client = createRendererModelClient([
    {
      sendRequest,
      addNotificationCallback(_methods, listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  ]);
  if (!client?.modelAvailability) throw new Error("Expected model availability client");
  return {
    probe: client.modelAvailability,
    client,
    sendRequest,
    listeners,
    emit,
    setProvider: (value: string) => {
      provider = value;
    },
    setMode: (value: typeof mode) => {
      mode = value;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("native remote model availability", () => {
  it("opens an unsupported connection without probing or reading local configuration", async () => {
    const f = fixture();
    expect(await f.probe({ action: "read" })).toEqual({
      provider: "",
      checkedAt: null,
      results: [],
    });
    expect(f.sendRequest).toHaveBeenCalledOnce();
    await f.probe({ action: "read" });
    expect(f.sendRequest).toHaveBeenCalledOnce();
  });

  it("probes every remote page and exact supplied ID using ephemeral native turns", async () => {
    const f = fixture();
    const snapshot = await f.probe({
      action: "probe",
      modelIds: ["custom/model", "remote-a"],
    });
    expect(snapshot.provider).toBe("remote-provider");
    expect(snapshot.results.map(({ id, status }) => [id, status])).toEqual([
      ["custom/model", "available"],
      ["remote-a", "available"],
      ["remote-b", "available"],
    ]);
    expect(f.sendRequest).toHaveBeenCalledWith(
      "thread/start",
      expect.objectContaining({
        model: "custom/model",
        ephemeral: true,
        allowProviderModelFallback: false,
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
      { priority: "interactive" },
    );
    expect(
      f.sendRequest.mock.calls.filter(([method]) => method === "thread/unsubscribe"),
    ).toHaveLength(3);
    expect(f.listeners.size).toBe(0);
    expect(await f.probe({ action: "read" })).toEqual(snapshot);
    expect(f.sendRequest.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(3);
    f.setProvider("other-remote-provider");
    expect((await f.probe({ action: "read" })).results).toEqual([]);
  });

  it.each(["empty", "failed", "substitute"] as const)(
    "does not count %s as model availability",
    async (mode) => {
      const f = fixture();
      f.setMode(mode);
      const snapshot = await f.probe({ action: "probe" });
      expect(snapshot.results).toHaveLength(2);
      expect(snapshot.results.every(({ status }) => status === "unavailable")).toBe(true);
      if (mode === "substitute")
        expect(f.sendRequest.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
      expect(f.listeners.size).toBe(0);
    },
  );

  it("interrupts timed out turns, releases threads and removes listeners", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.setMode("timeout");
    const pending = f.probe({ action: "probe" });
    await vi.waitFor(() =>
      expect(f.sendRequest.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(
        2,
      ),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    const snapshot = await pending;
    expect(snapshot.results.every(({ error }) => error?.includes("超时"))).toBe(true);
    expect(f.sendRequest.mock.calls.filter(([method]) => method === "turn/interrupt")).toHaveLength(
      2,
    );
    expect(f.listeners.size).toBe(0);
  });

  it("coalesces concurrent probes and keeps snapshots isolated by connection", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.probe({ action: "probe" }),
      f.probe({ action: "probe" }),
    ]);
    expect(first).toEqual(second);
    expect(f.sendRequest.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(
      2,
    );
    expect((await fixture().probe({ action: "read" })).results).toEqual([]);
  });

  it("does not turn transport errors into native probes", async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error("connection reset"));
    const client = createRendererModelClient([{ sendRequest }]);
    if (!client?.modelAvailability) throw new Error("Expected model availability client");
    await expect(client.modelAvailability({ action: "probe" })).rejects.toThrow("connection reset");
    expect(sendRequest).toHaveBeenCalledOnce();
  });

  it("releases a Thread whose creation arrives after the timeout without starting a Turn", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const original = f.sendRequest.getMockImplementation();
    if (!original) throw new Error("Expected request implementation");
    const resolveStarts: Array<(value: unknown) => void> = [];
    f.sendRequest.mockImplementation((method, params) =>
      method === "thread/start"
        ? new Promise((resolve) => {
            resolveStarts.push(resolve);
          })
        : original(method, params),
    );
    const pending = f.probe({ action: "probe" });
    await vi.waitFor(() => expect(resolveStarts).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).results.every(({ status }) => status === "unavailable")).toBe(true);
    resolveStarts.forEach((resolve, index) => resolve({ thread: { id: `late-${index}` } }));
    await vi.waitFor(() =>
      expect(
        f.sendRequest.mock.calls.filter(([method]) => method === "thread/unsubscribe"),
      ).toHaveLength(2),
    );
    expect(f.sendRequest.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    expect(f.listeners.size).toBe(0);
  });

  it("limits native concurrency to four and rejects results if the Provider changes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.setMode("timeout");
    const pending = f.probe({ action: "probe", modelIds: ["extra-1", "extra-2", "extra-3"] });
    const rejected = expect(pending).rejects.toThrow("Provider 或账号已变化");
    await vi.waitFor(() =>
      expect(f.sendRequest.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(
        4,
      ),
    );
    f.setProvider("other-provider");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.sendRequest.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect((await f.probe({ action: "read" })).results).toEqual([]);
    expect(f.listeners.size).toBe(0);
  });
});
