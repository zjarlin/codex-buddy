import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { ThreadWorkspaceOpenResult } from "@codexhost/shared-contracts";

export class ThreadWorkspaceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThreadWorkspaceError";
  }
}

type SpawnWorkspaceApplication = (
  command: string,
  arguments_: readonly string[],
  options: { detached: boolean; stdio: "ignore"; windowsHide: boolean },
) => { once(event: "error", listener: (error: Error) => void): void; unref(): void };

async function executable(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const directories = (environment.PATH ?? "").split(platform === "win32" ? ";" : ":");
  const suffixes = platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const directory of directories) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      const candidate = pathApi.join(directory, `${command}${suffix}`);
      if (await executable(candidate, platform)) return candidate;
    }
  }
  return null;
}

async function macApplication(
  bundleName: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  const roots = [
    "/Applications",
    environment.HOME ? path.join(environment.HOME, "Applications") : "",
  ];
  for (const root of roots) {
    if (!root) continue;
    const application = path.join(root, `${bundleName}.app`);
    try {
      if ((await stat(application)).isDirectory()) return application;
    } catch {
      // Try the next standard application directory.
    }
  }
  return null;
}

async function windowsApplication(
  relativePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  const candidate = windowsApplicationPath(relativePath, environment);
  if (!candidate) return null;
  try {
    if ((await stat(candidate)).isFile()) return candidate;
  } catch {
    // Try the next standard installation directory.
  }
  return null;
}

export function windowsApplicationPath(
  relativePath: string,
  environment: NodeJS.ProcessEnv,
): string | null {
  const roots = [
    environment.LOCALAPPDATA,
    environment.ProgramFiles,
    environment["ProgramFiles(x86)"],
  ];
  for (const root of roots) {
    if (!root) continue;
    return path.win32.join(root, relativePath);
  }
  return null;
}

async function windowsCode(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const executablePath = await pathExecutable("code", environment, platform);
  if (!executablePath || !executablePath.toLowerCase().endsWith(".cmd")) return executablePath;
  const nativeExecutable = path.win32.join(path.win32.dirname(executablePath), "..", "Code.exe");
  try {
    if ((await stat(nativeExecutable)).isFile()) return nativeExecutable;
  } catch {
    // The PATH entry may be a wrapper without a sibling Code.exe.
  }
  return executablePath;
}

async function vscodeInvocation(
  workspace: string,
  options: { platform: NodeJS.Platform; environment: NodeJS.ProcessEnv },
): Promise<{ command: string; arguments_: string[] }> {
  const code =
    options.platform === "win32"
      ? await windowsCode(options.environment, options.platform)
      : await pathExecutable("code", options.environment, options.platform);
  if (code) return { command: code, arguments_: ["--reuse-window", workspace] };

  if (options.platform === "darwin") {
    const application = await macApplication("Visual Studio Code", options.environment);
    if (application)
      return { command: "/usr/bin/open", arguments_: ["-a", application, workspace] };
  }
  if (options.platform === "win32") {
    const application = await windowsApplication(
      "Programs\\Microsoft VS Code\\Code.exe",
      options.environment,
    );
    if (application) return { command: application, arguments_: ["--reuse-window", workspace] };
  }
  throw new ThreadWorkspaceError("未安装 Visual Studio Code。");
}

export async function openThreadWorkspace(
  cwd: string,
  options: {
    platform?: NodeJS.Platform;
    spawnApplication?: SpawnWorkspaceApplication;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<ThreadWorkspaceOpenResult> {
  let workspace: string;
  try {
    workspace = await realpath(cwd);
  } catch (error) {
    throw new ThreadWorkspaceError("会话工作区路径不可用。", { cause: error });
  }
  let information;
  try {
    information = await stat(workspace);
  } catch (error) {
    throw new ThreadWorkspaceError("会话工作区路径不可用。", { cause: error });
  }
  if (!information.isDirectory()) throw new ThreadWorkspaceError("会话工作区不是目录。");

  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const invocation = await vscodeInvocation(workspace, { platform, environment });
  const spawnApplication: SpawnWorkspaceApplication =
    options.spawnApplication ??
    ((command, arguments_, spawnOptions) => spawn(command, arguments_, spawnOptions));

  await new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawnApplication(invocation.command, invocation.arguments_, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      reject(new ThreadWorkspaceError("无法打开 Visual Studio Code。", { cause: error }));
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
      finish(new ThreadWorkspaceError("无法打开 Visual Studio Code。", { cause: error })),
    );
    try {
      child.unref();
      finish();
    } catch (error) {
      finish(new ThreadWorkspaceError("无法打开 Visual Studio Code。", { cause: error }));
    }
  });

  return { workspace, application: "vscode" };
}
