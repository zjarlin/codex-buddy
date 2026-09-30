import path from "node:path";

import {
  GIT_REPOSITORY_DIRECTORY_LIMIT,
  type GitRepositoryDirectories,
  type GitRepositoryDirectoriesParams,
  gitRepositoryDirectoriesParamsSchema,
} from "@codexhost/shared-contracts";

import { GitWorkspaceError, type GitWorkspace } from "./git-workspace.js";
import type { GitRepositoryLinks } from "./git-repository-links.js";

export async function listGitRepositoryDirectories(
  input: GitRepositoryDirectoriesParams,
  services: {
    git: GitWorkspace;
    links: GitRepositoryLinks;
    cwd: string;
    paths?: typeof path;
  },
): Promise<GitRepositoryDirectories> {
  const params = gitRepositoryDirectoriesParamsSchema.parse(input);
  const paths = services.paths ?? path;
  const project = (await services.links.list(services.cwd)).project;
  const candidate = params.path?.trim() || project;
  if (!paths.isAbsolute(candidate)) {
    throw new GitWorkspaceError("请输入目录的绝对路径。");
  }
  let target: string;
  try {
    target = await services.git.realpath(candidate);
  } catch (error) {
    throw new GitWorkspaceError(`目录不可访问：${candidate}`, "", "", { cause: error });
  }
  let names: readonly string[];
  try {
    names = await services.git.listDirectories(target);
  } catch (error) {
    throw new GitWorkspaceError(`无法读取目录：${candidate}`, "", "", { cause: error });
  }
  const sorted = [...names]
    .filter((name) => name !== ".git")
    .sort((left, right) => left.localeCompare(right));
  const entries = sorted.slice(0, GIT_REPOSITORY_DIRECTORY_LIMIT).map((name) => ({
    name,
    path: paths.join(target, name),
  }));
  const parent = target === paths.parse(target).root ? null : paths.dirname(target);
  return {
    project,
    path: target,
    parent,
    entries,
    truncated: sorted.length > GIT_REPOSITORY_DIRECTORY_LIMIT,
  };
}
