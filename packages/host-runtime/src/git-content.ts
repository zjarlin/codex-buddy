import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  GIT_CONTENT_MAX_BYTES,
  type GitChange,
  type GitContentResult,
} from "@codexhost/shared-contracts";

// Gitlink 记录的是子仓库提交引用，不能把对应的工作区目录当作文本读取。
export async function readGitContent(
  filePath: string,
  absolutePath: string,
  change: GitChange | undefined,
  git: (arguments_: readonly string[]) => Promise<{ stdout: string }>,
): Promise<GitContentResult> {
  const index = await git(["ls-files", "--stage", "-z", "--", filePath]);
  const entries = index.stdout
    .split("\0")
    .filter((entry) => entry.slice(entry.indexOf("\t") + 1) === filePath);
  const conflicted =
    Boolean(change?.conflicted) || entries.some((entry) => !entry.split("\t")[0]?.endsWith(" 0"));
  let submodule =
    Boolean(change?.submodule) || entries.some((entry) => entry.startsWith("160000 "));
  // 已暂存删除的子模块不再出现在索引中，仍需从 HEAD 识别其类型。
  if (!entries.length && !change?.untracked) {
    const head = await git(["ls-tree", "-z", "HEAD", "--", filePath]).catch(() => ({ stdout: "" }));
    submodule = head.stdout
      .split("\0")
      .some(
        (entry) => entry.startsWith("160000 ") && entry.slice(entry.indexOf("\t") + 1) === filePath,
      );
  }
  const info = await stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return null;
    }
    throw error;
  });
  const kind = submodule ? "submodule" : info?.isDirectory() ? "directory" : "file";
  if (kind !== "file") {
    return {
      path: filePath,
      kind,
      baseLabel: "HEAD",
      base: "",
      working: "",
      revision: createHash("sha256").update("").digest("hex"),
      conflicted,
      ours: null,
      theirs: null,
      binary: false,
      truncated: false,
    };
  }

  const blob = async (revision: string): Promise<string> =>
    (await git(["show", revision]).catch(() => ({ stdout: "" }))).stdout;
  const base = conflicted
    ? await blob(`:1:${filePath}`)
    : change?.untracked
      ? ""
      : await blob(change?.staged ? `:${filePath}` : `HEAD:${filePath}`);
  const ours = conflicted ? await blob(`:2:${filePath}`) : null;
  const theirs = conflicted ? await blob(`:3:${filePath}`) : null;
  const size = info?.size ?? 0;
  const bytes = (value: string): number => Buffer.byteLength(value, "utf8");
  const beyondLimit =
    size > GIT_CONTENT_MAX_BYTES ||
    bytes(base) > GIT_CONTENT_MAX_BYTES ||
    bytes(ours ?? "") > GIT_CONTENT_MAX_BYTES ||
    bytes(theirs ?? "") > GIT_CONTENT_MAX_BYTES;
  let working = "";
  let binary = false;
  let revision = createHash("sha256").update("").digest("hex");
  if (size <= GIT_CONTENT_MAX_BYTES) {
    // 删除的普通文件以空工作区版本比对，保留基准内容。
    const value = info ? await readFile(absolutePath) : Buffer.alloc(0);
    revision = createHash("sha256").update(value).digest("hex");
    binary = value.includes(0);
    if (!binary) {
      working = value.toString("utf8");
    }
  } else {
    // 超过编辑上限时内容不可保存，固定 revision 保持响应结构稳定。
    revision = "0".repeat(64);
  }
  return {
    path: filePath,
    kind,
    baseLabel: conflicted
      ? "BASE"
      : change?.untracked
        ? "空文件"
        : change?.staged
          ? "索引"
          : "HEAD",
    base,
    working,
    binary,
    revision,
    conflicted,
    ours,
    theirs,
    truncated: beyondLimit || bytes(working) > GIT_CONTENT_MAX_BYTES,
  };
}
