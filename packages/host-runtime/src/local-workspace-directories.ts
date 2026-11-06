import os from "node:os";
import path from "node:path";
import {
  GIT_REPOSITORY_DIRECTORY_LIMIT,
  type GitRepositoryDirectories,
} from "@codexhost/shared-contracts";
import type { GitWorkspace } from "./git-workspace.js";

/** 默认落点尚未克隆时，从最近存在的父目录开始选择；不创建目录。 */
export async function localWorkspaceDirectories(
  git: Pick<GitWorkspace, "realpath" | "listDirectories">,
  requested = os.homedir(),
): Promise<GitRepositoryDirectories> {
  if (!path.isAbsolute(requested)) throw new Error("请选择本机绝对路径。");
  let candidate = requested;
  let directory: string;
  for (;;) {
    try {
      directory = await git.realpath(candidate);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(candidate);
      if (code !== "ENOENT" || parent === candidate) throw error;
      candidate = parent;
    }
  }
  const names = [...(await git.listDirectories(directory))]
    .filter((name) => name !== ".git")
    .sort((a, b) => a.localeCompare(b));
  return {
    project: directory,
    path: directory,
    parent: path.dirname(directory) === directory ? null : path.dirname(directory),
    entries: names
      .slice(0, GIT_REPOSITORY_DIRECTORY_LIMIT)
      .map((name) => ({ name, path: path.join(directory, name) })),
    truncated: names.length > GIT_REPOSITORY_DIRECTORY_LIMIT,
  };
}
