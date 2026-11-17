import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DesktopSshConnection } from "./desktop-ssh-connection.js";

const executeFile = promisify(execFile);

// 固定探测脚本：不接收 Renderer 参数，只报告远端 Codex 入口与配置目录。
// 以登录 shell 执行，因此能读到用户实际 PATH；找不到时输出空行，
// 由调用方报错而不是猜测路径。
const BEGIN_MARKER = "__codexhost_begin__";
const END_MARKER = "__codexhost_end__";

// 登录 shell 的启动脚本可能打印 banner 或环境信息，因此结果夹在固定标记之间，
// 标记之外的内容一律忽略。
const PROBE = `
codex="\${CODEXHOST_STOCK_CODEX_PATH:-}"
if [ -z "$codex" ]; then
  for candidate in codex codex-cli; do
    found=$(command -v "$candidate" 2>/dev/null || true)
    if [ -n "$found" ]; then codex=$found; break; fi
  done
fi
if [ -z "$codex" ]; then
  for candidate in "$HOME/.local/bin/codex" "$HOME/.npm-global/bin/codex" "$HOME/.bun/bin/codex" /opt/homebrew/bin/codex /usr/local/bin/codex; do
    if [ -x "$candidate" ]; then codex=$candidate; break; fi
  done
fi
home="\${CODEX_HOME:-\${HOME:+$HOME/.codex}}"
case "$codex" in /*) ;; *) codex="" ;; esac
case "$home" in /*) ;; *) home="" ;; esac
printf '%s\\n%s\\n%s\\n%s\\n' "${BEGIN_MARKER}" "$codex" "$home" "${END_MARKER}"
`;

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// 一次远端往返：有 bash 就用登录 shell 读取真实 PATH，没有则退回 POSIX sh。
// 只用一个命令，既省掉一次连接，也让“连不上”和“远端没有 Codex”能分开报告。
const COMMAND = `if command -v bash >/dev/null 2>&1; then bash -l -c ${quote(PROBE)}; else sh -c ${quote(PROBE)}; fi`;

type Execute = (input: {
  connection: DesktopSshConnection;
  environment: NodeJS.ProcessEnv;
  command: string;
}) => Promise<string>;

const execute: Execute = async (input) => {
  const result = await executeFile(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "SendEnv=-*",
      ...input.connection.arguments,
      // ssh 用空格拼接远端命令，必须整体作为一个已加引号的参数。
      input.command,
    ],
    {
      env: input.environment,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  );
  return result.stdout;
};

export interface SshCodexRuntime {
  codexPath: string;
  codexHome: string;
}

function absolutePath(value: string | undefined): string | null {
  return typeof value === "string" && value.startsWith("/") ? value : null;
}

const UNREACHABLE = "无法读取 SSH 主机上的 Codex 运行环境，请检查远端连接。";
const NO_COMMAND = "SSH 主机上未找到 Codex 命令行，请确认其在远端登录 shell 的 PATH 上。";

/** 远端 Codex 入口不可得时抛错；调用方不得猜测路径。 */
export async function resolveSshCodexRuntime(
  connection: DesktopSshConnection,
  environment: NodeJS.ProcessEnv,
  run: Execute = execute,
): Promise<SshCodexRuntime> {
  let stdout: string;
  try {
    stdout = await run({ connection, environment, command: COMMAND });
  } catch {
    throw new Error(UNREACHABLE);
  }
  const normalized = stdout.replace(/\r\n/gu, "\n").replace(/\r/gu, "");
  const start = normalized.indexOf(`${BEGIN_MARKER}\n`);
  const end = normalized.lastIndexOf(`${END_MARKER}`);
  if (start < 0 || end < start) throw new Error(UNREACHABLE);
  const [codexPath, codexHome] = normalized
    .slice(start + BEGIN_MARKER.length + 1, end)
    .split("\n")
    .slice(0, 2)
    .map(absolutePath);
  // 脚本已经跑通，两个空值代表远端环境本身缺少入口，不是连接问题。
  if (!codexPath) throw new Error(NO_COMMAND);
  if (!codexHome)
    throw new Error("无法确认 SSH 主机上的 CODEX_HOME，请在远端设置 HOME 或 CODEX_HOME。");
  return { codexPath, codexHome };
}

/**
 * `open-target` 已经给出可靠入口时直接沿用；缺任一项才在远端探测一次，
 * 不为另一半混用两个来源。原生 SSH 服务没有该 RPC，因此总是走探测。
 */
export async function sshThreadCodexRuntime(
  remote: { readonly codexPath?: string | undefined; readonly codexHome?: string | undefined },
  connection: DesktopSshConnection | null,
  environment: NodeJS.ProcessEnv,
  run: Execute = execute,
): Promise<SshCodexRuntime> {
  if (remote.codexPath && remote.codexHome) {
    return { codexPath: remote.codexPath, codexHome: remote.codexHome };
  }
  if (!connection) throw new Error(UNREACHABLE);
  return resolveSshCodexRuntime(connection, environment, run);
}
