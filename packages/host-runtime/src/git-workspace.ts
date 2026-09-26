import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  GIT_DIFF_MAX_BYTES,
  GIT_CONTENT_MAX_BYTES,
  type GitChange,
  type GitCommitResult,
  type GitCommitDetail,
  type GitCommitFile,
  type GitDiffResult,
  type GitContentResult,
  type GitGeneratedMessage,
  type GitMessageModels,
  type GitSubmodule,
  type GitSubmoduleUpdateParams,
  type GitLogResult,
  type GitLogCommit,
  type GitLogRef,
  type GitWorkspaceStatus,
  type GitSyncResult,
  type GitSyncStrategy,
  gitCommitMessageSchema,
  gitFilePathSchema,
} from "@codexhost/shared-contracts";
import { readConnection } from "@codexhost/buddy-engine";
import { readGitSubmoduleStatus } from "./git-submodule-status.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30_000;
const MESSAGE_TIMEOUT_MS = 120_000;
const MESSAGE_INPUT_MAX_CHARS = 48_000;
const MESSAGE_OUTPUT_MAX_TOKENS = 256;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const GIT_LOG_LIMIT = 200;
const GIT_LOG_MAX_BYTES = 2_000_000;
const LOG_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";
const FAST_MESSAGE_MODEL = /(?:flash|fast|turbo|mini|nano|haiku|lite|small)/iu;

function localizedGitError(detail: string): string {
  if (/not a git repository/iu.test(detail)) {
    return "当前目录不是 Git 仓库。";
  }
  if (/not a working tree/iu.test(detail)) {
    return "当前目录不是 Git 工作区。";
  }
  if (
    /no such remote|does not appear to be a git repository|repository .* does not exist/iu.test(
      detail,
    )
  ) {
    return "找不到 Git 远程仓库。";
  }
  if (
    /could not read Username|Authentication failed|Permission denied|publickey|access denied/iu.test(
      detail,
    )
  ) {
    return "Git 认证失败，请检查凭据或远程仓库访问权限。";
  }
  if (
    /could not resolve host|unable to access|Failed to connect|Connection timed out|network is unreachable/iu.test(
      detail,
    )
  ) {
    return "无法连接 Git 远程仓库，请检查网络后重试。";
  }
  if (/no upstream|no tracking information|has no upstream branch/iu.test(detail)) {
    return "当前分支没有上游远程分支。";
  }
  if (/nothing to commit|no changes added to commit|nothing added to commit/iu.test(detail)) {
    return "没有可提交的变更。";
  }
  if (/pathspec .* did not match|did not match any file/iu.test(detail)) {
    return "指定的 Git 路径不存在或未被跟踪。";
  }
  if (/would be overwritten by merge/iu.test(detail)) {
    return "合并会覆盖本地未提交的改动，请先处理这些文件。";
  }
  if (/would be overwritten by checkout/iu.test(detail)) {
    return "切换分支会覆盖本地未提交的改动，请先处理这些文件。";
  }
  if (/cannot lock ref|unable to create .*lock|index\.lock|Another git process/iu.test(detail)) {
    return "Git 仓库正被其他进程占用，请稍后重试。";
  }
  if (/CONFLICT|Automatic merge failed|fix conflicts/iu.test(detail)) {
    return "Git 合并发生冲突，请解决冲突后重试。";
  }
  if (/fatal:|error:/iu.test(detail)) {
    return detail.replace(/^(?:fatal|error):\s*/iu, "").trim() || "Git 操作失败。";
  }
  return detail;
}

export class GitWorkspaceError extends Error {
  constructor(
    message: string,
    readonly stdout = "",
    readonly stderr = "",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitWorkspaceError";
  }
}

/**
 * 推送被远端拒绝（通常因为本地落后）。保留结构化信息，让路由层可以自动
 * 进入"拉取并同步"，而不是把 raw git stderr 直接抛给用户。
 */
export class GitPushRejectedError extends GitWorkspaceError {
  constructor(
    message: string,
    readonly behind: number,
    stdout = "",
    stderr = "",
  ) {
    super(message, stdout, stderr);
    this.name = "GitPushRejectedError";
  }
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

async function runGit(
  cwd: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...arguments_], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
      env: { ...environment, LC_ALL: "C" },
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const detail = (failure.stderr || failure.stdout || failure.message || "git failed").trim();
    throw new GitWorkspaceError(
      localizedGitError(detail).slice(0, 20_000),
      failure.stdout ?? "",
      failure.stderr ?? "",
      { cause: error },
    );
  }
}

