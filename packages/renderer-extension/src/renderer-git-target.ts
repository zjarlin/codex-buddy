import type { GitWorkspaceTarget, HostThreadId } from "@codexhost/shared-contracts";

export interface RendererGitTarget {
  threadId?: HostThreadId | null | undefined;
  cwd?: string | undefined;
}

export function hasGitTarget(target: RendererGitTarget): boolean {
  return Boolean(target.threadId || target.cwd);
}

// 会话目录始终由 Host 决定，草稿目录只用于尚未创建会话的项目。
export function gitTargetParams(target: RendererGitTarget): GitWorkspaceTarget {
  return target.threadId ? { threadId: target.threadId } : { cwd: target.cwd };
}

export function gitTargetKey(target: RendererGitTarget): string {
  return JSON.stringify(gitTargetParams(target));
}
