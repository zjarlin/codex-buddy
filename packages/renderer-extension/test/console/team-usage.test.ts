import { describe, expect, it } from "vitest";

import type { TeamUsageMember, UsageStatisticsTotals } from "@codexhost/shared-contracts";

import {
  departmentProjectMatrix,
  departmentProjectRows,
  departmentRows,
  projectRows,
  teamTotals,
} from "../../src/console/usage/team.js";

function totals(costUsd: number, requests = 1): UsageStatisticsTotals {
  return {
    requests,
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

function member(
  name: string,
  department: string | null,
  projects: Array<[string | null, number]>,
  reachable = true,
): TeamUsageMember {
  const sum = projects.reduce((total, [, cost]) => total + cost, 0);
  return {
    id: "8f14e45f-ceea-467a-9f0e-1a2b3c4d5e6f",
    name,
    department,
    address: null,
    reachable,
    lastSeenAtMs: null,
    ...(reachable
      ? {
          usage: {
            totals: totals(sum),
            byHarness: [],
            byModel: [],
            byProject: projects.map(([project, cost]) => ({
              project,
              ...totals(cost),
            })),
          },
        }
      : {}),
  };
}

describe("team usage aggregation", () => {
  it("keeps unassigned members in their own department row instead of dropping them", () => {
    const rows = departmentRows([
      member("甲", "研发", [["/work/a", 2]]),
      member("乙", null, [["/work/b", 1]]),
      member("丙", "研发", [], false),
    ]);
    expect(rows.map((row) => [row.department, row.members, row.unreachable, row.costUsd])).toEqual([
      ["研发", 2, 1, 2],
      [null, 1, 0, 1],
    ]);
  });

  it("counts every reachable member once in the team total", () => {
    const members = [
      member("甲", "研发", [["/work/a", 2]]),
      member("乙", "销售", [["/work/b", 3]]),
      member("丙", "研发", [], false),
    ];
    expect(teamTotals(members).costUsd).toBe(5);
    expect(projectRows(members).map((row) => row.costUsd)).toEqual([3, 2]);
    expect(departmentProjectRows(members).map((row) => row.project)).toEqual([
      "/work/a",
      "/work/b",
    ]);
  });

  it("cross-tabulates department cost by project with totals on both axes", () => {
    const matrix = departmentProjectMatrix(
      [
        member("甲", "研发", [
          ["/work/a", 2],
          ["/work/b", 5],
        ]),
        member("乙", "销售", [["/work/a", 3]]),
        member("丙", null, [["/work/b", 1]]),
      ],
      (project) => project ?? "unknown",
    );
    expect(matrix.projects).toEqual(["/work/b", "/work/a"]);
    expect(matrix.departments).toEqual(["研发", "销售", null]);
    expect(matrix.cost).toEqual([
      [5, 2],
      [undefined, 3],
      [1, undefined],
    ]);
    expect(matrix.total).toEqual([7, 3, 1]);
    expect(matrix.columnTotal).toEqual([6, 5]);
  });
});