function statusCode(value: string): string {
  return value.length === 1 ? value : "?";
}

function isConflicted(indexStatus: string, workTreeStatus: string): boolean {
  return (
    indexStatus === "U" ||
    workTreeStatus === "U" ||
    (indexStatus === "A" && workTreeStatus === "A") ||
    (indexStatus === "D" && workTreeStatus === "D")
  );
}

// 判断是否存在未完成的合并或变基。直接依赖 git 的元数据目录，稳定且无需解析日志。
async function operationState(
  cwd: string,
  git: (cwd: string, arguments_: readonly string[]) => Promise<CommandResult>,
): Promise<"merge" | "rebase" | null> {
  const [mergeHead, rebaseMerge, rebaseApply] = await Promise.all([
    git(cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).catch(() => null),
    git(cwd, ["rev-parse", "--git-path", "rebase-merge"]).catch(() => null),
    git(cwd, ["rev-parse", "--git-path", "rebase-apply"]).catch(() => null),
  ]);
  if (mergeHead?.stdout.trim()) return "merge";
  for (const candidate of [rebaseMerge, rebaseApply]) {
    const directory = candidate?.stdout.trim();
    if (directory && (await pathExists(directory))) return "rebase";
  }
  return null;
}

function parsePorcelainStatus(output: string): Array<Omit<GitChange, "submodule">> {
  const records = output.split("\0");
  const changes: Array<Omit<GitChange, "submodule">> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.startsWith("## ")) continue;
    const indexStatus = statusCode(record[0] ?? " ");
    const workTreeStatus = statusCode(record[1] ?? " ");
    const untracked = indexStatus === "?" && workTreeStatus === "?";
    const rename = (indexStatus === "R" || indexStatus === "C") && records[index + 1];
    const originalPath = rename ? records[index + 1] : undefined;
    if (rename) index += 1;
    const filePath = record.slice(3);
    if (!filePath) continue;
    const conflicted = isConflicted(indexStatus, workTreeStatus);
    changes.push({
      path: gitFilePathSchema.parse(filePath),
      ...(originalPath ? { originalPath: gitFilePathSchema.parse(originalPath) } : {}),
      indexStatus,
      workTreeStatus,
      staged: !untracked && indexStatus !== " " && indexStatus !== "?",
      unstaged: untracked || workTreeStatus !== " ",
      untracked,
      conflicted,
    });
  }
  return changes;
}

