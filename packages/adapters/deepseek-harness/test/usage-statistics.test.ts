import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  createDshUsageStatistics,
  readDshUsage,
  zstdFrames,
} from "../src/modern/usage-statistics.js";

let home: string;
const signal = new AbortController().signal;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "dsh-usage-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function message(id: string, time: number, output: number): string {
  return JSON.stringify({
    type: "assistant/message",
    seq: time,
    time,
    surfaceOp: "append",
    data: {
      message: {
        id,
        role: "assistant",
        source: { kind: "model", provider: "deepseek-official", model: "deepseek-v4-pro" },
      },
      usage: { inputTokens: 10, outputTokens: output, cacheReadTokens: 90, cacheWriteTokens: 0 },
      stream: [],
    },
  });
}

it("reads every complete zstd frame of the newest session file", async () => {
  const session = path.join(home, "sessions", "--work--", "s1");
  await mkdir(session, { recursive: true });
  const header = JSON.stringify({ type: "session", version: 4, id: "s1", cwd: "/work/dsh" });
  const frames = [
    zstdCompressSync(`${header}\n${message("m1", 1_000, 3)}\n`),
    zstdCompressSync(`${message("m2", 2_000, 4)}\n`),
  ];
  const partial = zstdCompressSync(`${message("m3", 3_000, 5)}\n`).subarray(0, 12);
  await writeFile(path.join(session, "session.v4.jsonl.zstd"), Buffer.concat([...frames, partial]));
  // Left behind by an older format; not read.
  await writeFile(path.join(session, "session.jsonl"), `${header}\n${message("old", 500, 9)}\n`);
  await writeFile(path.join(session, "session.migration.x.jsonl.zstd.tmp"), "x");

  expect(zstdFrames(Buffer.concat([...frames, partial]))).toHaveLength(2);
  const capability = createDshUsageStatistics({ DSH_HOME: home });
  const sources = await capability.listSources(signal);
  expect(sources.map((source) => path.basename(source.id))).toEqual(["session.v4.jsonl.zstd"]);
  expect(await capability.readSource(sources[0]?.id ?? "", signal)).toEqual([
    {
      id: "m1",
      occurredAtMs: 1_000,
      model: "deepseek-v4-pro",
      inputTokens: 100,
      cachedInputTokens: 90,
      cacheWriteInputTokens: 0,
      outputTokens: 3,
      sessionId: "s1",
      cwd: "/work/dsh",
    },
    // The header is in the first frame; later frames' requests belong to the same session.
    expect.objectContaining({ id: "m2", occurredAtMs: 2_000, outputTokens: 4, sessionId: "s1" }),
  ]);
});

async function sessionFile(id: string, cwd: string): Promise<string> {
  const directory = path.join(home, "sessions", "project", id);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "session.jsonl");
  const header = JSON.stringify({ type: "session", id, cwd });
  await writeFile(file, `${header}\n${message(id, 1_000, 3)}\n`);
  return file;
}

async function workspaces(rows: Array<{ path: string; sessionIds: string[] }>): Promise<void> {
  await mkdir(path.join(home, "storages"), { recursive: true });
  await writeFile(
    path.join(home, "storages", "workspace.json"),
    JSON.stringify({ tables: { workspaces: Object.fromEntries(rows.map((row, i) => [i, row])) } }),
  );
}

async function remoteWorkspace(name: string, host = "build-host", remotePath = "/work/repo") {
  const directory = path.join(home, "remote-workspaces", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, ".remote-ssh.json"),
    JSON.stringify({ host, port: 22, user: "dev", remotePath }),
  );
  return directory;
}

it("recovers deleted remote placeholders by native session membership without changing usage or cwd", async () => {
  const current = await remoteWorkspace("remote-new", "build-host", "/work/sub2api");
  await workspaces([{ path: current, sessionIds: ["old-session", "child-session"] }]);
  const oldCwd = path.join(home, "remote-workspaces", "wmv4zq69b9h1w");
  const files = [
    await sessionFile("old-session", oldCwd),
    await sessionFile("child-session", oldCwd),
    await sessionFile("current-session", current),
  ];
  const capability = createDshUsageStatistics({ DSH_HOME: home });
  await capability.listSources(signal);
  for (const file of files) {
    const original = await readDshUsage(file);
    const entries = await capability.readSource(file, signal);
    expect(entries).toEqual(
      original.map((entry) => ({
        ...entry,
        project: "ssh://dev@build-host:22/work/sub2api",
      })),
    );
  }
});

