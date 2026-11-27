import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";

import {
  createFixture,
  readJsonLine,
  stopFixture,
  writeRequest,
} from "./app-server-host-fixture.js";

const THREAD_ID = "official-thread";
const TURN_ID = "official-turn";

function rpc(
  fixture: ReturnType<typeof createFixture>,
  id: number,
  method: string,
  params: JsonObject,
) {
  writeRequest(fixture.desktopInput, { id, method, params });
  return fixture.collector.waitFor((message) => message.id === id);
}

/**
 * Host 可能先发 `thread/name/set` 这类自带应答的原生请求；顺序读官方 stdin，
 * 就地应答它们，直到看到期望的方法。
 */
async function expectOfficialRequest(
  fixture: ReturnType<typeof createFixture>,
  target: string,
): Promise<JsonObject> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request = await readJsonLine(fixture.official.stdin);
    if (request.method === target) return request;
    if (request.method === "thread/name/set") {
      fixture.official.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
      continue;
    }
    throw new Error(`Unexpected native request: ${String(request.method)}`);
  }
  throw new Error(`Did not receive ${target}`);
}

async function startNativeTurn(fixture: ReturnType<typeof createFixture>): Promise<void> {
  const started = rpc(fixture, 10, "turn/start", {
    threadId: THREAD_ID,
    input: [{ type: "text", text: "synthetic" }],
  });
  const start = await expectOfficialRequest(fixture, "turn/start");
  fixture.official.stdout.write(
    `${JSON.stringify({ id: start.id, result: { turn: { id: TURN_ID } } })}\n`,
  );
  await started;
  fixture.official.stdout.write(
    `${JSON.stringify({
      method: "turn/started",
      params: { threadId: THREAD_ID, turn: { id: TURN_ID, status: "inProgress" } },
    })}\n`,
  );
}

function completeTurn(fixture: ReturnType<typeof createFixture>, status: string): void {
  fixture.official.stdout.write(
    `${JSON.stringify({
      method: "turn/completed",
      params: { threadId: THREAD_ID, turn: { id: TURN_ID, status } },
    })}\n`,
  );
}

async function scanInterrupted(
  fixture: ReturnType<typeof createFixture>,
  turnStatus = "interrupted",
) {
  const scan = rpc(fixture, 20, "codexhost/buddy/interrupted", { threadId: THREAD_ID });
  const metadata = await expectOfficialRequest(fixture, "thread/read");
  expect(metadata).toMatchObject({
    method: "thread/read",
    params: { threadId: THREAD_ID, includeTurns: false },
  });
  fixture.official.stdout.write(
    `${JSON.stringify({
      id: metadata.id,
      result: {
        thread: {
          id: THREAD_ID,
          status: { type: "idle" },
          modelProvider: "openai",
          cliVersion: "1",
        },
      },
    })}\n`,
  );
  const history = await expectOfficialRequest(fixture, "thread/turns/list");
  expect(history).toMatchObject({ method: "thread/turns/list" });
  fixture.official.stdout.write(
    `${JSON.stringify({
      id: history.id,
      result: { data: [{ id: TURN_ID, status: turnStatus }] },
    })}\n`,
  );
  return (await scan).result as {
    threads: { threadId: string; turnId: string; status: string }[];
    runningThreadIds: string[];
    stoppedTurns: { threadId: string; turnId: string }[];
  };
}

function fixture() {
  return createFixture({
    mappingStoreDirectory: mkdtempSync(path.join(tmpdir(), "codexhost-user-stopped-host-")),
  });
}

