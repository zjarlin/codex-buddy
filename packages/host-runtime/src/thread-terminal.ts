import { spawn } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
  ThreadTerminalDescriptor,
  ThreadTerminalId,
  ThreadTerminalListResult,
} from "@codexhost/shared-contracts";

export interface ThreadTerminalOpenResult {
  workspace: string;
  terminal: ThreadTerminalId;
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

interface TerminalContext {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

interface TerminalInvocation {
  command: string;
  arguments_: string[];
  terminal: ThreadTerminalId;
}

interface TerminalCandidate {
  id: ThreadTerminalId;
  name: string;
  default?: boolean;
  resolve(context: TerminalContext): Promise<ResolvedTerminal | null>;
}

type WindowsTerminalId = Exclude<
  ThreadTerminalId,
  | "system-default"
  | "apple-terminal"
  | "iterm2"
  | "ghostty"
  | "warp"
  | "wezterm"
  | "alacritty"
  | "kitty"
  | "hyper"
  | "tabby"
  | "x-terminal-emulator"
>;

interface ResolvedTerminal {
  path: string;
  kind: "executable" | "application";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function appleScriptQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function executable(candidate: string | undefined): Promise<string | null> {
  if (!candidate) return null;
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function pathExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<ResolvedTerminal | null> {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const suffix = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
    for (const extension of suffix) {
      const found = await executable(pathApi.join(directory, `${command}${extension}`));
      if (found) return { path: found, kind: "executable" };
    }
  }
  return null;
}

async function macApplication(
  bundleName: string,
  environment: NodeJS.ProcessEnv,
): Promise<ResolvedTerminal | null> {
  const roots = [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
    "/Applications/Utilities",
    environment.HOME ? path.join(environment.HOME, "Applications") : "",
  ];
  for (const root of roots) {
    if (!root) continue;
    const app = path.join(root, `${bundleName}.app`);
    try {
      if ((await stat(app)).isDirectory()) return { path: app, kind: "application" };
    } catch {
      // Try the next standard application directory.
    }
  }
  return null;
}

async function windowsApplication(
  relativePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<ResolvedTerminal | null> {
  const pathApi = path.win32;
  const roots = [
    environment.LOCALAPPDATA,
    environment.ProgramFiles,
    environment["ProgramFiles(x86)"],
    environment.USERPROFILE ? path.join(environment.USERPROFILE, "AppData", "Local") : "",
    environment.USERPROFILE ? path.join(environment.USERPROFILE, "scoop", "apps") : "",
  ];
  for (const root of roots) {
    if (!root) continue;
    const found = await executable(pathApi.join(root, relativePath));
    if (found) return { path: found, kind: "executable" };
  }
  return null;
}

export function threadTerminalResumeCommand(
  codexPath: string,
  sessionId: string,
  cwd: string,
  shell: "posix" | "powershell" = "posix",
): string {
  if (shell === "powershell") {
    return `& ${powerShellQuote(codexPath)} resume ${powerShellQuote(sessionId)} -C ${powerShellQuote(cwd)}`;
  }
  return `${shellQuote(codexPath)} resume ${shellQuote(sessionId)} -C ${shellQuote(cwd)}`;
}

const MAC_TERMINALS: TerminalCandidate[] = [
  {
    id: "apple-terminal",
    name: "Terminal",
    default: true,
    resolve: () => macApplication("Terminal", process.env),
  },
  { id: "iterm2", name: "iTerm2", resolve: () => macApplication("iTerm", process.env) },
  { id: "ghostty", name: "Ghostty", resolve: () => macApplication("Ghostty", process.env) },
  { id: "warp", name: "Warp", resolve: () => macApplication("Warp", process.env) },
  { id: "wezterm", name: "WezTerm", resolve: () => macApplication("WezTerm", process.env) },
  { id: "alacritty", name: "Alacritty", resolve: () => macApplication("Alacritty", process.env) },
  { id: "kitty", name: "kitty", resolve: () => macApplication("kitty", process.env) },
  { id: "hyper", name: "Hyper", resolve: () => macApplication("Hyper", process.env) },
  { id: "tabby", name: "Tabby", resolve: () => macApplication("Tabby", process.env) },
];

const WINDOWS_TERMINALS: (TerminalCandidate & { id: WindowsTerminalId })[] = [
  {
    id: "windows-terminal",
    name: "Windows Terminal",
    default: true,
    resolve: (context) => pathExecutable("wt.exe", context.environment, context.platform),
  },
  {
    id: "powershell",
    name: "PowerShell",
    resolve: async (context) =>
      (await pathExecutable("pwsh.exe", context.environment, context.platform)) ??
      pathExecutable("powershell.exe", context.environment, context.platform),
  },
  {
    id: "command-prompt",
    name: "Command Prompt",
    resolve: (context) => pathExecutable("cmd.exe", context.environment, context.platform),
  },
  {
    id: "git-bash",
    name: "Git Bash",
    resolve: async (context) =>
      (await windowsApplication("Programs\\Git\\bin\\bash.exe", context.environment)) ??
      (await windowsApplication("Git\\bin\\bash.exe", context.environment)) ??
      pathExecutable("bash.exe", context.environment, context.platform),
  },
  {
    id: "nushell",
    name: "Nushell",
    resolve: (context) => pathExecutable("nu.exe", context.environment, context.platform),
  },
];

async function terminalDescriptors(platform: NodeJS.Platform): Promise<ThreadTerminalDescriptor[]> {
  const context = { platform, environment: process.env };
  const candidates =
    platform === "darwin" ? MAC_TERMINALS : platform === "win32" ? WINDOWS_TERMINALS : [];
  if (candidates.length === 0) {
    return [{ id: "x-terminal-emulator", name: "System Terminal", installed: true, default: true }];
  }
  return Promise.all(
    candidates.map(async (candidate) => ({
      id: candidate.id,
      name: candidate.name,
      installed: (await candidate.resolve(context)) !== null,
      default: candidate.default === true,
    })),
  );
}

export async function listThreadTerminals(
  options: { platform?: NodeJS.Platform } = {},
): Promise<ThreadTerminalListResult> {
  const platform = options.platform ?? process.platform;
  const terminals = await terminalDescriptors(platform);
  const defaultTerminal =
    terminals.find((terminal) => terminal.default && terminal.installed)?.id ??
    terminals.find((terminal) => terminal.installed)?.id ??
    terminals[0]?.id;
  return {
    terminals: terminals.map((terminal) => ({
      ...terminal,
      default: terminal.id === defaultTerminal,
    })),
  };
}

async function macInvocation(
  terminal: ThreadTerminalId,
  cwd: string,
  codexPath: string,
  sessionId: string,
  environment: NodeJS.ProcessEnv,
): Promise<TerminalInvocation> {
  const command = `cd ${shellQuote(cwd)} && ${threadTerminalResumeCommand(codexPath, sessionId, cwd)}`;
  if (terminal === "system-default") {
    terminal = "apple-terminal";
  }
  const candidate = MAC_TERMINALS.find((entry) => entry.id === terminal);
  if (!candidate) throw new ThreadTerminalError("当前系统不支持该终端。");
  const resolved = await candidate.resolve({ platform: "darwin", environment });
  if (!resolved) throw new ThreadTerminalError(`未找到 ${candidate.name}。`);
  const app = resolved.path;
  if (terminal === "apple-terminal") {
    const script = [
      'tell application "Terminal"',
      "activate",
      `do script ${appleScriptQuote(command)}`,
      "end tell",
    ].join("\n");
    return { command: "/usr/bin/osascript", arguments_: ["-e", script], terminal };
  }
  if (terminal === "iterm2") {
    const script = [
      'tell application "iTerm"',
      "activate",
      "create window with default profile",
      `tell current session of current window to write text ${appleScriptQuote(command)}`,
      "end tell",
    ].join("\n");
    return { command: "/usr/bin/osascript", arguments_: ["-e", script], terminal };
  }
  if (terminal === "ghostty") {
    return {
      command: "/usr/bin/open",
      arguments_: ["-na", app, "--args", "-e", "sh", "-lc", command],
      terminal,
    };
  }
  if (terminal === "wezterm") {
    return {
      command: `${app}/Contents/MacOS/wezterm`,
      arguments_: ["start", "--cwd", cwd, "--", "sh", "-lc", command],
      terminal,
    };
  }
  if (terminal === "kitty") {
    return {
      command: `${app}/Contents/MacOS/kitty`,
      arguments_: ["--directory", cwd, "sh", "-lc", command],
      terminal,
    };
  }
  if (terminal === "alacritty") {
    return {
      command: `${app}/Contents/MacOS/alacritty`,
      arguments_: ["--working-directory", cwd, "-e", "sh", "-lc", command],
      terminal,
    };
  }
  return {
    command: "/usr/bin/open",
    arguments_: ["-a", app, "--args", "-e", "sh", "-lc", command],
    terminal,
  };
}

async function windowsInvocation(
  terminal: ThreadTerminalId,
  cwd: string,
  codexPath: string,
  sessionId: string,
  environment: NodeJS.ProcessEnv,
): Promise<TerminalInvocation> {
  const candidates = WINDOWS_TERMINALS;
  const selected =
    terminal === "system-default"
      ? candidates[0]
      : candidates.find((entry) => entry.id === terminal);
  if (!selected) throw new ThreadTerminalError("当前系统不支持该终端。");
  const resolved = await selected.resolve({ platform: "win32", environment });
  if (!resolved) throw new ThreadTerminalError(`未找到 ${selected.name}。`);
  return windowsTerminalInvocation(selected.id, resolved.path, cwd, codexPath, sessionId);
}

export function windowsTerminalInvocation(
  terminal: WindowsTerminalId,
  executablePath: string,
  cwd: string,
  codexPath: string,
  sessionId: string,
): TerminalInvocation {
  const command = `& ${powerShellQuote(codexPath)} resume ${powerShellQuote(sessionId)} -C ${powerShellQuote(cwd)}`;
  if (terminal === "windows-terminal") {
    return {
      command: executablePath,
      arguments_: ["-d", cwd, "powershell.exe", "-NoExit", "-Command", command],
      terminal,
    };
  }
  if (terminal === "git-bash") {
    return {
      command: executablePath,
      arguments_: [
        "--login",
        "-c",
        `cd ${shellQuote(cwd)} && ${threadTerminalResumeCommand(codexPath, sessionId, cwd)}`,
      ],
      terminal,
    };
  }
  if (terminal === "command-prompt") {
    return {
      command: executablePath,
      arguments_: ["/d", "/k", `cd /d "${cwd}" && "${codexPath}" resume ${sessionId} -C "${cwd}"`],
      terminal,
    };
  }
  return {
    command: executablePath,
    arguments_: [
      "-NoExit",
      "-Command",
      `Set-Location -LiteralPath ${powerShellQuote(cwd)}; ${command}`,
    ],
    terminal,
  };
}

export async function openThreadTerminal(
  cwd: string,
  sessionId: string,
  codexPath: string,
  terminalId: ThreadTerminalId = "system-default",
  options: {
    platform?: NodeJS.Platform;
    spawnTerminal?: SpawnTerminal;
    environment?: NodeJS.ProcessEnv;
  } = {},
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
  if (!information.isDirectory()) throw new ThreadTerminalError("会话工作区不是目录。");

  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const invocation =
    platform === "darwin"
      ? await macInvocation(terminalId, workspace, codexPath, sessionId, environment)
      : platform === "win32"
        ? await windowsInvocation(terminalId, workspace, codexPath, sessionId, environment)
        : {
            command: "x-terminal-emulator",
            arguments_: [
              "--working-directory",
              workspace,
              "-e",
              "sh",
              "-lc",
              threadTerminalResumeCommand(codexPath, sessionId, workspace),
            ],
            terminal: "x-terminal-emulator" as const,
          };
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