interface BranchState {
  branch: string | null;
  detached: boolean;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

interface SubmoduleState {
  path: string;
  status: GitSubmodule["status"];
}

function absoluteGitPath(cwd: string, filePath: string): string {
  const workspace = absoluteWorkspace(cwd);
  const absolute = path.resolve(workspace, filePath);
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${path.sep}`)) {
    throw new GitWorkspaceError("Git 路径超出工作区范围。");
  }
  return absolute;
}

async function submodules(
  cwd: string,
  git: (cwd: string, arguments_: readonly string[]) => Promise<CommandResult> = runGit,
): Promise<{ submodules: SubmoduleState[]; warnings: string[] }> {
  const [result, porcelain] = await Promise.all([
    readGitSubmoduleStatus(cwd, git),
    git(cwd, ["status", "--porcelain=v1", "-z", "--ignore-submodules=none"]),
  ]);
  const dirty = new Set(
    parsePorcelainStatus(porcelain.stdout)
      .filter((change) => change.workTreeStatus === "M" || change.indexStatus === "M")
      .map((change) => change.path),
  );
  const modules = result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const marker = line[0] ?? " ";
      const rest = line.slice(1);
      const separator = rest.indexOf(" ");
      if (separator < 0) return [];
      const pathValue =
        rest
          .slice(separator + 1)
          .split(" (")[0]
          ?.trim() ?? "";
      if (!pathValue) return [];
      const status: GitSubmodule["status"] =
        marker === "-"
          ? "uninitialized"
          : marker === "+" || dirty.has(pathValue)
            ? "modified"
            : marker === "U"
              ? "conflicted"
              : "current";
      return [{ path: gitFilePathSchema.parse(pathValue), status }];
    });
  return { submodules: modules, warnings: result.warnings };
}

function parseBranch(header: string | undefined): BranchState {
  if (!header) {
    return { branch: null, detached: false, head: null, upstream: null, ahead: 0, behind: 0 };
  }
  if (header.startsWith("## HEAD (no branch)")) {
    return { branch: null, detached: true, head: null, upstream: null, ahead: 0, behind: 0 };
  }
  const value = header.slice(3);
  const unborn = /^No commits yet on (.+)$/u.exec(value)?.[1];
  if (unborn) {
    return {
      branch: unborn,
      detached: false,
      head: null,
      upstream: null,
      ahead: 0,
      behind: 0,
    };
  }
  const [local, tracking] = value.split("...", 2);
  const branch = local?.split(" ")[0] ?? null;
  const upstream = tracking?.split(" ")[0] ?? null;
  // 计数出现在 `[ahead 2, behind 1]` 中，`behind` 前是 `[` 或空格而非单词边界。
  const ahead = Number(/(?:^|[^a-z])ahead (\d+)/u.exec(value)?.[1] ?? 0);
  const behind = Number(/(?:^|[^a-z])behind (\d+)/u.exec(value)?.[1] ?? 0);
  return {
    branch: branch || null,
    detached: false,
    head: null,
    upstream: upstream || null,
    ahead,
    behind,
  };
}

function absoluteWorkspace(cwd: string): string {
  return path.resolve(cwd);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// 远端拒绝推送时 git 的措辞在不同版本和传输层略有差异，这里统一识别常见的 non-fast-forward 信号。
function isNonFastForward(detail: string): boolean {
  return /non-fast-forward|fetch first|Updates were rejected|failed to push some refs|tip of your current branch is behind|cannot lock ref|stale info/iu.test(
    detail,
  );
}

function parseRefs(output: string): GitLogRef[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const [commit, name] = line.split(FIELD_SEPARATOR);
      if (!commit || !name) return [];
      const kind: GitLogRef["kind"] =
        name === "HEAD"
          ? "head"
          : name.startsWith("refs/heads/")
            ? "local"
            : name.startsWith("refs/remotes/")
              ? "remote"
              : name.startsWith("refs/tags/")
                ? "tag"
                : "local";
      return [{ name, kind, commit, current: name === "HEAD" }];
    });
}

function parseLog(output: string): GitLogCommit[] {
  return output
    .split(LOG_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const fields = record.split(FIELD_SEPARATOR);
      const [commit, shortCommit, parents, refs, authorName, authorEmail, authoredAt, subject] =
        fields;
      if (!commit || !shortCommit || !authorName || !authorEmail || !authoredAt) return [];
      return [
        {
          commit,
          shortCommit,
          subject: subject ?? "",
          authorName,
          authorEmail,
          authoredAt,
          parents: parents ? parents.split(" ").filter(Boolean) : [],
          refs: refs
            ? refs
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        },
      ];
    });
}

function parseCommitFiles(statusOutput: string, numberOutput: string): GitCommitFile[] {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of numberOutput.split("\n")) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/u.exec(line);
    if (!match) continue;
    const filePath = match[3];
    if (!filePath) continue;
    counts.set(filePath, {
      additions: match[1] === "-" ? null : Number(match[1]),
      deletions: match[2] === "-" ? null : Number(match[2]),
    });
  }
  return statusOutput.split("\n").flatMap((line) => {
    const parts = line.split("\t");
    const status = parts[0]?.slice(0, 1);
    const firstPath = parts[1];
    const secondPath = parts[2];
    const filePath = secondPath ?? firstPath;
    if (!status || !filePath) return [];
    const count = counts.get(filePath) ?? { additions: null, deletions: null };
    return [
      {
        path: gitFilePathSchema.parse(filePath),
        ...(secondPath ? { originalPath: gitFilePathSchema.parse(firstPath) } : {}),
        status: status.toUpperCase(),
        additions: count.additions,
        deletions: count.deletions,
      },
    ];
  });
}

export class GitWorkspace {
  #queue: Promise<unknown> = Promise.resolve();
  readonly #mutations = new Map<string, Promise<unknown>>();

  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  #run(cwd: string, arguments_: readonly string[]): Promise<CommandResult> {
    return runGit(cwd, arguments_, this.environment);
  }

  async status(cwd: string): Promise<GitWorkspaceStatus> {
    return this.#serial(() => this.#statusUnlocked(cwd));
  }

  async root(cwd: string): Promise<string | null> {
    try {
      const result = await this.#run(absoluteWorkspace(cwd), ["rev-parse", "--show-toplevel"]);
      return realpath(result.stdout.trim());
    } catch (error) {
      if (error instanceof GitWorkspaceError && /not a git repository/u.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async diff(cwd: string, filePath: string): Promise<GitDiffResult> {
    return this.#serial(async () => {
      const pathValue = gitFilePathSchema.parse(filePath);
      const workspace = absoluteWorkspace(cwd);
      const result = await this.#diffUnlocked(workspace, pathValue);
      const bytes = Buffer.byteLength(result.stdout, "utf8");
      return {
        path: pathValue,
        diff: result.stdout,
        truncated: bytes > GIT_DIFF_MAX_BYTES,
      };
    });
  }

  async content(cwd: string, filePath: string): Promise<GitContentResult> {
    return this.#serial(async () => {
      const pathValue = gitFilePathSchema.parse(filePath);
      const workspace = absoluteWorkspace(cwd);
      const status = await this.#statusUnlocked(workspace);
      const change = status.changes.find((entry) => entry.path === pathValue);
      const stage = await this.#run(workspace, ["ls-files", "-u", "-z", "--", pathValue]).catch(
        () => ({ stdout: "", stderr: "" }),
      );
      const conflicted = Boolean(change?.conflicted) || stage.stdout.length > 0;
      const base = conflicted
        ? await this.#optionalBlob(workspace, `:1:${pathValue}`)
        : change?.untracked
          ? ""
          : await this.#optionalBlob(
              workspace,
              change?.staged ? `:${pathValue}` : `HEAD:${pathValue}`,
            );
      const ours = conflicted ? await this.#optionalBlob(workspace, `:2:${pathValue}`) : null;
      const theirs = conflicted ? await this.#optionalBlob(workspace, `:3:${pathValue}`) : null;
      const absolute = absoluteGitPath(workspace, pathValue);
      const info = await stat(absolute).catch(() => null);
      const size = info?.size ?? 0;
      const bytes = (value: string): number => Buffer.byteLength(value, "utf8");
      const beyondLimit =
        size > GIT_CONTENT_MAX_BYTES ||
        bytes(base) > GIT_CONTENT_MAX_BYTES ||
        bytes(ours ?? "") > GIT_CONTENT_MAX_BYTES ||
        bytes(theirs ?? "") > GIT_CONTENT_MAX_BYTES;
      let workingFile = "";
      let binary = false;
      let revision = createHash("sha256").update("").digest("hex");
      if (size <= GIT_CONTENT_MAX_BYTES) {
        const value = await readFile(absolute);
        revision = createHash("sha256").update(value).digest("hex");
        binary = value.includes(0);
        if (!binary) workingFile = value.toString("utf8");
      } else {
        // 超过编辑上限时内容不可保存，固定 revision 只用于保持响应结构稳定。
        revision = "0".repeat(64);
      }
      const truncated = beyondLimit || bytes(workingFile) > GIT_CONTENT_MAX_BYTES;
      return {
        path: pathValue,
        baseLabel: conflicted
          ? "BASE"
          : change?.untracked
            ? "空文件"
            : change?.staged
              ? "索引"
              : "HEAD",
        base,
        working: binary ? "" : workingFile,
        binary,
        revision,
        conflicted,
        ours,
        theirs,
        truncated,
      };
    });
  }

  async #optionalBlob(cwd: string, revision: string): Promise<string> {
    return (await this.#run(cwd, ["show", revision]).catch(() => ({ stdout: "", stderr: "" })))
      .stdout;
  }

  async stage(cwd: string, paths: readonly string[]): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["stage", ...[...paths].sort()], async () => {
      const workspace = absoluteWorkspace(cwd);
      const validated = paths.map((pathValue) => gitFilePathSchema.parse(pathValue));
      if (validated.length > 0) {
        await this.#run(workspace, ["add", "--", ...validated]);
      }
      return this.#statusUnlocked(workspace);
    });
  }

  async unstage(cwd: string, paths: readonly string[]): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["unstage", ...[...paths].sort()], async () => {
      const workspace = absoluteWorkspace(cwd);
      const validated = paths.map((pathValue) => gitFilePathSchema.parse(pathValue));
      if (validated.length > 0) {
        await this.#run(workspace, ["restore", "--staged", "--", ...validated]);
      }
      return this.#statusUnlocked(workspace);
    });
  }

  async commit(
    cwd: string,
    message: string,
    push: boolean,
    paths: readonly string[] = [],
  ): Promise<GitCommitResult> {
    return this.#mutation(cwd, ["commit", message, push, [...paths].sort()], async () => {
      const workspace = absoluteWorkspace(cwd);
      const parsedMessage = gitCommitMessageSchema.parse(message);
      const validatedPaths = paths.map((pathValue) => gitFilePathSchema.parse(pathValue));
      await this.#run(workspace, [
        "commit",
        "-m",
        parsedMessage,
        ...(validatedPaths.length > 0 ? ["--", ...validatedPaths] : []),
      ]);
      let pushed = false;
      let output = "";
      if (push) {
        const result = await this.#pushUnlocked(workspace);
        pushed = true;
        output = result.stdout || result.stderr;
      }
      const commit = (await this.#run(workspace, ["rev-parse", "--short", "HEAD"])).stdout.trim();
      return {
        commit: commit || null,
        pushed,
        output: output.trim(),
        status: await this.#statusUnlocked(workspace),
      };
    });
  }

  async push(cwd: string): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["push"], async () => {
      const workspace = absoluteWorkspace(cwd);
      await this.#pushUnlocked(workspace);
      return this.#statusUnlocked(workspace);
    });
  }

  /** 拉取远端引用，不改变工作区；供同步与状态刷新共用。 */
  async fetch(cwd: string): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["fetch"], async () => {
      const workspace = absoluteWorkspace(cwd);
      await this.#fetchUnlocked(workspace);
      return this.#statusUnlocked(workspace);
    });
  }

  /**
   * 拉取并同步当前分支与上游：先 fetch，再按可快进或合并把远端合入本地。
   * 默认策略是 merge，保留双方历史；发生冲突时保留冲突工作区并返回冲突文件，
   * 由上层交给模型消解，不做自动冲突合并。
   */
  async sync(cwd: string): Promise<GitSyncResult> {
    return this.#mutation(cwd, ["sync"], async () => {
      const workspace = absoluteWorkspace(cwd);
      const before = await this.#statusUnlocked(workspace);
      const upstream = before.upstream;
      if (!upstream) {
        throw new GitWorkspaceError("当前分支没有上游远程分支，无法拉取同步。");
      }
      await this.#fetchUnlocked(workspace);
      const fetched = await this.#statusUnlocked(workspace);
      if (fetched.behind === 0) {
        return {
          strategy: "up-to-date",
          behind: 0,
          conflicts: [],
          output: "远端没有新的提交，工作区已是最新。",
          status: fetched,
        };
      }
      const behind = fetched.behind;
      // ahead 为 0 时可以快进，避免产生多余的合并提交；否则执行真正合并。
      const strategy: GitSyncStrategy = fetched.ahead === 0 ? "fast-forward" : "merged";
      try {
        await this.#run(workspace, ["merge", "--no-edit", upstream]);
      } catch (error) {
        const failure = error as GitWorkspaceError;
        const after = await this.#statusUnlocked(workspace);
        if (after.conflicts.length > 0) {
          return {
            strategy: "conflict",
            behind,
            conflicts: after.conflicts,
            output: (failure.stdout || failure.stderr || failure.message).trim(),
            status: after,
          };
        }
        throw error;
      }
      const after = await this.#statusUnlocked(workspace);
      return {
        strategy,
        behind,
        conflicts: [],
        output:
          strategy === "fast-forward"
            ? `已快进到远端 ${behind} 个提交。`
            : `已合并远端 ${behind} 个提交。`,
        status: after,
      };
    });
  }

  /** 冲突消解并暂存后，提交合并结果。 */
  async mergeContinue(cwd: string): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["merge-continue"], async () => {
      const workspace = absoluteWorkspace(cwd);
      const operation = await operationState(workspace, (worktree, arguments_) =>
        this.#run(worktree, arguments_),
      );
      if (operation !== "merge") {
        throw new GitWorkspaceError("当前没有进行中的合并，无法继续。");
      }
      const staged = (await this.#statusUnlocked(workspace)).conflicts.length === 0;
      if (!staged) {
        throw new GitWorkspaceError("仍有未解决的冲突文件，先解决并暂存后再继续合并。");
      }
      await this.#run(workspace, ["commit", "--no-edit"]);
      return this.#statusUnlocked(workspace);
    });
  }

  /** 放弃当前合并，恢复到合并前状态。 */
  async mergeAbort(cwd: string): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["merge-abort"], async () => {
      const workspace = absoluteWorkspace(cwd);
      const operation = await operationState(workspace, (worktree, arguments_) =>
        this.#run(worktree, arguments_),
      );
      if (!operation) {
        throw new GitWorkspaceError("当前没有进行中的合并或变基，无法中止。");
      }
      await this.#run(workspace, [operation === "rebase" ? "rebase" : "merge", "--abort"]);
      return this.#statusUnlocked(workspace);
    });
  }

  async submodules(cwd: string): Promise<{ submodules: GitSubmodule[]; warnings: string[] }> {
    return this.#serial(() =>
      submodules(absoluteWorkspace(cwd), (worktree, arguments_) => this.#run(worktree, arguments_)),
    );
  }

  async updateSubmodule(
    cwd: string,
    input: Pick<GitSubmoduleUpdateParams, "path" | "init">,
  ): Promise<GitWorkspaceStatus> {
    return this.#mutation(cwd, ["submodule-update", input.path, input.init], async () => {
      const workspace = absoluteWorkspace(cwd);
      const pathValue = gitFilePathSchema.parse(input.path);
      absoluteGitPath(workspace, pathValue);
      const known = await submodules(workspace, (worktree, arguments_) =>
        this.#run(worktree, arguments_),
      );
      if (!known.submodules.some((entry) => entry.path === pathValue)) {
        throw new GitWorkspaceError("所选路径不是已声明的 Git 子模块。");
      }
      await this.#run(workspace, [
        "submodule",
        "update",
        ...(input.init ? ["--init"] : []),
        "--",
        pathValue,
      ]);
      return this.#statusUnlocked(workspace);
    });
  }

  async log(cwd: string, limit = GIT_LOG_LIMIT): Promise<GitLogResult> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      const safeLimit = Math.max(1, Math.min(Math.trunc(limit), GIT_LOG_LIMIT));
      const [refs, commits, head, branch] = await Promise.all([
        this.#run(workspace, [
          "for-each-ref",
          `--format=%(objectname)${FIELD_SEPARATOR}%(refname)`,
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ]),
        this.#run(workspace, [
          "log",
          "--all",
          `--max-count=${safeLimit}`,
          `--pretty=format:%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${LOG_SEPARATOR}`,
        ]),
        this.#run(workspace, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "", stderr: "" })),
        this.#run(workspace, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => ({
          stdout: "",
          stderr: "",
        })),
      ]);
      const headCommit = head.stdout.trim();
      const currentBranch = branch.stdout.trim() || null;
      const parsedRefs = parseRefs(refs.stdout);
      if (headCommit) {
        parsedRefs.unshift({ name: "HEAD", kind: "head", commit: headCommit, current: true });
      }
      if (Buffer.byteLength(commits.stdout, "utf8") > GIT_LOG_MAX_BYTES) {
        throw new GitWorkspaceError("Git 日志过大，请缩小范围后重试。");
      }
      return {
        workspace,
        branch: currentBranch,
        head: headCommit || null,
        refs: parsedRefs,
        commits: parseLog(commits.stdout),
      };
    });
  }

  async commitDetail(cwd: string, commit: string): Promise<GitCommitDetail> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      const value = commit.trim();
      if (!/^[0-9a-f]{7,64}$/iu.test(value)) throw new GitWorkspaceError("无效的提交哈希。");
      const [metadata, body, status, numbers] = await Promise.all([
        this.#run(workspace, [
          "show",
          "-s",
          `--format=%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s`,
          value,
        ]),
        this.#run(workspace, ["show", "-s", "--format=%B", value]),
        this.#run(workspace, ["show", "--format=", "--name-status", "--no-renames", value]),
        this.#run(workspace, ["show", "--format=", "--numstat", "--no-renames", value]),
      ]);
      const parsed = parseLog(metadata.stdout);
      const commitValue = parsed[0];
      if (!commitValue) throw new GitWorkspaceError("无法读取提交信息。");
      return {
        commit: commitValue,
        body: body.stdout.trim(),
        files: parseCommitFiles(status.stdout, numbers.stdout),
      };
    });
  }

  async commitDiff(cwd: string, commit: string, filePath: string): Promise<GitDiffResult> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      const value = commit.trim();
      if (!/^[0-9a-f]{7,64}$/iu.test(value)) throw new GitWorkspaceError("无效的提交哈希。");
      const pathValue = gitFilePathSchema.parse(filePath);
      const result = await this.#run(workspace, [
        "show",
        "--format=",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        value,
        "--",
        pathValue,
      ]);
      return {
        path: pathValue,
        diff: result.stdout,
        truncated: Buffer.byteLength(result.stdout, "utf8") > GIT_DIFF_MAX_BYTES,
      };
    });
  }

  async messageModels(environment: NodeJS.ProcessEnv): Promise<GitMessageModels> {
    return this.#serial(async () => {
      const home = path.resolve(
        environment.CODEX_HOME ?? path.join(process.env.HOME ?? "", ".codex"),
      );
      let connection;
      try {
        connection = await readConnection(home, environment);
      } catch {
        return { models: [], defaultModel: null };
      }
      try {
        const response = await fetch(connection.url, {
          headers: connection.headers,
          redirect: "error",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return { models: [], defaultModel: null };
        const body = (await response.json()) as { data?: unknown };
        const ids = Array.isArray(body.data)
          ? body.data.flatMap((item) =>
              item && typeof item === "object" && "id" in item && typeof item.id === "string"
                ? [item.id]
                : [],
            )
          : [];
        const unavailable =
          /(?:embedding|rerank|moderation|whisper|tts|image|audio|vision-only|safety)/iu;
        const models = [...new Set(ids)].map((id, catalogIndex) => ({
          id,
          label: id,
          catalogIndex,
          tier: /(?:^|[/:])(?:gpt|claude)(?=[\d._-]|$)/iu.test(id)
            ? ("夯" as const)
            : ("垃" as const),
          eligible: !unavailable.test(id),
          recommended: false,
        }));
        const ranked = [...models].sort((left, right) => {
          const leftWeak = left.tier === "垃" ? 1 : 0;
          const rightWeak = right.tier === "垃" ? 1 : 0;
          return (
            Number(right.eligible) - Number(left.eligible) ||
            rightWeak - leftWeak ||
            Number(FAST_MESSAGE_MODEL.test(right.id)) - Number(FAST_MESSAGE_MODEL.test(left.id)) ||
            left.catalogIndex - right.catalogIndex
          );
        });
        const defaultModel = ranked.find((model) => model.eligible)?.id ?? null;
        return {
          models: models.map((model) => ({
            id: model.id,
            label: model.label,
            tier: model.tier,
            eligible: model.eligible,
            recommended: model.id === defaultModel,
          })),
          defaultModel,
        };
      } catch {
        return { models: [], defaultModel: null };
      }
    });
  }

  async generateMessage(input: {
    cwd: string;
    model: string;
    paths?: readonly string[];
    environment: NodeJS.ProcessEnv;
  }): Promise<GitGeneratedMessage> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(input.cwd);
      const model = input.model.trim();
      if (!model) throw new GitWorkspaceError("请选择模型后再生成提交消息。");
      const home = path.resolve(
        input.environment.CODEX_HOME ?? path.join(process.env.HOME ?? "", ".codex"),
      );
      const connection = await readConnection(home, input.environment);
      const paths = (input.paths ?? []).map((pathValue) => gitFilePathSchema.parse(pathValue));
      const pathArguments = paths.length > 0 ? ["--", ...paths] : [];
      const status = await this.#run(workspace, ["status", "--short", ...pathArguments]);
      const diffs = await Promise.all(
        paths.length > 0
          ? paths.map((pathValue) => this.#diffUnlocked(workspace, pathValue))
          : [this.#diffUnlocked(workspace)],
      );
      const diff = { stdout: diffs.map((result) => result.stdout).join("") };
      const payload = `${status.stdout}\n\n${diff.stdout}`.slice(0, MESSAGE_INPUT_MAX_CHARS);
      if (!payload.trim()) throw new GitWorkspaceError("当前没有可生成消息的变更。");
      const completionUrl = new URL(connection.url);
      completionUrl.pathname = completionUrl.pathname.replace(/\/models$/u, "/chat/completions");
      const response = await fetch(completionUrl, {
        method: "POST",
        headers: {
          ...Object.fromEntries(connection.headers),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "你是 Git 提交消息助手。根据变更只输出一条简洁的 Conventional Commit 提交消息，使用中文正文（如需要），不要 Markdown、不要引号、不要解释。",
            },
            { role: "user", content: payload },
          ],
          stream: false,
          store: false,
          max_tokens: MESSAGE_OUTPUT_MAX_TOKENS,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new GitWorkspaceError(`生成提交消息失败：HTTP ${response.status}`);
      }
      const body = (await response.json()) as { choices?: unknown };
      const choice = Array.isArray(body.choices) ? body.choices[0] : null;
      const message =
        choice &&
        typeof choice === "object" &&
        "message" in choice &&
        choice.message &&
        typeof choice.message === "object" &&
        "content" in choice.message &&
        typeof choice.message.content === "string"
          ? choice.message.content.trim()
          : "";
      if (!message) throw new GitWorkspaceError("模型没有返回提交消息。");
      return { message: gitCommitMessageSchema.parse(message), model };
    });
  }

  // 进行中的相同写操作共用结果；成功或失败后均允许用户显式重试。
  #mutation<T>(cwd: string, input: readonly unknown[], operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([absoluteWorkspace(cwd), input]);
    const existing = this.#mutations.get(key);
    if (existing) return existing as Promise<T>;
    const request = this.#serial(operation).finally(() => {
      if (this.#mutations.get(key) === request) this.#mutations.delete(key);
    });
    this.#mutations.set(key, request);
    return request;
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #fetchUnlocked(cwd: string): Promise<CommandResult> {
    return this.#run(cwd, ["fetch", "--prune"]);
  }

  /**
   * 推送当前分支；non-fast-forward 被拒时抛结构化错误并带上落后提交数，
   * 让路由层可以自动进入"拉取并同步"或把冲突交给模型，而不是只显示 raw stderr。
   */
  async #pushUnlocked(cwd: string): Promise<CommandResult> {
    try {
      return await this.#run(cwd, ["push"]);
    } catch (error) {
      const failure = error as GitWorkspaceError;
      const detail = `${failure.stdout}\n${failure.stderr}\n${failure.message}`;
      if (isNonFastForward(detail)) {
        let behind = 0;
        try {
          // 推送失败时本地跟踪引用可能还是旧的，先 fetch 才能得到真实落后提交数。
          await this.#fetchUnlocked(cwd);
          behind = (await this.#statusUnlocked(cwd)).behind;
        } catch {
          behind = 0;
        }
        throw new GitPushRejectedError(
          "推送被远端拒绝：本地与远端已分叉，需要先拉取并同步。",
          behind,
          failure.stdout,
          failure.stderr,
        );
      }
      throw error;
    }
  }

  async #isUntracked(cwd: string, filePath: string): Promise<boolean> {
    const status = await this.#run(cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      filePath,
    ]);
    return status.stdout.startsWith("?? ");
  }

  async #hasHead(cwd: string): Promise<boolean> {
    try {
      await this.#run(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async #diffUnlocked(cwd: string, filePath?: string): Promise<CommandResult> {
    const pathArguments = filePath ? ["--", filePath] : [];
    let result: CommandResult;
    if (await this.#hasHead(cwd)) {
      result = await this.#run(cwd, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "HEAD",
        ...pathArguments,
      ]);
    } else {
      const [staged, unstaged] = await Promise.all([
        this.#run(cwd, [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-color",
          "--unified=3",
          ...pathArguments,
        ]),
        this.#run(cwd, ["diff", "--no-ext-diff", "--no-color", "--unified=3", ...pathArguments]),
      ]);
      result = {
        stdout: `${staged.stdout}${unstaged.stdout}`,
        stderr: staged.stderr + unstaged.stderr,
      };
    }
    if (filePath && !result.stdout && (await this.#isUntracked(cwd, filePath))) {
      result = await this.#untrackedDiff(cwd, filePath);
    }
    return result;
  }

  async #untrackedDiff(cwd: string, filePath: string): Promise<CommandResult> {
    try {
      return await this.#run(cwd, [
        "diff",
        "--no-index",
        "--no-color",
        "--unified=3",
        process.platform === "win32" ? "NUL" : "/dev/null",
        filePath,
      ]);
    } catch (error) {
      if (error instanceof GitWorkspaceError && error.stdout) {
        return { stdout: error.stdout, stderr: error.stderr };
      }
      throw error;
    }
  }

  async #statusUnlocked(cwd: string): Promise<GitWorkspaceStatus> {
    const workspace = absoluteWorkspace(cwd);
    const [{ stdout }, head, submoduleStates, operation] = await Promise.all([
      this.#run(workspace, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]),
      this.#run(workspace, ["rev-parse", "--short", "HEAD"]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      submodules(workspace, (worktree, arguments_) => this.#run(worktree, arguments_)),
      operationState(workspace, (worktree, arguments_) => this.#run(worktree, arguments_)),
    ]);
    const records = stdout.split("\0");
    const header = records.find((record) => record.startsWith("## "));
    const branch = parseBranch(header);
    const changes = parsePorcelainStatus(stdout).map((change) => ({
      ...change,
      submodule: submoduleStates.submodules.find((entry) => entry.path === change.path) ?? null,
    }));
    return {
      workspace,
      ...branch,
      head: head.stdout.trim() || null,
      changes,
      submodules: submoduleStates.submodules,
      warnings: submoduleStates.warnings,
      operation,
      conflicts: changes.filter((change) => change.conflicted).map((change) => change.path),
    };
  }
}
