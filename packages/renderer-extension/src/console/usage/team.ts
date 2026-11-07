import type { TeamUsageMember } from "@codexhost/shared-contracts";

import { addTotals, emptyTotals, type Totals } from "./format.js";

export interface TeamDepartmentRow extends Totals {
  /** null is the members nobody assigned to a department yet. */
  department: string | null;
  members: number;
  /** Members whose figures are missing; their totals are not part of this row. */
  unreachable: number;
}

export interface TeamDepartmentProjectRow extends Totals {
  department: string | null;
  project: string | null;
}

export interface TeamProjectRow extends Totals {
  project: string | null;
}

/** Everyone who reported figures, local Host included; unreachable members contribute nothing. */
export function teamTotals(members: readonly TeamUsageMember[]): Totals {
  const totals = emptyTotals();
  for (const member of members) {
    if (member.usage) addTotals(totals, member.usage.totals);
  }
  return totals;
}

/**
 * Departments keep the name the coordinator assigned; members without one share the null row, so
 * unassigned usage is visible instead of silently disappearing from the department table.
 */
export function departmentRows(members: readonly TeamUsageMember[]): TeamDepartmentRow[] {
  const rows = new Map<string | null, TeamDepartmentRow>();
  for (const member of members) {
    let row = rows.get(member.department);
    if (!row) {
      row = {
        ...emptyTotals(),
        department: member.department,
        members: 0,
        unreachable: 0,
      };
      rows.set(member.department, row);
    }
    row.members += 1;
    if (member.usage) addTotals(row, member.usage.totals);
    else row.unreachable += 1;
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.costUsd - left.costUsd ||
      (left.department ?? "\uffff").localeCompare(right.department ?? "\uffff"),
  );
}

/** Department × project, the table a department lead reads to see where its spend goes. */
export function departmentProjectRows(
  members: readonly TeamUsageMember[],
): TeamDepartmentProjectRow[] {
  const rows = new Map<string, TeamDepartmentProjectRow>();
  for (const member of members) {
    if (!member.usage) continue;
    for (const project of member.usage.byProject) {
      const key = `${member.department ?? "\u0000"}\u0000${project.project ?? "\u0000"}`;
      let row = rows.get(key);
      if (!row) {
        row = { ...emptyTotals(), department: member.department, project: project.project };
        rows.set(key, row);
      }
      addTotals(row, project);
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      (left.department ?? "\uffff").localeCompare(right.department ?? "\uffff") ||
      right.costUsd - left.costUsd ||
      (left.project ?? "\uffff").localeCompare(right.project ?? "\uffff"),
  );
}

/** One row per project across the whole team, regardless of department. */
export function projectRows(members: readonly TeamUsageMember[]): TeamProjectRow[] {
  const rows = new Map<string | null, TeamProjectRow>();
  for (const member of members) {
    if (!member.usage) continue;
    for (const project of member.usage.byProject) {
      let row = rows.get(project.project);
      if (!row) {
        row = { ...emptyTotals(), project: project.project };
        rows.set(project.project, row);
      }
      addTotals(row, project);
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.costUsd - left.costUsd ||
      (left.project ?? "\uffff").localeCompare(right.project ?? "\uffff"),
  );
}

/**
 * Rows are departments, columns are projects, and each intersection is the cost of that pair:
 * the cross-tab a department lead reads. Projects keep their own order by total cost so the
 * widest columns come first; a pair with no usage stays empty rather than becoming a zero.
 */
export interface DepartmentProjectMatrix {
  /** Department names in row order; null is "unassigned". */
  departments: Array<string | null>;
  /** Project keys in column order; null is "unknown project". */
  projects: Array<string | null>;
  /** `cost[departmentIndex][projectIndex]`, undefined where nobody recorded usage. */
  cost: Array<Array<number | undefined>>;
  /** Row totals across every project, in the same order as `departments`. */
  total: number[];
  /** Column totals across every department, in the same order as `projects`. */
  columnTotal: number[];
}

export function departmentProjectMatrix(
  members: readonly TeamUsageMember[],
  projectLabel: (project: string | null) => string,
): DepartmentProjectMatrix {
  const pairs = new Map<
    string,
    { department: string | null; project: string | null; cost: number }
  >();
  const projectCost = new Map<string | null, number>();
  const departmentCost = new Map<string | null, number>();
  for (const member of members) {
    if (!member.usage) continue;
    for (const row of member.usage.byProject) {
      const key = `${member.department ?? "\u0000"}\u0000${row.project ?? "\u0000"}`;
      const pair = pairs.get(key);
      if (pair) pair.cost += row.costUsd;
      else
        pairs.set(key, {
          department: member.department,
          project: row.project,
          cost: row.costUsd,
        });
      projectCost.set(row.project, (projectCost.get(row.project) ?? 0) + row.costUsd);
      departmentCost.set(
        member.department,
        (departmentCost.get(member.department) ?? 0) + row.costUsd,
      );
    }
  }
  /** Cost first, then the label; an unnamed bucket sorts last instead of first. */
  const rank = (
    left: string | null,
    right: string | null,
    costs: Map<string | null, number>,
    name: (value: string | null) => string,
  ): number =>
    (costs.get(right) ?? 0) - (costs.get(left) ?? 0) ||
    (left === right
      ? 0
      : left === null
        ? 1
        : right === null
          ? -1
          : name(left).localeCompare(name(right)));
  const departments = [...departmentCost.keys()].sort((left, right) =>
    rank(left, right, departmentCost, (value) => value ?? ""),
  );
  const projects = [...projectCost.keys()].sort((left, right) =>
    rank(left, right, projectCost, projectLabel),
  );
  const index = new Map(departments.map((department, position) => [department, position]));
  const column = new Map(projects.map((project, position) => [project, position]));
  const cost = departments.map(() => projects.map((): number | undefined => undefined));
  for (const pair of pairs.values()) {
    const row = index.get(pair.department);
    const columnIndex = column.get(pair.project);
    const cells = row === undefined ? undefined : cost[row];
    if (!cells || columnIndex === undefined) continue;
    cells[columnIndex] = pair.cost;
  }
  return {
    departments,
    projects,
    cost,
    total: departments.map((department) => departmentCost.get(department) ?? 0),
    columnTotal: projects.map((project) => projectCost.get(project) ?? 0),
  };
}
