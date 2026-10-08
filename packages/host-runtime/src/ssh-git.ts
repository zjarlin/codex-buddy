import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { desktopSshConnection, type DesktopSshConnection } from "./desktop-ssh-connection.js";
import { GitRepositoryLinks } from "./git-repository-links.js";
import { SshGitMessageService } from "./ssh-git-message.js";
import {
  GitWorkspace,
  GitWorkspaceError,
  type GitCommandResult,
  type GitWorkspaceRuntime,
} from "./git-workspace.js";
import type { GitGeneratedMessage, GitMessageModels } from "@codexhost/shared-contracts";

const execFileAsync = promisify(execFile);
type Execute = (
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
) => Promise<GitCommandResult>;

function quote(value: string): string {
  if (value.includes("\0")) throw new GitWorkspaceError("SSH Git 参数不能包含空字符。");
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const executeSsh: Execute = async (arguments_, environment) => {
  try {
    const result = await execFileAsync("ssh", [...arguments_], {
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new GitWorkspaceError(
      `SSH Git：${(failure.stderr || failure.message).trim().slice(0, 20_000)}`,
      failure.stdout ?? "",
      failure.stderr ?? "",
      { cause: error },
    );
  }
};

// Git、路径解析和文件读取全部在工作区所在的 SSH 主机执行，不读取本机同名路径。
export function createSshGitRuntime(
  connection: DesktopSshConnection,
  environment: NodeJS.ProcessEnv,
  execute: Execute = executeSsh,
): GitWorkspaceRuntime {
  const run = (arguments_: readonly string[]) =>
    execute(
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        ...connection.arguments,
        arguments_.map(quote).join(" "),
      ],
      environment,
    );
  const shell = (script: string, target: string) =>
    run(["sh", "-c", script, "codexhost-git", target]);
  return {
    paths: path.posix,
    nullDevice: "/dev/null",
    run: (cwd, arguments_) =>
      run(["env", "LC_ALL=C", "GIT_TERMINAL_PROMPT=0", "git", "-C", cwd, ...arguments_]),
    async realpath(directory) {
      const result = await shell('cd -- "$1" && pwd -P', directory);
      // pwd 只移除自身的结尾换行，保留目录名内的空白。
      return result.stdout.replace(/\r?\n$/u, "");
    },
    async listDirectories(directory) {
      const result = await shell(
        'for path in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -d "$path" ] || continue; name=${path##*/}; [ "$name" = . ] || [ "$name" = .. ] || printf "%s\\n" "$name"; done',
        directory,
      );
      return result.stdout.split(/\r?\n/u).filter(Boolean);
    },
    async exists(target) {
      const result = await shell('if [ -e "$1" ]; then printf yes; fi', target);
      return result.stdout === "yes";
    },
    files: {
      async stat(target) {
        const result = await shell(
          'if [ -d "$1" ]; then printf directory; elif [ -f "$1" ]; then wc -c < "$1"; elif [ ! -e "$1" ]; then printf missing; else exit 1; fi',
          target,
        );
        if (result.stdout === "missing") {
          throw Object.assign(new Error("远程文件不存在。"), { code: "ENOENT" });
        }
        const directory = result.stdout === "directory";
        const size = directory ? 0 : Number(result.stdout.trim());
        if (!Number.isSafeInteger(size) || size < 0)
          throw new GitWorkspaceError("远程文件大小无效。");
        return { size, isDirectory: () => directory };
      },
      async readFile(target) {
        const result = await shell('base64 < "$1"', target);
        return Buffer.from(result.stdout, "base64");
      },
    },
  };
}

export interface GitWorkspaceServices {
  git: GitWorkspace;
  links: GitRepositoryLinks;
}

export interface SshGitWorkspaceServices extends GitWorkspaceServices {
  messageModels(): Promise<GitMessageModels>;
  generateMessage(input: {
    cwd: string;
    model: string;
    paths: readonly string[];
  }): Promise<GitGeneratedMessage>;
}

// 同一 SSH 配置复用操作锁，连接配置变化后重新创建；关联记录按设备隔离。
export class SshGitWorkspaces {
  readonly #hosts = new Map<string, SshGitWorkspaceServices & { key: string }>();
  constructor(
    private readonly home: string,
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async forHost(hostId: string): Promise<SshGitWorkspaceServices> {
    const connection = await desktopSshConnection(hostId, this.environment);
    const key = createHash("sha256")
      .update(JSON.stringify([hostId, connection.arguments]))
      .digest("hex");
    const cached = this.#hosts.get(hostId);
    if (cached?.key === key) return cached;
    const runtime = createSshGitRuntime(connection, this.environment);
    const messages = new SshGitMessageService(connection, this.environment);
    runtime.messageRevision = (status) => messages.messageRevision(status);
    const git = new GitWorkspace(this.environment, runtime);
    const links = new GitRepositoryLinks(
      path.join(this.home, "ssh-git", key),
      (cwd) => git.root(cwd),
      (cwd, submodule) => git.submoduleRoot(cwd, submodule),
      { paths: runtime.paths, realpath: runtime.realpath },
    );
    const services = {
      git,
      links,
      key,
      messageModels: () => messages.messageModels(),
      generateMessage: (input: { cwd: string; model: string; paths: readonly string[] }) =>
        messages.generateMessage(input),
    };
    this.#hosts.set(hostId, services);
    return services;
  }
}