describe("Host-side manual stop", () => {
  it("reports a turn the user stopped as terminal instead of recoverable", async () => {
    const f = fixture();
    try {
      await f.ready;
      await startNativeTurn(f);
      const interrupt = rpc(f, 11, "turn/interrupt", { threadId: THREAD_ID, turnId: TURN_ID });
      const forwarded = await expectOfficialRequest(f, "turn/interrupt");
      f.official.stdout.write(`${JSON.stringify({ id: forwarded.id, result: {} })}\n`);
      await interrupt;
      completeTurn(f, "interrupted");
      await new Promise((resolve) => setTimeout(resolve, 20));

      await expect(scanInterrupted(f)).resolves.toMatchObject({
        threads: [],
        runningThreadIds: [],
        stoppedTurns: [{ threadId: THREAD_ID, turnId: TURN_ID }],
      });
    } finally {
      await stopFixture(f);
      rmSync(f.mappingStoreDirectory, { recursive: true, force: true });
    }
  });

  // 续接入口本身也要拦住：即使客户端拿着一份过期队列直接提交，也不能跑起来。
  it("refuses a continuation request for the turn the user stopped", async () => {
    const f = fixture();
    try {
      await f.ready;
      await startNativeTurn(f);
      const interrupt = rpc(f, 11, "turn/interrupt", { threadId: THREAD_ID, turnId: TURN_ID });
      const forwarded = await expectOfficialRequest(f, "turn/interrupt");
      f.official.stdout.write(`${JSON.stringify({ id: forwarded.id, result: {} })}\n`);
      await interrupt;
      completeTurn(f, "interrupted");
      await new Promise((resolve) => setTimeout(resolve, 20));

      const continued = rpc(f, 21, "codexhost/buddy/continue", {
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      const metadata = await expectOfficialRequest(f, "thread/read");
      f.official.stdout.write(
        `${JSON.stringify({
          id: metadata.id,
          result: { thread: { id: THREAD_ID, status: { type: "idle" } } },
        })}\n`,
      );
      const history = await expectOfficialRequest(f, "thread/turns/list");
      f.official.stdout.write(
        `${JSON.stringify({
          id: history.id,
          result: { data: [{ id: TURN_ID, status: "interrupted" }] },
        })}\n`,
      );
      await expect(continued).resolves.toMatchObject({
        error: { message: expect.stringContaining("手动停止") },
      });
    } finally {
      await stopFixture(f);
      rmSync(f.mappingStoreDirectory, { recursive: true, force: true });
    }
  });

  it("keeps an interrupted turn recoverable when nobody asked to stop it", async () => {
    const f = fixture();
    try {
      await f.ready;
      await startNativeTurn(f);
      completeTurn(f, "interrupted");
      await new Promise((resolve) => setTimeout(resolve, 20));

      await expect(scanInterrupted(f)).resolves.toMatchObject({
        threads: [{ threadId: THREAD_ID, turnId: TURN_ID, status: "interrupted" }],
        stoppedTurns: [],
      });
    } finally {
      await stopFixture(f);
      rmSync(f.mappingStoreDirectory, { recursive: true, force: true });
    }
  });

  // 用户点停止时回合可能已经结束；官方仍会接受请求，但那不是对当前回合的决定。
  it("ignores a stop request that names a turn the Host no longer runs", async () => {
    const f = fixture();
    try {
      await f.ready;
      await startNativeTurn(f);
      const interrupt = rpc(f, 11, "turn/interrupt", {
        threadId: THREAD_ID,
        turnId: "already-finished-turn",
      });
      const forwarded = await expectOfficialRequest(f, "turn/interrupt");
      f.official.stdout.write(`${JSON.stringify({ id: forwarded.id, result: {} })}\n`);
      await interrupt;
      completeTurn(f, "interrupted");
      await new Promise((resolve) => setTimeout(resolve, 20));

      await expect(scanInterrupted(f)).resolves.toMatchObject({
        threads: [{ threadId: THREAD_ID, turnId: TURN_ID, status: "interrupted" }],
        stoppedTurns: [],
      });
    } finally {
      await stopFixture(f);
      rmSync(f.mappingStoreDirectory, { recursive: true, force: true });
    }
  });

  // 用户按下停止后再出现的失败也是“别再继续”的一部分：续跑刚被停下的回合是最坏结果。
  it("keeps a stopped turn terminal even when it ends failed", async () => {
    const f = fixture();
    try {
      await f.ready;
      await startNativeTurn(f);
      const interrupt = rpc(f, 11, "turn/interrupt", { threadId: THREAD_ID, turnId: TURN_ID });
      const forwarded = await expectOfficialRequest(f, "turn/interrupt");
      f.official.stdout.write(`${JSON.stringify({ id: forwarded.id, result: {} })}\n`);
      await interrupt;
      completeTurn(f, "failed");
      await new Promise((resolve) => setTimeout(resolve, 20));

      await expect(scanInterrupted(f, "failed")).resolves.toMatchObject({
        threads: [],
        stoppedTurns: [{ threadId: THREAD_ID, turnId: TURN_ID }],
      });
    } finally {
      await stopFixture(f);
      rmSync(f.mappingStoreDirectory, { recursive: true, force: true });
    }
  });

  // 停止请求在终态到达之前就已生效：用户按下停止后 Host 崩溃，重启也不能把它当成可恢复中断。
  // 手机、控制台与桌面会各自创建 Host，但共用同一个 CODEXHOST_DATA_DIR。
  it("remembers the stop across a Host restart before the terminal event arrives", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-user-stopped-host-"));
    try {
      const first = createFixture({ mappingStoreDirectory: directory });
      await first.ready;
      await startNativeTurn(first);
      const interrupt = rpc(first, 11, "turn/interrupt", { threadId: THREAD_ID, turnId: TURN_ID });
      const forwarded = await expectOfficialRequest(first, "turn/interrupt");
      // app-server 接受停止后没来得及发终态就失去响应。
      first.official.stdout.write(`${JSON.stringify({ id: forwarded.id, result: {} })}\n`);
      await interrupt;
      await stopFixture(first);

      const restarted = createFixture({ mappingStoreDirectory: directory });
      try {
        await restarted.ready;
        await expect(scanInterrupted(restarted)).resolves.toMatchObject({
          threads: [],
          stoppedTurns: [{ threadId: THREAD_ID, turnId: TURN_ID }],
        });
      } finally {
        await stopFixture(restarted);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
