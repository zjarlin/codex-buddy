import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";

export type ThreadTerminalKind = "terminal" | "windows-terminal" | "x-terminal-emulator";

export interface ThreadTerminalOpenResult {
  workspace: string;
  terminal: ThreadTerminalKind;
  mode: "resume";
}

export class ThreadTerminalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThreadTerminalError";
  }
}

type SpawnTerminal = (
  command: string,
  arguments_: readonly string[],
  options: { detached: boolean; stdio: "ignore"; windowsHide: boolean },
) => { once(event: "error", listener: (error: Error) => void): void; unref(): void };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function appleScriptQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function threadTerminalResumeCommand(
  codexPath: string,
  sessionId: string,
  cwd: string,
): string {
  return `${shellQuote(codexPath)} resume ${shellQuote(sessionId)} -C ${shellQuote(cwd)}`;
}

function platformInvocation(
  cwd: string,
  codexPath: string,
  sessionId: string,
  platform: NodeJS.Platform,
): {
  command: string;
  arguments_: string[];
  terminal: ThreadTerminalKind;
} {
  if (platform === "darwin") {
    const command = `cd ${shellQuote(cwd)} && ${threadTerminalResumeCommand(codexPath, sessionId, cwd)}`;
    const script = [
      'tell application "Terminal"',
      "activate",
      `do script ${appleScriptQuote(command)}`,
      "end tell",
    ].join("\n");
    return { command: "/usr/bin/osascript", arguments_: ["-e", script], terminal: "terminal" };
  }
  if (platform === "win32") {
    const command = `& ${JSON.stringify(codexPath)} resume ${JSON.stringify(sessionId)} -C ${JSON.stringify(cwd)}`;
    return {
      command: process.env.ComSpec || "cmd.exe",
      arguments_: [
        "/d",
        "/s",
        "/c",
        "start",
        "",
        "wt.exe",
        "-d",
        cwd,
        "powershell.exe",
        "-NoExit",
        "-Command",
        command,
      ],
      terminal: "windows-terminal",
    };
  }
  return {
    command: "x-terminal-emulator",
    arguments_: [
      "--working-directory",
      cwd,
      "-e",
      "sh",
      "-lc",
      threadTerminalResumeCommand(codexPath, sessionId, cwd),
    ],
    terminal: "x-terminal-emulator",
  };
}

export async function openThreadTerminal(
  cwd: string,
  sessionId: string,
  codexPath: string,
  options: { platform?: NodeJS.Platform; spawnTerminal?: SpawnTerminal } = {},
): Promise<ThreadTerminalOpenResult> {
  if (!/^[A-Za-z0-9._:-]+$/.test(sessionId)) throw new ThreadTerminalError("会话 ID 无效。");
  if (!codexPath.trim() || codexPath.includes("\0"))
    throw new ThreadTerminalError("Codex 路径无效。");
  let workspace: string;
  try {
    workspace = await realpath(cwd);
  } catch (error) {
    throw new ThreadTerminalError("会话工作区路径不可用。", { cause: error });
  }
  let information;
  try {
    information = await stat(workspace);
  } catch (error) {
    throw new ThreadTerminalError("会话工作区路径不可用。", { cause: error });
  }
  if (!information.isDirectory()) {
    throw new ThreadTerminalError("会话工作区不是目录。");
  }

  const invocation = platformInvocation(
    workspace,
    codexPath,
    sessionId,
    options.platform ?? process.platform,
  );
  const spawnTerminal: SpawnTerminal =
    options.spawnTerminal ??
    ((command, arguments_, spawnOptions) => spawn(command, arguments_, spawnOptions));
  await new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawnTerminal(invocation.command, invocation.arguments_, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      reject(new ThreadTerminalError("无法打开系统终端。", { cause: error }));
      return;
    }
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.once("error", (error) =>
      finish(new ThreadTerminalError("无法打开系统终端。", { cause: error })),
    );
    try {
      child.unref();
      finish();
    } catch (error) {
      finish(new ThreadTerminalError("无法打开系统终端。", { cause: error }));
    }
  });
  return { workspace, terminal: invocation.terminal, mode: "resume" };
}
