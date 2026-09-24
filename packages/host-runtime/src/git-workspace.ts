import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  GIT_DIFF_MAX_BYTES,
  type GitChange,
  type GitCommitResult,
  type GitDiffResult,
  type GitGeneratedMessage,
  type GitMessageModels,
  type GitWorkspaceStatus,
  gitCommitMessageSchema,
  gitFilePathSchema,
} from "@codexhost/shared-contracts";
import { readConnection } from "@codexhost/buddy-engine";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30_000;
const MESSAGE_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

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

async function runGit(cwd: string, arguments_: readonly string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...arguments_], {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C" },
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

function parsePorcelainStatus(output: string): GitChange[] {
  const records = output.split("\0");
  const changes: GitChange[] = [];
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
  return { branch: branch || null, detached: false, head: null, upstream: upstream || null, ahead, behind };
}

function absoluteWorkspace(cwd: string): string {
  return path.resolve(cwd);
}

export class GitWorkspace {
  #queue: Promise<unknown> = Promise.resolve();

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
        await runGit(workspace, ["add", "--", ...validated]);
      }
      return this.#statusUnlocked(workspace);
    });
  }

  async unstage(cwd: string, paths: readonly string[]): Promise<GitWorkspaceStatus> {
    return this.#serial(async () => {
      const workspace = absoluteWorkspace(cwd);
      const validated = paths.map((pathValue) => gitFilePathSchema.parse(pathValue));
      if (validated.length > 0) {
        await runGit(workspace, ["restore", "--staged", "--", ...validated]);
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
      await runGit(workspace, [
        "commit",
        "-m",
        parsedMessage,
        ...(validatedPaths.length > 0 ? ["--", ...validatedPaths] : []),
      ]);
      let pushed = false;
      let output = "";
      if (push) {
        const result = await runGit(workspace, ["push"]);
        pushed = true;
        output = result.stdout || result.stderr;
      }
      const commit = (await runGit(workspace, ["rev-parse", "--short", "HEAD"])).stdout.trim();
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
      await runGit(workspace, ["push"]);
      return this.#statusUnlocked(workspace);
    });
  }

  async messageModels(environment: NodeJS.ProcessEnv): Promise<GitMessageModels> {
    return this.#serial(async () => {
      const home = path.resolve(environment.CODEX_HOME ?? path.join(process.env.HOME ?? "", ".codex"));
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
        const models = [...new Set(ids)].map((id) => ({
          id,
          label: id,
          tier: /(?:^|[/:])(?:gpt|claude)(?=[\d._-]|$)/iu.test(id)
            ? ("夯" as const)
            : ("垃" as const),
          eligible: !unavailable.test(id),
        }));
        const weak = models.find((model) => model.eligible && model.tier === "垃");
        return {
          models,
          defaultModel: weak?.id ?? models.find((model) => model.eligible)?.id ?? null,
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
      const status = await runGit(workspace, [
        "status",
        "--short",
        ...pathArguments,
      ]);
      const diffs = await Promise.all(
        paths.length > 0
          ? paths.map((pathValue) => this.#diffUnlocked(workspace, pathValue))
          : [this.#diffUnlocked(workspace)],
      );
      const diff = { stdout: diffs.map((result) => result.stdout).join("") };
      const payload = `${status.stdout}\n\n${diff.stdout}`.slice(0, 120_000);
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
          max_tokens: 512,
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
        choice && typeof choice === "object" && "message" in choice && choice.message &&
        typeof choice.message === "object" && "content" in choice.message &&
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
    const status = await runGit(cwd, [
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
      await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async #diffUnlocked(cwd: string, filePath?: string): Promise<CommandResult> {
    const pathArguments = filePath ? ["--", filePath] : [];
    let result: CommandResult;
    if (await this.#hasHead(cwd)) {
      result = await runGit(cwd, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "HEAD",
        ...pathArguments,
      ]);
    } else {
      const [staged, unstaged] = await Promise.all([
        runGit(cwd, ["diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3", ...pathArguments]),
        runGit(cwd, ["diff", "--no-ext-diff", "--no-color", "--unified=3", ...pathArguments]),
      ]);
      result = { stdout: `${staged.stdout}${unstaged.stdout}`, stderr: staged.stderr + unstaged.stderr };
    }
    if (filePath && !result.stdout && (await this.#isUntracked(cwd, filePath))) {
      result = await this.#untrackedDiff(cwd, filePath);
    }
    return result;
  }

  async #untrackedDiff(cwd: string, filePath: string): Promise<CommandResult> {
    try {
      return await runGit(cwd, [
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
    const [{ stdout }, head] = await Promise.all([
      runGit(workspace, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]),
      runGit(workspace, ["rev-parse", "--short", "HEAD"]).catch(() => ({ stdout: "", stderr: "" })),
    ]);
    const records = stdout.split("\0");
    const header = records.find((record) => record.startsWith("## "));
    const branch = parseBranch(header);
    return {
      workspace,
      ...branch,
      head: head.stdout.trim() || null,
      changes: parsePorcelainStatus(stdout),
    };
  }
}
