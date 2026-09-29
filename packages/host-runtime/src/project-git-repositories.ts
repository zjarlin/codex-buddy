import path from "node:path";
import type { GitWorkspaceStatus } from "@codexhost/shared-contracts";
import type { GitRepositoryLinks } from "./git-repository-links.js";
import type { GitWorkspace } from "./git-workspace.js";

export interface ProjectGitRepository {
  kind: "primary" | "linked" | "submodule";
  status: GitWorkspaceStatus;
  gitlinkChanged?: boolean;
}

// 沿用已关联仓库和声明的子模块边界，不递归扫描任意目录或自动初始化子模块。
export async function readProjectGitRepositories(
  workspace: string,
  links: GitRepositoryLinks,
  git: GitWorkspace,
): Promise<ProjectGitRepository[]> {
  const known = await links.list(workspace);
  const repositories = new Map<string, ProjectGitRepository>();
  const read = async (
    cwd: string,
    kind: ProjectGitRepository["kind"],
    owner: string,
    gitlinkChanged = false,
  ): Promise<void> => {
    try {
      await links.resolve(owner, cwd);
      const existing = repositories.get(cwd);
      if (existing) {
        existing.gitlinkChanged ||= gitlinkChanged;
        return;
      }
      const status = await git.status(cwd);
      repositories.set(cwd, { kind, status, gitlinkChanged });
      for (const submodule of status.submodules) {
        if (submodule.status === "uninitialized") {
          continue;
        }
        const changed =
          submodule.status === "modified" ||
          status.changes.some((change) => change.path === submodule.path);
        await read(path.resolve(cwd, submodule.path), "submodule", cwd, changed);
      }
    } catch (error) {
      throw new Error(`${cwd}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  };
  for (const repository of known.repositories) {
    await read(repository.path, repository.primary ? "primary" : "linked", workspace);
  }
  return [...repositories.values()];
}

export function gitRepositorySynchronized(
  repository: ProjectGitRepository,
  initial: ProjectGitRepository = repository,
): boolean {
  const status = repository.status;
  if (status.changes.length || status.operation || status.ahead || status.behind) {
    return false;
  }
  if (status.upstream !== null && !status.detached) {
    return true;
  }
  // 已初始化子模块通常停在父仓库指定的 detached HEAD；只有干净且引用未变时无需推送。
  return (
    repository.kind === "submodule" &&
    initial.kind === "submodule" &&
    !repository.gitlinkChanged &&
    !initial.gitlinkChanged &&
    status.detached &&
    initial.status.detached &&
    initial.status.changes.length === 0 &&
    status.head !== null &&
    status.head === initial.status.head
  );
}
