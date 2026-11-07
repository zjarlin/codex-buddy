import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { UsageStatistics } from "../src/usage-statistics.js";
import { TeamUsage } from "../src/team-usage.js";

const directories: string[] = [];
const instances: TeamUsage[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function totals(costUsd: number) {
  return {
    requests: 2,
    inputTokens: 1_000,
    cachedInputTokens: 800,
    cacheWriteInputTokens: 0,
    cacheKnownInputTokens: 800,
    cacheHitCachedInputTokens: 700,
    cacheHitInputTokens: 800,
    outputTokens: 100,
    reasoningOutputTokens: 0,
    costUsd,
    unpricedRequests: 0,
    unmeteredRequests: 0,
  };
}

/** Only the projection TeamUsage reads; a real Host computes it from its own sessions. */
function statistics(costUsd: number): UsageStatistics {
  return {
    get: async () => ({
      range: "30d",
      from: "2026-10-09",
      to: "2026-11-07",
      totals: totals(costUsd),
      byHarness: [{ harness: "codex", ...totals(costUsd) }],
      byModel: [{ model: "gpt-6-astra", ...totals(costUsd) }],
      byProject: [{ project: "/work/a", ...totals(costUsd) }],
    }),
  } as unknown as UsageStatistics;
}

async function member(costUsd: number): Promise<{ team: TeamUsage; directory: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "team-usage-"));
  directories.push(directory);
  const team = new TeamUsage({
    environment: { CODEXHOST_DATA_DIR: directory },
    usage: () => statistics(costUsd),
  });
  instances.push(team);
  return { team, directory };
}

describe("team usage pairing", () => {
  it("reads an approved member projection once and keeps its department", async () => {
    const reader = await member(2);
    const source = await member(5);
    await source.team.setSettings({
      enabled: true,
      port: await freePort(),
      name: "甲",
      department: "研发",
    });
    await reader.team.setSettings({ name: "乙", department: "销售" });

    const invite = await source.team.invite();
    const code = invite.invite?.code ?? "";
    const address = `127.0.0.1:${invite.port ?? 0}`;
    const pairing = await reader.team.pair(address, code);
    expect(pairing.status).toBe("pending");

    const waiting = await source.team.state();
    expect(waiting.pending.map((entry) => entry.name)).toEqual(["乙"]);
    await source.team.accept(pairing.requestId);

    const snapshot = await reader.team.snapshot({ range: "30d" });
    expect(snapshot.members.map((entry) => entry.name)).toEqual(["乙", "甲"]);
    expect(snapshot.members[1]).toMatchObject({
      department: "研发",
      reachable: true,
      usage: { totals: { costUsd: 5 } },
    });

    const peer = (await reader.team.state()).peers.find((entry) => entry.direction === "out");
    expect(peer?.name).toBe("甲");
    await reader.team.memberSet(peer?.id ?? "", { department: "平台" });
    const reassigned = await reader.team.snapshot({ range: "30d" });
    expect(reassigned.members[1]?.department).toBe("平台");
  }, 30_000);

  it("keeps the two directions apart: a coordinator never reads its readers", async () => {
    const reader = await member(1);
    const source = await member(3);
    await source.team.setSettings({ enabled: true, port: await freePort(), name: "甲" });
    const invite = await source.team.invite();
    const pairing = await reader.team.pair(
      `127.0.0.1:${invite.port ?? 0}`,
      invite.invite?.code ?? "",
    );
    await source.team.accept(pairing.requestId);
    await reader.team.snapshot({ range: "30d" });

    expect((await reader.team.state()).peers.map((peer) => peer.direction)).toEqual(["out"]);
    const readerSide = (await source.team.state()).peers;
    expect(readerSide.map((peer) => peer.direction)).toEqual(["in"]);
    // The pairing request only carries an ephemeral source socket, never a usage endpoint.
    expect(readerSide[0]?.address).toBeNull();
    expect((await source.team.snapshot({ range: "30d" })).members).toHaveLength(1);
  }, 30_000);

  it("drops only the requested direction, so removing a row keeps the other relationship", async () => {
    const reader = await member(1);
    const source = await member(1);
    await source.team.setSettings({ enabled: true, port: await freePort(), name: "甲" });
    const invite = await source.team.invite();
    const pairing = await reader.team.pair(
      `127.0.0.1:${invite.port ?? 0}`,
      invite.invite?.code ?? "",
    );
    await source.team.accept(pairing.requestId);
    const peer = (await source.team.state()).peers[0];
    expect(peer?.direction).toBe("in");

    await source.team.memberRemove(peer?.id ?? "", "out");
    expect((await source.team.state()).peers).toHaveLength(1);
    await source.team.memberRemove(peer?.id ?? "", "in");
    expect((await source.team.state()).peers).toHaveLength(0);
  }, 30_000);
});
