import { isMissingGitDirectory, type GitWorkspace } from "./git-workspace.js";

// 与 VS Code 的 git.repositoryScanMaxDepth 默认值保持一致：只扫描会话项目目录的一级子目录。
// 超过上限的项目目录只跳过剩余探测，不递归、不初始化，也不写入任何关联记录。
const CHILD_REPOSITORY_SCAN_LIMIT = 200;

// 列出项目目录一级子目录中本身即 Git 仓库根目录的仓库。子目录不是仓库根时跳过（正常情况），
// 只有目录消失或 Git 自身失败才抛出，避免把“不是仓库”当成错误。
export async function discoverChildRepositories(
  git: Pick<GitWorkspace, "listDirectories" | "paths" | "root">,
  project: string,
): Promise<readonly string[]> {
  const names = await git.listDirectories(project);
  const candidates = [...names]
    .filter((name) => name !== ".git")
    .sort((left, right) => left.localeCompare(right))
    .slice(0, CHILD_REPOSITORY_SCAN_LIMIT);
  const roots = await Promise.all(
    candidates.map(async (name) => {
      const candidate = git.paths.join(project, name);
      try {
        return (await git.root(candidate)) === candidate ? candidate : null;
      } catch (error) {
        if (isMissingGitDirectory(error)) return null;
        throw error;
      }
    }),
  );
  return roots.filter((root): root is string => root !== null);
}
