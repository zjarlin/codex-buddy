import { describe, expect, it, vi } from "vitest";
import type { RendererHostRoute } from "@codexhost/desktop-control/renderer-bindings";
import {
  BUDDY_CONTINUE_METHOD,
  BUDDY_INTERRUPTED_METHOD,
  nativeContinuationPrompt,
} from "@codexhost/shared-contracts";
import { createRendererModelClient } from "../src/renderer-model-client.js";
import { createRendererHostClients } from "../src/renderer-host-clients.js";

vi.mock("../src/renderer-external-queue.js", () => ({ installRendererExternalQueue: vi.fn() }));
vi.mock("../src/renderer-external-steering.js", () => ({
  installRendererExternalSteering: vi.fn(),
}));
vi.mock("../src/renderer-thread-archive.js", () => ({ installRendererThreadArchive: vi.fn() }));

function missing(method: string, code = -32600) {
  return Object.assign(new Error(`Invalid request: unknown variant \`${method}\``), { code });
}

function metadata(id = "thread", activity = "idle") {
  return {
    id,
    name: `Title ${id}`,
    modelProvider: "custom",
    cliVersion: "0.151.0",
    status: { type: activity },
  };
}

function recoveryClient(client: ReturnType<typeof createRendererModelClient>) {
  if (!client?.buddyInterrupted || !client.buddyContinue) {
    throw new Error("Fixture recovery client unavailable");
  }
  return { buddyInterrupted: client.buddyInterrupted, buddyContinue: client.buddyContinue };
}

function fixture() {
  const state = {
    thread: metadata(),
    turn: { id: "failed-turn", status: "failed" },
  };
  const send = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
    if (method.startsWith("codexhost/")) throw missing(method);
    if (method === "thread/list") return { data: [{ id: "thread" }], nextCursor: null };
    if (method === "thread/read") {
      const full = (params as { includeTurns: boolean }).includeTurns;
      return { thread: { ...state.thread, turns: full ? [state.turn] : [] } };
    }
    if (method === "thread/turns/list") return { data: [state.turn] };
    if (method === "thread/resume") return { thread: state.thread };
    if (method === "turn/start") return { turn: { id: "accepted-turn" } };
    throw new Error(`Unexpected request ${method}`);
  });
  const client = recoveryClient(createRendererModelClient([{ sendRequest: send }]));
  const original = send.getMockImplementation();
  if (!original) throw new Error("Fixture sender unavailable");
  return { state, send, client, original };
}

