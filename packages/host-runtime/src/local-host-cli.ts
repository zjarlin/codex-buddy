import { rm } from "node:fs/promises";
import net from "node:net";
import type { Writable } from "node:stream";

import {
  disableLocalHost,
  enableLocalHost,
  localHostEnabled,
  localHostPaths,
  probeLocalHost,
  readLocalHostListenerState,
  type LocalHostPaths,
} from "./local-host-state.js";

const STOP_TIMEOUT_MS = 5_000;

function outputJson(output: Writable, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function listenerAlive(paths: LocalHostPaths): Promise<boolean> {
  return new Promise((resolve) => {
    const connection = net.createConnection(paths.socketPath);
    const finish = (alive: boolean): void => {
      connection.destroy();
      resolve(alive);
    };
    connection.once("connect", () => finish(true));
    connection.once("error", () => finish(false));
  });
}

async function waitForStop(paths: LocalHostPaths): Promise<boolean> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await listenerAlive(paths))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !(await listenerAlive(paths));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processAlive(pid);
}

async function stopListener(paths: LocalHostPaths): Promise<"stopped" | "not-running"> {
  const state = await readLocalHostListenerState(paths);
  if (!state.pid) {
    if (!(await listenerAlive(paths))) return "not-running";
    throw new Error(`Local Host socket exists without a listener PID: ${paths.socketPath}`);
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    await rm(paths.pidPath, { force: true });
    await rm(paths.runtimePath, { force: true });
    await rm(paths.runtimeIdentityPath, { force: true });
    return "not-running";
  }
  if (await waitForStop(paths)) {
    await Promise.all([
      rm(paths.pidPath, { force: true }),
      rm(paths.runtimePath, { force: true }),
      rm(paths.runtimeIdentityPath, { force: true }),
    ]);
    return "stopped";
  }
  try {
    process.kill(state.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  if ((await waitForStop(paths)) && (await waitForProcessExit(state.pid))) {
    await Promise.all([
      rm(paths.pidPath, { force: true }),
      rm(paths.runtimePath, { force: true }),
      rm(paths.runtimeIdentityPath, { force: true }),
    ]);
    return "stopped";
  }
  throw new Error(`Local Host listener did not stop: ${paths.socketPath}`);
}

export function localHostCliHelp(): string {
  return [
    "usage:",
    "  codexhost local-host enable",
    "  codexhost local-host disable",
    "  codexhost local-host status",
    "  codexhost local-host stop",
    "",
    "Keeps the local codexhost Host running independently of Codex Desktop.",
    "Restart Codex Desktop after enabling so local projects connect through it.",
  ].join("\n");
}

export async function runLocalHostCli(input: {
  arguments: string[];
  environment?: NodeJS.ProcessEnv;
  output?: Writable;
  diagnosticOutput?: Writable;
}): Promise<number> {
  const output = input.output ?? process.stdout;
  const diagnosticOutput = input.diagnosticOutput ?? process.stderr;
  const environment = input.environment ?? process.env;
  const command = input.arguments[0];
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      output.write(`${localHostCliHelp()}\n`);
      return 0;
    }
    if (
      command !== "enable" &&
      command !== "disable" &&
      command !== "status" &&
      command !== "stop"
    ) {
      throw new Error(`Unknown local-host command '${command}'`);
    }
    if (process.platform === "win32") {
      throw new Error("The persistent local Host is available on macOS and Linux only");
    }
    const paths = localHostPaths(environment);
    if (command === "enable") {
      await enableLocalHost(paths);
      outputJson(output, {
        state: "enabled",
        socketPath: paths.socketPath,
        restartRequired: true,
      });
      return 0;
    }
    if (command === "disable") {
      await disableLocalHost(paths);
      const probe = await probeLocalHost(paths);
      const stopped = probe.state === "running" ? await stopListener(paths) : "not-running";
      outputJson(output, {
        state: "disabled",
        socketPath: paths.socketPath,
        runtime: probe.state === "running" ? "stopped" : probe.state,
        stopped: stopped === "stopped",
      });
      return 0;
    }
    if (command === "stop") {
      const state = await stopListener(paths);
      outputJson(output, { state, socketPath: paths.socketPath });
      return 0;
    }
    const enabled = await localHostEnabled(paths);
    const listener = await readLocalHostListenerState(paths);
    const probe = await probeLocalHost(paths);
    outputJson(output, {
      state: probe.state === "running" ? "running" : enabled ? "enabled" : "disabled",
      enabled,
      socketPath: paths.socketPath,
      pid: listener.pid,
      runtimePath: listener.runtimePath,
      runtimeIdentity: listener.runtimeIdentity,
      runtime: probe.state,
      ...(probe.message ? { message: probe.message } : {}),
    });
    return probe.state === "unknown" ? 1 : 0;
  } catch (error) {
    diagnosticOutput.write(
      `codexhost local-host: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
