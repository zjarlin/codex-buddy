import type { GitWorkspaceTarget, HostThreadId } from "@codexhost/shared-contracts";

export interface RendererGitTarget {
  threadId?: HostThreadId | null | undefined;
  cwd?: string | undefined;
  projectCwd?: string | undefined;
}

export function hasGitTarget(target: RendererGitTarget): boolean {
  return Boolean(target.threadId || target.cwd);
}

// 已核对聊天成员和 Host 的原生项目目录优先；其余会话仍由 Host 解析目录。
export function gitTargetParams(target: RendererGitTarget): GitWorkspaceTarget {
  if (target.projectCwd) return { cwd: target.projectCwd };
  return target.threadId ? { threadId: target.threadId } : { cwd: target.cwd };
}

export function gitTargetKey(target: RendererGitTarget): string {
  return JSON.stringify([target.threadId ?? null, gitTargetParams(target)]);
}
