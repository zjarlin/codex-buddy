import type { GitWorkspaceStatus } from "@codexhost/shared-contracts";

// 周期刷新会重新读取完整状态；内容未变时沿用上次对象，下游按引用比较即可跳过重建列表。
export function isGitWorkspaceStatus(value: unknown): value is GitWorkspaceStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { workspace?: unknown }).workspace === "string" &&
    Array.isArray((value as { changes?: unknown }).changes) &&
    Array.isArray((value as { submodules?: unknown }).submodules)
  );
}

export function gitStatusSignature(status: GitWorkspaceStatus): string {
  return JSON.stringify([
    status.workspace,
    status.branch,
    status.detached,
    status.head,
    status.upstream,
    status.ahead,
    status.behind,
    status.operation ?? null,
    status.messageRevision ?? null,
    status.warnings ?? [],
    status.conflicts,
    status.submodules.map((submodule) => [submodule.path, submodule.status]),
    status.changes.map((change) => [
      change.path,
      change.originalPath ?? null,
      change.indexStatus,
      change.workTreeStatus,
      change.staged,
      change.unstaged,
      change.untracked,
      change.conflicted,
      change.submodule?.status ?? null,
    ]),
  ]);
}

export function reuseGitStatus(
  previous: GitWorkspaceStatus | undefined,
  next: GitWorkspaceStatus,
): GitWorkspaceStatus {
  if (!previous) return next;
  return gitStatusSignature(previous) === gitStatusSignature(next) ? previous : next;
}
