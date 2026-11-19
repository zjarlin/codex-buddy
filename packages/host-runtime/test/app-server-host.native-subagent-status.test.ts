import { describe, expect, it } from "vitest";

import {
  createFixture,
  messageParams,
  method,
  readJsonLine,
  requestId,
  requiredMessageId,
  stopFixture,
  threadStatus,
  writeRequest,
} from "./app-server-host-fixture.js";

type Fixture = ReturnType<typeof createFixture>;

async function initialize(fixture: Fixture): Promise<void> {
  await fixture.ready;
  writeRequest(fixture.desktopInput, {
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "native-subagent-status-test", version: "1" },
      capabilities: { experimentalApi: true },
    },
  });
  const initializeRequest = await readJsonLine(fixture.official.stdin);
  writeRequest(fixture.official.stdout, {
    id: requiredMessageId(initializeRequest),
    result: { userAgent: "official" },
  });
  await fixture.collector.waitFor((message) => requestId(message, 1));
  expect(await readJsonLine(fixture.official.stdin)).toMatchObject({ method: "initialized" });
}

describe("native Subagent status projection", () => {
  it("keeps a parent active while the Subagents it spawned still run", async () => {
    const fixture = createFixture();
    try {
      await initialize(fixture);

      // Codex announces the child Thread it spawned under an already idle parent.
      writeRequest(fixture.official.stdout, {
        method: "thread/started",
        params: {
          thread: {
            id: "child-thread",
            parentThreadId: "parent-thread",
            threadSource: "subAgentThreadSpawn",
            status: { type: "idle" },
          },
        },
      });
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "child-thread", status: { type: "active", activeFlags: [] } },
      });

      // The Host republishes the parent so Desktop keeps its loading indicator.
      await expect(
        fixture.collector.waitFor((message) => threadStatus(message, "parent-thread", "active")),
      ).resolves.toBeTruthy();

      // The parent Turn finishing is not the end of its delegation: that idle would clear
      // the indicator, so it must not reach Desktop.
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "parent-thread", status: { type: "idle" } },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        fixture.collector.messages.some((message) =>
          threadStatus(message, "parent-thread", "idle"),
        ),
      ).toBe(false);

      // The last Subagent finishing does release the parent.
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "child-thread", status: { type: "idle" } },
      });
      await expect(
        fixture.collector.waitFor((message) => threadStatus(message, "parent-thread", "idle")),
      ).resolves.toBeTruthy();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("learns the parent from the thread_spawn source when no flat field is present", async () => {
    const fixture = createFixture();
    try {
      await initialize(fixture);
      writeRequest(fixture.official.stdout, {
        method: "thread/started",
        params: {
          thread: {
            id: "nested-child",
            source: {
              subAgent: { thread_spawn: { parent_thread_id: "nested-parent", depth: 1 } },
            },
            status: { type: "idle" },
          },
        },
      });
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "nested-child", status: { type: "active", activeFlags: [] } },
      });
      await expect(
        fixture.collector.waitFor((message) => threadStatus(message, "nested-parent", "active")),
      ).resolves.toBeTruthy();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("republishes an idle parent row as active in a thread/read result", async () => {
    const fixture = createFixture();
    try {
      await initialize(fixture);
      writeRequest(fixture.official.stdout, {
        method: "thread/started",
        params: {
          thread: {
            id: "read-child",
            parentThreadId: "read-parent",
            status: { type: "idle" },
          },
        },
      });
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "read-child", status: { type: "active", activeFlags: [] } },
      });
      await fixture.collector.waitFor((message) => threadStatus(message, "read-parent", "active"));

      writeRequest(fixture.desktopInput, {
        id: 20,
        method: "thread/read",
        params: { threadId: "read-parent", includeTurns: false },
      });
      const read = await readJsonLine(fixture.official.stdin);
      expect(read).toMatchObject({ id: 20, method: "thread/read" });
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(read),
        result: { thread: { id: "read-parent", status: { type: "idle" }, turns: [] } },
      });
      const reply = await fixture.collector.waitFor((message) => requestId(message, 20));
      const result = reply.result as { thread: { status: unknown } };
      expect(result.thread.status).toEqual({ type: "active", activeFlags: [] });
    } finally {
      await stopFixture(fixture);
    }
  });

  it("forwards a faulted parent untouched while its Subagent runs", async () => {
    const fixture = createFixture();
    try {
      await initialize(fixture);
      writeRequest(fixture.official.stdout, {
        method: "thread/started",
        params: {
          thread: { id: "fault-child", parentThreadId: "fault-parent", status: { type: "idle" } },
        },
      });
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "fault-child", status: { type: "active", activeFlags: [] } },
      });
      await fixture.collector.waitFor((message) => threadStatus(message, "fault-parent", "active"));
      // A fault is not a claim that the work finished; Desktop has to see it.
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "fault-parent", status: { type: "systemError" } },
      });
      await expect(
        fixture.collector.waitFor(
          (message) =>
            method(message, "thread/status/changed") &&
            messageParams(message).threadId === "fault-parent" &&
            (messageParams(message).status as { type?: string } | undefined)?.type ===
              "systemError",
        ),
      ).resolves.toBeTruthy();
    } finally {
      await stopFixture(fixture);
    }
  });

  it("passes a parent idle through once no Subagent is running", async () => {
    const fixture = createFixture();
    try {
      await initialize(fixture);
      writeRequest(fixture.official.stdout, {
        method: "thread/status/changed",
        params: { threadId: "plain-thread", status: { type: "idle" } },
      });
      await expect(
        fixture.collector.waitFor((message) => threadStatus(message, "plain-thread", "idle")),
      ).resolves.toBeTruthy();
      expect(
        fixture.collector.messages.some(
          (message) =>
            method(message, "thread/status/changed") &&
            messageParams(message).threadId === "plain-thread" &&
            (messageParams(message).status as { type?: string } | undefined)?.type === "active",
        ),
      ).toBe(false);
    } finally {
      await stopFixture(fixture);
    }
  });
});
