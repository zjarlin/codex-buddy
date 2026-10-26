import path from "node:path";

import {
  gitRepositoryCloneParamsSchema,
  type GitRepositories,
  type GitRepositoryCloneParams,
} from "@codexhost/shared-contracts";

import { normalizeGitRemote, repositoryDirectoryName } from "./git-remote.js";
import type { GitRepositoryLinks } from "./git-repository-links.js";
import { GitWorkspaceError, type GitWorkspace } from "./git-workspace.js";

// 克隆位置由调用方选定父目录，缺省取会话项目的上一级：
// 这样项目的同级目录就是默认落点，不会把仓库克隆进项目内部或用户的临时目录。
export async function cloneGitRepository(
  input: GitRepositoryCloneParams,
  services: {
    git: GitWorkspace;
    links: GitRepositoryLinks;
    cwd: string;
    paths?: typeof path;
  },
): Promise<GitRepositories> {
  const params = gitRepositoryCloneParamsSchema.parse(input);
  const paths = services.paths ?? path;
  const remote = acceptedRemote(params.remote);
  const directory = acceptedDirectory(remote);
  const project = (await services.links.list(services.cwd)).project;
  const parent = params.parent?.trim() ? params.parent.trim() : paths.dirname(project);
  const target = paths.join(parent, directory);
  await services.git.clone(parent, remote, directory);
  try {
    return await services.links.link(services.cwd, target);
  } catch (error) {
    // 仓库已经落盘，只报告关联失败，不再删除用户刚克隆下来的内容。
    const detail = error instanceof Error ? error.message : String(error);
    throw new GitWorkspaceError(`已克隆到 ${target}，但关联失败：${detail}`, "", "", {
      cause: error,
    });
  }
}

function acceptedRemote(remote: string): string {
  try {
    return normalizeGitRemote(remote, true);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GitWorkspaceError(`Git 地址无效：${detail}`, "", "", { cause: error });
  }
}

function acceptedDirectory(remote: string): string {
  try {
    return repositoryDirectoryName(remote);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GitWorkspaceError(`无法从 Git 地址推断目录名：${detail}`, "", "", { cause: error });
  }
}
