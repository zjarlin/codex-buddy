export interface ModelRefreshSummary {
  returned?: number;
  synchronized: number;
  eligible?: number;
  added: number;
  removed: number;
}

export type ModelRefreshOutcome = ModelRefreshCounts | undefined;
export type ModelRefreshCounts = Partial<ModelRefreshSummary>;

export interface ModelRefreshReport {
  before: readonly { id: string }[];
  summary: ModelRefreshOutcome | undefined;
}

export function summarizeModelRefresh(
  before: readonly { id: string }[],
  after: readonly { id: string }[],
  counts: ModelRefreshCounts = {},
): ModelRefreshSummary {
  const beforeIds = new Set(before.map(({ id }) => id));
  const afterIds = new Set(after.map(({ id }) => id));
  return {
    ...(counts.returned === undefined ? {} : { returned: counts.returned }),
    synchronized: counts.synchronized ?? afterIds.size,
    ...(counts.eligible === undefined ? {} : { eligible: counts.eligible }),
    added: [...afterIds].filter((id) => !beforeIds.has(id)).length,
    removed: [...beforeIds].filter((id) => !afterIds.has(id)).length,
  };
}

export function modelRefreshMessage(summary: ModelRefreshSummary, chinese: boolean): string {
  const parts: string[] = [];
  if (summary.returned !== undefined) {
    parts.push(chinese ? `远程返回 ${summary.returned} 个` : `${summary.returned} returned`);
  }
  parts.push(chinese ? `同步 ${summary.synchronized} 个` : `${summary.synchronized} synced`);
  if (summary.eligible !== undefined) {
    parts.push(chinese ? `可路由 ${summary.eligible} 个` : `${summary.eligible} routable`);
  }
  const changes: string[] = [];
  if (summary.added > 0) changes.push(chinese ? `新增 ${summary.added} 个` : `+${summary.added}`);
  if (summary.removed > 0)
    changes.push(chinese ? `移除 ${summary.removed} 个` : `-${summary.removed}`);
  if (changes.length > 0) parts.push(changes.join(chinese ? "，" : ", "));
  return parts.join(chinese ? "，" : ", ");
}

export function modelRefreshFallbackMessage(chinese: boolean): string {
  return chinese ? "模型列表已刷新" : "Models refreshed";
}
