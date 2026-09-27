import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

type SpawnLauncher = (
  command: string,
  arguments_: string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdio: ["pipe", "ignore", "ignore"];
    windowsHide: true;
  },
) => ChildProcess;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const OPEN_TIMEOUT_MS = 10_000;

function createLauncherCommandOpener(
  environment: NodeJS.ProcessEnv,
  command: "open-loopback-url" | "open-doubao",
  operation: string,
  spawnLauncher: SpawnLauncher = (command, arguments_, options) =>
    spawn(command, arguments_, options),
): ((input?: string) => Promise<void>) | undefined {
  const launcher = environment.CODEXHOST_LAUNCHER_EXECUTABLE;
  if (!launcher || !path.isAbsolute(launcher)) return undefined;
  const launcherEnvironment = Object.fromEntries(
    Object.entries(environment).filter(([name]) => {
      const normalized = name.toUpperCase();
      return normalized !== "CODEX_CLI_PATH" && !normalized.startsWith("CODEXHOST_");
    }),
  );

  return (input) => {
    return new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawnLauncher(launcher, [command], {
          env: launcherEnvironment,
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true,
        });
      } catch {
        reject(new Error(`${operation} could not start`));
        return;
      }
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off("error", onError);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const onError = (): void => finish(new Error(`${operation} failed`));
      const onExit = (code: number | null): void =>
        finish(code === 0 ? undefined : new Error(`${operation} failed`));
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`${operation} timed out`));
      }, OPEN_TIMEOUT_MS);
      child.once("error", onError);
      child.once("exit", onExit);
      if (!child.stdin) {
        child.kill();
        finish(new Error(`${operation} failed`));
        return;
      }
      child.stdin.once("error", onError);
      child.stdin.end(input);
    });
  };
}

export function createLauncherUrlOpener(
  environment: NodeJS.ProcessEnv,
  spawnLauncher?: SpawnLauncher,
): ((url: URL) => Promise<void>) | undefined {
  const open = createLauncherCommandOpener(
    environment,
    "open-loopback-url",
    "codexhost native URL opener",
    spawnLauncher,
  );
  if (!open) return undefined;
  return (url) => {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
      url.port === "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.hash !== ""
    ) {
      return Promise.reject(new Error("Native URL handoff requires a loopback root URL"));
    }
    return open(url.href);
  };
}

export function createLauncherDoubaoOpener(
  environment: NodeJS.ProcessEnv,
  spawnLauncher?: SpawnLauncher,
): (() => Promise<void>) | undefined {
  if (environment.CODEXHOST_REMOTE_SSH_MANAGED === "1") return undefined;
  const open = createLauncherCommandOpener(
    environment,
    "open-doubao",
    "Doubao native opener",
    spawnLauncher,
  );
  return open ? () => open() : undefined;
}
