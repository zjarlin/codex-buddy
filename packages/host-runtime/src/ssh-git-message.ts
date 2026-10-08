import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  gitGeneratedMessageSchema,
  gitMessageModelsSchema,
  type GitGeneratedMessage,
  type GitMessageModels,
  type GitWorkspaceStatus,
} from "@codexhost/shared-contracts";
import type { DesktopSshConnection } from "./desktop-ssh-connection.js";
import { GitWorkspaceError } from "./git-workspace.js";

declare const __CODEXHOST_SSH_GIT_MESSAGE_WORKER__: string;

type Request =
  | { kind: "models" }
  | { kind: "generate"; cwd: string; model: string; paths: readonly string[] }
  | { kind: "revision"; status: GitWorkspaceStatus };

type Execute = (input: {
  arguments: string[];
  environment: NodeJS.ProcessEnv;
  source: string;
}) => Promise<string>;

const execute: Execute = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn("ssh", input.arguments, {
      env: input.environment,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      signal: AbortSignal.timeout(130_000),
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        child.kill();
        reject(new Error("SSH Git message response is too large"));
        return;
      }
      chunks.push(chunk);
    });
    child.once("close", (code) => {
      if (code !== 0) reject(new Error("SSH Git message request failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(input.source);
  });

function workerSource(): Promise<string> {
  if (typeof __CODEXHOST_SSH_GIT_MESSAGE_WORKER__ === "string") {
    return Promise.resolve(__CODEXHOST_SSH_GIT_MESSAGE_WORKER__);
  }
  return readFile(new URL("./ssh-git-message-worker.bundle.mjs", import.meta.url), "utf8");
}

// 固定 Worker 仅在远端读取 Codex 配置、调用模型及读取 Git 变更；本机凭据绝不参与。
export class SshGitMessageService {
  constructor(
    private readonly connection: DesktopSshConnection,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly options: { execute?: Execute; workerSource?: () => Promise<string> } = {},
  ) {}

  async messageRevision(status: GitWorkspaceStatus): Promise<string | null> {
    if (!status.changes.length || status.conflicts.length) return null;
    const result = await this.#request({ kind: "revision", status });
    if (result === null || (typeof result === "string" && /^[0-9a-f]{64}$/u.test(result)))
      return result;
    throw new GitWorkspaceError("远端提交内容指纹无效。");
  }

  async messageModels(): Promise<GitMessageModels> {
    try {
      return gitMessageModelsSchema.parse(await this.#request({ kind: "models" }));
    } catch {
      return { models: [], defaultModel: null };
    }
  }

  async generateMessage(input: {
    cwd: string;
    model: string;
    paths: readonly string[];
  }): Promise<GitGeneratedMessage> {
    try {
      return gitGeneratedMessageSchema.parse(
        await this.#request({
          kind: "generate",
          cwd: input.cwd,
          model: input.model,
          paths: input.paths,
        }),
      );
    } catch {
      throw new GitWorkspaceError("远端 SSH 主机生成提交消息失败，请检查其 Codex 配置后重试。");
    }
  }

  async #request(request: Request): Promise<unknown> {
    const source = await (this.options.workerSource ?? workerSource)();
    const payload = Buffer.from(JSON.stringify(request)).toString("base64");
    const stdout = await (this.options.execute ?? execute)({
      arguments: [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "SendEnv=-*",
        ...this.connection.arguments,
        `node --input-type=module - '${payload}'`,
      ],
      environment: this.environment,
      source,
    });
    return JSON.parse(stdout);
  }
}