it("keeps remote machines separate and invalidates unchanged logs when workspace metadata changes", async () => {
  const a = await remoteWorkspace("remote-a", "host-a");
  const b = await remoteWorkspace("remote-b", "host-b");
  await workspaces([
    { path: a, sessionIds: ["s1"] },
    { path: b, sessionIds: ["s2"] },
  ]);
  const files = await Promise.all(
    ["s1", "s2"].map((id) => sessionFile(id, path.join(home, "remote-workspaces", `old-${id}`))),
  );
  const capability = createDshUsageStatistics({ DSH_HOME: home });
  const before = await capability.listSources(signal);
  expect((await capability.readSource(files[0] ?? "", signal))[0]?.project).toBe(
    "ssh://dev@host-a:22/work/repo",
  );
  expect((await capability.readSource(files[1] ?? "", signal))[0]?.project).toBe(
    "ssh://dev@host-b:22/work/repo",
  );
  expect(await capability.listSources(signal)).toEqual(before);
  await remoteWorkspace("remote-a", "host-a", "/work/项目 #1");
  const after = await capability.listSources(signal);
  expect(after[0]?.fingerprint).not.toBe(before[0]?.fingerprint);
  expect((await capability.readSource(files[0] ?? "", signal))[0]?.project).toBe(
    "ssh://dev@host-a:22/work/%E9%A1%B9%E7%9B%AE%20%231",
  );
  await workspaces([{ path: b, sessionIds: ["s1", "s2"] }]);
  expect((await capability.listSources(signal))[0]?.fingerprint).not.toBe(after[0]?.fingerprint);
  expect((await capability.readSource(files[0] ?? "", signal))[0]?.project).toBe(
    "ssh://dev@host-b:22/work/repo",
  );
});

it("keeps ambiguous or missing remote attribution unknown and preserves ordinary working directories", async () => {
  const a = await remoteWorkspace("remote-a");
  const b = await remoteWorkspace("remote-b");
  await workspaces([
    { path: a, sessionIds: ["ambiguous"] },
    { path: b, sessionIds: ["ambiguous"] },
  ]);
  const old = path.join(home, "remote-workspaces", "gone");
  const unknown = await sessionFile("missing", old);
  const ambiguous = await sessionFile("ambiguous", old);
  const ordinary = await sessionFile(
    "ordinary",
    path.join(home, "remote-workspaces-other", "wmv123"),
  );
  const defaultWorkspace = await sessionFile(
    "default",
    path.join(home, "Documents", "default-workspace"),
  );
  const capability = createDshUsageStatistics({ DSH_HOME: home });
  await capability.listSources(signal);
  for (const file of [unknown, ambiguous]) {
    expect((await capability.readSource(file, signal))[0]).toMatchObject({
      project: null,
      cwd: old,
      inputTokens: 100,
    });
  }
  for (const file of [ordinary, defaultWorkspace]) {
    expect((await capability.readSource(file, signal))[0]).not.toHaveProperty("project");
  }
  await writeFile(path.join(home, "storages", "workspace.json"), "{broken");
  await capability.listSources(signal);
  expect((await capability.readSource(unknown, signal))[0]?.project).toBeNull();
  await workspaces([{ path: `/${"x".repeat(4096)}`, sessionIds: ["missing"] }]);
  await capability.listSources(signal);
  expect((await capability.readSource(unknown, signal))[0]).toMatchObject({
    project: null,
    inputTokens: 100,
  });
});

it("does not invent a remote project from a title or a malformed SSH descriptor", async () => {
  const current = await remoteWorkspace("remote-current");
  await workspaces([{ path: current, sessionIds: ["s1"] }]);
  const file = await sessionFile("s1", current);
  const capability = createDshUsageStatistics({ DSH_HOME: home });
  for (const metadata of [
    "{broken",
    JSON.stringify({ host: "host", remotePath: "relative" }),
    JSON.stringify({ host: "host/path", remotePath: "/work/repo" }),
  ]) {
    await writeFile(path.join(current, ".remote-ssh.json"), metadata);
    await capability.listSources(signal);
    expect((await capability.readSource(file, signal))[0]?.project).toBeNull();
  }
  await rm(path.join(current, ".remote-ssh.json"));
  await capability.listSources(signal);
  expect((await capability.readSource(file, signal))[0]?.project).toBeNull();
});
