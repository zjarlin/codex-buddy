import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  GIT_DIFF_MAX_BYTES,
  type GitChange,
  type GitCommitResult,
  type GitCommitDetail,
  type GitCommitFile,
  type GitDiffResult,
  type GitGeneratedMessage,
  type GitMessageModels,
  type GitSubmodule,
  type GitSubmoduleUpdateParams,
  type GitLogResult,
  type GitLogCommit,
  type GitLogRef,
  type GitWorkspaceStatus,
  gitCommitMessageSchema,
  gitFilePathSchema,
} from "@codexhost/shared-contracts";
import { readConnection } from "@codexhost/buddy-engine";

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
      detail.slice(0, 20_000),
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
): Promise<SubmoduleState[]> {
  const [result, porcelain] = await Promise.all([
    git(cwd, ["submodule", "status", "--recursive"]),
    git(cwd, ["status", "--porcelain=v1", "-z", "--ignore-submodules=none"]),
  ]);
  const dirty = new Set(
    parsePorcelainStatus(porcelain.stdout)
      .filter((change) => change.workTreeStatus === "M" || change.indexStatus === "M")
      .map((change) => change.path),
  );
  return result.stdout
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
  const ahead = Number(/(?:^|\s)ahead (\d+)/u.exec(value)?.[1] ?? 0);
  const behind = Number(/(?:^|\s)behind (\d+)/u.exec(value)?.[1] ?? 0);
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

  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  #run(cwd: string, arguments_: readonly string[]): Promise<CommandResult> {
    return runGit(cwd, arguments_, this.environment);
  }

  async status(cwd: string): Promise<GitWorkspaceStatus> {
    return this.#serial(() => this.#statusUnlocked(cwd));
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

  async stage(cwd: string, paths: readonly string[]): Promise<GitWorkspaceStatus> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      const validated = paths.map((pathValue) => gitFilePathSchema.parse(pathValue));
      if (validated.length > 0) {
        await this.#run(workspace, ["add", "--", ...validated]);
      }
      return this.#statusUnlocked(workspace);
    });
  }

  async unstage(cwd: string, paths: readonly string[]): Promise<GitWorkspaceStatus> {
    return this.#serial(async () => {
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
    return this.#serial(async () => {
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
        const result = await this.#run(workspace, ["push"]);
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
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      await this.#run(workspace, ["push"]);
      return this.#statusUnlocked(workspace);
    });
  }

  async submodules(cwd: string): Promise<{ submodules: GitSubmodule[] }> {
    return this.#serial(async () => ({
      submodules: await submodules(absoluteWorkspace(cwd), (worktree, arguments_) =>
        this.#run(worktree, arguments_),
      ),
    }));
  }

  async updateSubmodule(
    cwd: string,
    input: Pick<GitSubmoduleUpdateParams, "path" | "init">,
  ): Promise<GitWorkspaceStatus> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      const pathValue = gitFilePathSchema.parse(input.path);
      absoluteGitPath(workspace, pathValue);
      const known = await submodules(workspace, (worktree, arguments_) =>
        this.#run(worktree, arguments_),
      );
      if (!known.some((entry) => entry.path === pathValue)) {
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

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
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
    const [{ stdout }, head, submoduleStates] = await Promise.all([
      this.#run(workspace, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]),
      this.#run(workspace, ["rev-parse", "--short", "HEAD"]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      submodules(workspace, (worktree, arguments_) => this.#run(worktree, arguments_)),
    ]);
    const records = stdout.split("\0");
    const header = records.find((record) => record.startsWith("## "));
    const branch = parseBranch(header);
    return {
      workspace,
      ...branch,
      head: head.stdout.trim() || null,
      changes: parsePorcelainStatus(stdout).map((change) => ({
        ...change,
        submodule: submoduleStates.find((entry) => entry.path === change.path) ?? null,
      })),
      submodules: submoduleStates,
    };
  }
}
