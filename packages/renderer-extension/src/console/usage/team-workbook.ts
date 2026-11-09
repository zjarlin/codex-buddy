import type { TeamUsageMember, TeamUsageSnapshot } from "@codexhost/shared-contracts";

import { inputWithoutCache } from "./format.js";
import {
  departmentProjectMatrix,
  departmentProjectRows,
  departmentRows,
  projectRows,
  teamTotals,
} from "./team.js";
import { METRIC_HEADER, metricCells } from "./workbook-metrics.js";
import { Workbook, integer, money, type Cell, type Row } from "./xlsx.js";

/** Labels the workbook needs; the page supplies its own localized strings. */
export interface TeamWorkbookLabels {
  ranges: Record<TeamUsageSnapshot["range"], string>;
  costBasis: string;
  unassigned: string;
}

const memberName = (member: TeamUsageMember): string =>
  member.address === null ? member.name : `${member.name} (${member.address})`;

/**
 * The team workbook: one sheet per question, plus a department × project cost cross-tab so a
 * department lead reads its spend per project without filtering. Numbers stay numeric cells.
 */
export function teamUsageWorkbook(
  snapshot: TeamUsageSnapshot,
  labels: TeamWorkbookLabels,
  projectName: (key: string | null) => string,
): Workbook {
  const totals = teamTotals(snapshot.members);
  const departments = departmentRows(snapshot.members);
  const departmentProjects = departmentProjectRows(snapshot.members);
  const projects = projectRows(snapshot.members);
  const book = new Workbook();
  book.sheet("Summary", [
    ["field", "value"],
    ["range", labels.ranges[snapshot.range]],
    ["from", snapshot.from],
    ["to", snapshot.to],
    ["time_zone", snapshot.timeZone],
    ["cost_basis", labels.costBasis],
    ["members", integer(snapshot.members.length)],
    [
      "reachable_members",
      integer(snapshot.members.filter((member) => member.usage !== undefined).length),
    ],
    [],
    ["metric", "value"],
    ...(
      [
        ["requests", totals.requests],
        ["input_tokens", totals.inputTokens],
        ["input_without_cache", inputWithoutCache(totals)],
        ["cache_read", totals.cachedInputTokens],
        ["cache_write", totals.cacheWriteInputTokens],
        ["output_tokens", totals.outputTokens],
        ["reasoning_tokens", totals.reasoningOutputTokens],
        ["unpriced_requests", totals.unpricedRequests],
        ["unmetered_requests", totals.unmeteredRequests],
      ] as const
    ).map(([name, value]) => [name, integer(value)] as Row),
    ["cost_usd", money(totals.costUsd)],
  ]);
  book.sheet("Members", [
    ["member", "department", "address", "reachable", ...METRIC_HEADER],
    ...snapshot.members.map((member) => [
      member.name,
      member.department ?? "",
      member.address ?? "local",
      member.usage === undefined ? "no" : "yes",
      ...(member.usage === undefined
        ? METRIC_HEADER.map((): Cell => null)
        : metricCells(member.usage.totals)),
    ]),
  ]);
  book.sheet("By Department", [
    ["department", "members", "unreachable_members", ...METRIC_HEADER],
    ...departments.map((row) => [
      row.department ?? "",
      integer(row.members),
      integer(row.unreachable),
      ...metricCells(row),
    ]),
  ]);
  book.sheet("Department x Project", [
    ["department", "project", "project_path", ...METRIC_HEADER],
    ...departmentProjects.map((row) => [
      row.department ?? "",
      projectName(row.project),
      row.project ?? "",
      ...metricCells(row),
    ]),
  ]);
  const matrix = departmentProjectMatrix(snapshot.members, projectName);
  book.sheet("Dept x Project cost", [
    ["department", ...matrix.projects.map((project) => projectName(project)), "total_cost_usd"],
    ...matrix.departments.map((department, row) => [
      department ?? labels.unassigned,
      ...(matrix.cost[row] ?? []).map((value) => (value === undefined ? null : money(value))),
      money(matrix.total[row] ?? 0),
    ]),
    ["total", ...matrix.columnTotal.map((value) => money(value)), money(totals.costUsd)],
  ]);
  book.sheet("By Project", [
    ["project", "project_path", ...METRIC_HEADER],
    ...projects.map((row) => [projectName(row.project), row.project ?? "", ...metricCells(row)]),
  ]);
  book.sheet("Member x Project", [
    ["member", "department", "project", "project_path", ...METRIC_HEADER],
    ...snapshot.members.flatMap((member) =>
      (member.usage?.byProject ?? []).map((row) => [
        memberName(member),
        member.department ?? "",
        projectName(row.project),
        row.project ?? "",
        ...metricCells(row),
      ]),
    ),
  ]);
  return book;
}
