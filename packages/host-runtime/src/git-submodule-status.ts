type GitRead = (
  cwd: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

function missingMapping(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return (
    /no submodule mapping found in \.gitmodules for path '(.+)'/u.exec(error.message)?.[1] ?? null
  );
}

// 孤立 gitlink 只影响子模块详情；正常 Git 操作及其他已声明子模块仍可返回结果。
export async function readGitSubmoduleStatus(cwd: string, git: GitRead) {
  try {
    const result = await git(cwd, ["submodule", "status", "--recursive"]);
    return { stdout: result.stdout, warnings: [] as string[] };
  } catch (error) {
    if (!missingMapping(error)) throw error;
  }

  const index = await git(cwd, ["ls-files", "--stage", "-z"]);
  const paths = new Set(
    index.stdout.split("\0").flatMap((entry) => {
      const match = /^160000 [0-9a-f]+ [0-3]\t(.+)$/su.exec(entry);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  const output: string[] = [];
  const warnings: string[] = [];
  for (const path of paths) {
    try {
      const result = await git(cwd, ["submodule", "status", "--recursive", "--", path]);
      output.push(result.stdout);
    } catch (error) {
      const missing = missingMapping(error);
      if (!missing) throw error;
      warnings.push(`子模块 ${missing} 缺少 .gitmodules 映射，暂不显示其子模块详情。`);
    }
  }
  return { stdout: output.join("\n"), warnings };
}
