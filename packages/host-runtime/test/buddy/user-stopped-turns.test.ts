import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sharedUserStoppedTurns, UserStoppedTurns } from "../../src/buddy/user-stopped-turns.js";

const roots: string[] = [];
async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codexhost-user-stopped-"));
  roots.push(root);
  return root;
}
async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(async () => {
  // 每次写入都是异步落盘；等它写完再删目录，避免与临时文件竞争。
  await settle();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })),
  );
});

describe("user-stopped turns", () => {
  it("takes a requested stop as terminal before any terminal event arrives", async () => {
    const root = await directory();
    const turns = new UserStoppedTurns({ CODEXHOST_DATA_DIR: root });
    turns.requested("thread", "turn");
    expect(await turns.stopped("thread", "turn")).toBe(true);
    // 停止已是终态结论：终态早晚、是 interrupted 还是 failed 都不改变它。
    turns.completed("thread", "turn", "interrupted");
    expect(await turns.stopped("thread", "turn")).toBe(true);
    turns.completed("thread", "turn", "failed");
    expect(await turns.stopped("thread", "turn")).toBe(true);
    await settle();
    const saved = JSON.parse(
      await readFile(path.join(root, "buddy-user-stopped-turns.json"), "utf8"),
    );
    expect(saved.stoppedTurns).toEqual([{ threadId: "thread", turnId: "turn" }]);
    expect(saved.pendingTurns).toEqual([]);
  });

  // 停止请求与失败终态竞争时，用户按下的仍然是“别继续”，失败不能把它改回来。
  it("keeps the stop even when the turn ends failed right afterwards", async () => {
    const root = await directory();
    const turns = new UserStoppedTurns({ CODEXHOST_DATA_DIR: root });
    turns.requested("thread", "turn");
    turns.completed("thread", "turn", "failed");
    expect(await turns.stopped("thread", "turn")).toBe(true);
  });

  // 旧版本把停止请求写成“待定”；只有落在 interrupted 终态上才算用户停止。
  it("escalates a legacy pending stop only when the turn ended interrupted", async () => {
    const legacy = async () => {
      const root = await directory();
      await writeFile(
        path.join(root, "buddy-user-stopped-turns.json"),
        JSON.stringify({
          stoppedTurns: [],
          pendingTurns: [{ threadId: "thread", turnId: "turn" }],
        }),
      );
      return new UserStoppedTurns({ CODEXHOST_DATA_DIR: root });
    };

    const interrupted = await legacy();
    interrupted.completed("thread", "turn", "interrupted");
    expect(await interrupted.stopped("thread", "turn")).toBe(true);

    const failed = await legacy();
    failed.completed("thread", "turn", "failed");
    expect(await failed.stopped("thread", "turn")).toBe(false);
  });

  // 重启后旧回合的停止记录还在文件里，但同一会话已经开始新回合；旧回合的终态与它无关。
  it("drops a remembered stop for an older turn once a new turn starts during startup", async () => {
    const root = await directory();
    await writeFile(
      path.join(root, "buddy-user-stopped-turns.json"),
      JSON.stringify({
        stoppedTurns: [],
        pendingTurns: [{ threadId: "thread", turnId: "old" }],
      }),
    );
    const turns = new UserStoppedTurns({ CODEXHOST_DATA_DIR: root });
    turns.started("thread", "next");
    turns.completed("thread", "old", "interrupted");
    expect(await turns.stopped("thread", "old")).toBe(false);
    expect(await turns.stopped("thread", "next")).toBe(false);
  });

  it("remembers a stop whose terminal event never arrived before a restart", async () => {
    const root = await directory();
    new UserStoppedTurns({ CODEXHOST_DATA_DIR: root }).requested("thread", "turn");
    await settle();
    expect(await new UserStoppedTurns({ CODEXHOST_DATA_DIR: root }).stopped("thread", "turn")).toBe(
      true,
    );
  });

  it("keeps the new turn's own stop request when its started event arrives late", async () => {
    const root = await directory();
    const turns = new UserStoppedTurns({ CODEXHOST_DATA_DIR: root });
    turns.requested("thread", "old");
    turns.requested("thread", "next");
    turns.started("thread", "next");
    expect(await turns.stopped("thread", "next")).toBe(true);
    expect(await turns.stopped("thread", "old")).toBe(true);
  });

  // 桌面、控制台与手机控制会各自创建 Host，但共享同一个数据目录：
  // 用户在手机里停止的回合，桌面的中断扫描必须同样认出来。
  it("shares one record between Hosts that use the same data directory", async () => {
    const root = await directory();
    const environment = { CODEXHOST_DATA_DIR: root };
    sharedUserStoppedTurns(environment).requested("thread", "turn");
    expect(await sharedUserStoppedTurns(environment).stopped("thread", "turn")).toBe(true);
    expect(sharedUserStoppedTurns(environment)).toBe(sharedUserStoppedTurns(environment));
  });

  it("ignores missing and unreadable history files", async () => {
    const root = await directory();
    const turns = new UserStoppedTurns({ CODEXHOST_DATA_DIR: path.join(root, "absent") });
    expect(await turns.stopped("thread", "turn")).toBe(false);
  });

  it("bounds the remembered stops and drops the oldest first", async () => {
    const root = await directory();
    const turns = new UserStoppedTurns({ CODEXHOST_DATA_DIR: root }, 2);
    turns.requested("thread", "one");
    turns.requested("thread", "two");
    turns.requested("thread", "three");
    expect(await turns.stopped("thread", "one")).toBe(false);
    expect(await turns.stopped("thread", "three")).toBe(true);
  });
});