describe("native recovery on connections without Buddy recovery RPCs", () => {
  it.each([-32600, -32601])(
    "discovers on the same native connection and caches method absence (%s)",
    async (code) => {
      const f = fixture();
      f.send.mockImplementation(async (method, params) => {
        if (method === BUDDY_INTERRUPTED_METHOD) throw missing(method, code);
        return f.original(method, params);
      });
      const expected = {
        threads: [
          {
            threadId: "thread",
            turnId: "failed-turn",
            title: "Title thread",
            status: "failed",
            owner: "codex",
          },
        ],
        runningThreadIds: [],
        unreadable: 0,
      };
      await expect(f.client.buddyInterrupted()).resolves.toEqual(expected);
      await expect(f.client.buddyInterrupted()).resolves.toEqual(expected);
      expect(
        f.send.mock.calls.filter(([method]) => method === BUDDY_INTERRUPTED_METHOD),
      ).toHaveLength(1);
      expect(f.send).toHaveBeenCalledWith("thread/turns/list", {
        threadId: "thread",
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      });
    },
  );

  it("preserves a supported Buddy response and recovery request", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ threads: [], runningThreadIds: [], unreadable: 2 })
      .mockResolvedValueOnce({});
    const client = recoveryClient(createRendererModelClient([{ sendRequest: send }]));
    await expect(client.buddyInterrupted()).resolves.toMatchObject({ unreadable: 2 });
    await client.buddyContinue("thread", "failed-turn", "selected-model");
    expect(send.mock.calls).toEqual([
      [BUDDY_INTERRUPTED_METHOD, {}],
      [
        BUDDY_CONTINUE_METHOD,
        { threadId: "thread", turnId: "failed-turn", model: "selected-model" },
      ],
    ]);
  });

  it.each([
    new Error("HTTP 503"),
    Object.assign(new Error("timeout"), { code: -32000 }),
    Object.assign(new Error("Invalid request: bad params"), { code: -32600 }),
  ])("does not fall back on an ordinary failure: %s", async (error) => {
    const send = vi.fn().mockRejectedValue(error);
    const client = recoveryClient(createRendererModelClient([{ sendRequest: send }]));
    await expect(client.buddyInterrupted()).rejects.toBe(error);
    await expect(client.buddyContinue("thread", "failed-turn")).rejects.toBe(error);
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      BUDDY_INTERRUPTED_METHOD,
      BUDDY_CONTINUE_METHOD,
    ]);
  });

  it("does not replace malformed Buddy results with a native scan", async () => {
    const f = fixture();
    f.send.mockResolvedValue({ threads: "invalid" });
    await expect(f.client.buddyInterrupted()).rejects.toThrow();
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("paginates, deduplicates and distinguishes active, completed, abandoned, external and unreadable histories", async () => {
    const f = fixture();
    const statuses: Record<string, string> = {
      failed: "failed",
      cancelled: "cancelled",
      interrupted: "interrupted",
      abandoned: "inProgress",
      completed: "completed",
      active: "failed",
      external: "failed",
      unreadable: "failed",
    };
    f.send.mockImplementation(async (method, params) => {
      const p = params as { cursor?: string; threadId: string };
      if (method === "thread/list")
        return p.cursor
          ? {
              data: Object.keys(statuses)
                .slice(2)
                .map((id) => ({ id })),
              nextCursor: null,
            }
          : { data: [{ id: "failed" }, { id: "cancelled" }, { id: "failed" }], nextCursor: "next" };
      if (method === "thread/read") {
        if (p.threadId === "unreadable") throw new Error("history unavailable");
        return {
          thread: {
            ...metadata(p.threadId, p.threadId === "active" ? "active" : "notLoaded"),
            ...(p.threadId === "external" ? { modelProvider: "codexhost" } : {}),
          },
        };
      }
      if (method === "thread/turns/list")
        return { data: [{ id: `turn-${p.threadId}`, status: statuses[p.threadId] }] };
      return f.original(method, params);
    });
    const result = await f.client.buddyInterrupted();
    expect(result.threads.map(({ threadId, status }) => [threadId, status])).toEqual([
      ["failed", "failed"],
      ["cancelled", "cancelled"],
      ["interrupted", "interrupted"],
      ["abandoned", "interrupted"],
    ]);
    expect(result.runningThreadIds).toEqual(["active"]);
    expect(result.unreadable).toBe(1);
    expect(f.send.mock.calls.filter(([method]) => method === "thread/list")).toHaveLength(2);
  });

  it("shares overlapping scans and caps history reads at four", async () => {
    const f = fixture();
    const gate = Promise.withResolvers<undefined>();
    let reads = 0;
    let maxReads = 0;
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/list")
        return { data: Array.from({ length: 10 }, (_, i) => ({ id: `thread-${i}` })) };
      if (method === "thread/read") {
        reads += 1;
        maxReads = Math.max(reads, maxReads);
        await gate.promise;
        reads -= 1;
        return { thread: metadata((params as { threadId: string }).threadId) };
      }
      return f.original(method, params);
    });
    const first = f.client.buddyInterrupted();
    const second = f.client.buddyInterrupted();
    await vi.waitFor(() => expect(reads).toBe(4));
    gate.resolve(undefined);
    expect(await first).toEqual(await second);
    expect(maxReads).toBe(4);
    expect(f.send.mock.calls.filter(([method]) => method === "thread/list")).toHaveLength(1);
  });

  it.each(["repeated", "limit", "malformed"])(
    "rejects a %s list instead of claiming a complete scan",
    async (mode) => {
      const f = fixture();
      let page = 0;
      f.send.mockImplementation(async (method, params) => {
        if (method === "thread/list") {
          page += 1;
          return mode === "malformed"
            ? {}
            : {
                data: [{ id: `thread-${page}` }],
                nextCursor: mode === "repeated" ? "same" : `page-${page}`,
              };
        }
        return f.original(method, params);
      });
      await expect(f.client.buddyInterrupted()).rejects.toThrow(/thread\/list/);
      expect(page).toBe(mode === "limit" ? 20 : mode === "repeated" ? 2 : 1);
    },
  );

  it("falls back to complete history only when turn pagination is unsupported", async () => {
    const f = fixture();
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/turns/list") throw missing(method);
      return f.original(method, params);
    });
    await f.client.buddyContinue("thread", "failed-turn");
    expect(
      f.send.mock.calls.filter(
        ([method, params]) =>
          method === "thread/read" && (params as { includeTurns: boolean }).includeTurns,
      ),
    ).toHaveLength(2);
    expect(f.send.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  });

  it.each([undefined, "fixed-model"])(
    "resumes before starting a continuation, preserving configuration (model: %s)",
    async (model) => {
      const f = fixture();
      await f.client.buddyContinue("thread", "failed-turn", model);
      expect(f.send.mock.calls.map(([method]) => method)).toEqual([
        BUDDY_CONTINUE_METHOD,
        "thread/read",
        "thread/turns/list",
        "thread/resume",
        "thread/read",
        "thread/turns/list",
        "turn/start",
      ]);
      expect(f.send).toHaveBeenCalledWith("thread/resume", { threadId: "thread" });
      expect(f.send).toHaveBeenCalledWith("turn/start", {
        threadId: "thread",
        input: [{ type: "text", text: nativeContinuationPrompt }],
        ...(model ? { model, effort: null } : {}),
      });
    },
  );

  it.each(["active", "completed", "changed", "unknown", "external", "wrong-thread"])(
    "rejects %s history before resuming",
    async (mode) => {
      const f = fixture();
      if (mode === "active" || mode === "unknown") f.state.thread.status.type = mode;
      if (mode === "completed") f.state.turn.status = "completed";
      if (mode === "changed") f.state.turn.id = "different-turn";
      if (mode === "external") f.state.thread.cliVersion = "codexhost";
      if (mode === "wrong-thread") f.state.thread.id = "different-thread";
      await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow();
      expect(
        f.send.mock.calls.some(([method]) => method === "thread/resume" || method === "turn/start"),
      ).toBe(false);
    },
  );

  it.each(["active", "completed", "changed"])("rejects a %s state after resume", async (mode) => {
    const f = fixture();
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/resume") {
        if (mode === "active") f.state.thread.status.type = "active";
        if (mode === "completed") f.state.turn.status = "completed";
        if (mode === "changed") f.state.turn.id = "new-turn";
      }
      return f.original(method, params);
    });
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow();
    expect(f.send.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  });

  it("rejects duplicate clicks and a stale list after accepted submission", async () => {
    const f = fixture();
    const gate = Promise.withResolvers<undefined>();
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/resume") await gate.promise;
      return f.original(method, params);
    });
    const first = f.client.buddyContinue("thread", "failed-turn");
    await vi.waitFor(() =>
      expect(f.send).toHaveBeenCalledWith("thread/resume", { threadId: "thread" }),
    );
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow("重复点击");
    gate.resolve(undefined);
    await first;
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow("勿重复发送");
    expect(f.send.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
    f.state.turn.id = "next-failed-turn";
    await f.client.buddyContinue("thread", "next-failed-turn");
    expect(f.send.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(2);
  });

  it.each(["timeout", "no-ack"])("does not retry an uncertain submission (%s)", async (mode) => {
    const f = fixture();
    f.send.mockImplementation(async (method, params) => {
      if (method === "turn/start") {
        if (mode === "timeout") throw new Error("turn/start timeout");
        return {};
      }
      return f.original(method, params);
    });
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow();
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow("勿重复发送");
    expect(f.send.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  });

  it("reports malformed native history as unreadable and refuses continuation", async () => {
    const f = fixture();
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/turns/list") return {};
      return f.original(method, params);
    });
    await expect(f.client.buddyInterrupted()).resolves.toEqual({
      threads: [],
      runningThreadIds: [],
      unreadable: 1,
    });
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow(
      "history is unavailable",
    );
    expect(
      f.send.mock.calls.some(([method]) => method === "thread/resume" || method === "turn/start"),
    ).toBe(false);
  });

  it.each([BUDDY_INTERRUPTED_METHOD, BUDDY_CONTINUE_METHOD])(
    "falls back independently when only %s is absent",
    async (absent) => {
      const f = fixture();
      f.send.mockImplementation(async (method, params) => {
        if (method === BUDDY_INTERRUPTED_METHOD && method !== absent)
          return { threads: [], runningThreadIds: [], unreadable: 0 };
        if (method === BUDDY_CONTINUE_METHOD && method !== absent) return {};
        return f.original(method, params);
      });
      await f.client.buddyInterrupted();
      await f.client.buddyContinue("thread", "failed-turn");
      expect(f.send.mock.calls.some(([method]) => method === "thread/list")).toBe(
        absent === BUDDY_INTERRUPTED_METHOD,
      );
      expect(f.send.mock.calls.some(([method]) => method === "turn/start")).toBe(
        absent === BUDDY_CONTINUE_METHOD,
      );
    },
  );

  it("stops on an unreadable latest turn without trying legacy history or submission", async () => {
    const f = fixture();
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/turns/list") throw new Error("history read timeout");
      return f.original(method, params);
    });
    await expect(f.client.buddyContinue("thread", "failed-turn")).rejects.toThrow(
      "history read timeout",
    );
    expect(f.send.mock.calls.filter(([method]) => method === "thread/read")).toHaveLength(1);
    expect(
      f.send.mock.calls.some(([method]) => method === "thread/resume" || method === "turn/start"),
    ).toBe(false);
  });

  it("stops after retiring an SSH connection without sending to the replacement or local Host", async () => {
    const f = fixture();
    const sendOther = vi.fn();
    const local = {
      hostId: "local",
      manager: { sendRequest: sendOther },
    } as unknown as RendererHostRoute;
    const remote = {
      hostId: "remote-ssh-discovered:server",
      manager: { sendRequest: f.send },
    } as unknown as RendererHostRoute;
    let current = remote;
    const clients = createRendererHostClients(() => ({
      forHost: (hostId: string) => (hostId === "local" ? local : current),
      hostIdForComposer: () => current.hostId,
      forComposer: () => current,
      dispose: vi.fn(),
    }));
    f.send.mockImplementation(async (method, params) => {
      if (method === "thread/resume")
        current = {
          ...remote,
          manager: { sendRequest: sendOther },
        } as unknown as RendererHostRoute;
      return f.original(method, params);
    });
    try {
      const client = recoveryClient(clients.forHost(remote.hostId));
      await expect(client.buddyContinue("thread", "failed-turn")).rejects.toThrow(
        "unavailable for Host",
      );
      expect(f.send.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
      expect(sendOther).not.toHaveBeenCalled();
    } finally {
      clients.dispose();
    }
  });
});
