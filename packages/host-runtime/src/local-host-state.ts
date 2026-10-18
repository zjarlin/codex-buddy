import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";

import WebSocket from "ws";

export const LOCAL_HOST_DIRECTORY = "local-host-runtime-v1";
export const LOCAL_HOST_ENABLED_FILE = "enabled";
export const LOCAL_HOST_SOCKET_FILE = "app-server.sock";
export const LOCAL_HOST_PID_FILE = "listener.pid";
export const LOCAL_HOST_RUNTIME_FILE = "runtime-path";

const PROBE_TIMEOUT_MS = 3_000;

export interface LocalHostPaths {
  dataDirectory: string;
  directory: string;
  markerPath: string;
  socketPath: string;
  pidPath: string;
  runtimePath: string;
}

export interface LocalHostListenerState {
  pid: number | null;
  runtimePath: string | null;
}

export interface LocalHostProbe {
  state: "running" | "stopped" | "unknown";
  socketPath: string;
  message?: string;
}

function dataDirectoryFor(environment: NodeJS.ProcessEnv): string {
  const configured = environment.CODEXHOST_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(environment.HOME?.trim() || homedir(), ".codexhost");
}

export function localHostPaths(environment: NodeJS.ProcessEnv): LocalHostPaths {
  const dataDirectory = dataDirectoryFor(environment);
  const directory = path.join(dataDirectory, LOCAL_HOST_DIRECTORY);
  return {
    dataDirectory,
    directory,
    markerPath: path.join(directory, LOCAL_HOST_ENABLED_FILE),
    socketPath: path.join(directory, LOCAL_HOST_SOCKET_FILE),
    pidPath: path.join(directory, LOCAL_HOST_PID_FILE),
    runtimePath: path.join(directory, LOCAL_HOST_RUNTIME_FILE),
  };
}

async function regularFile(filePath: string): Promise<boolean> {
  const metadata = await stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return metadata?.isFile() === true;
}

export async function localHostEnabled(paths: LocalHostPaths): Promise<boolean> {
  return regularFile(paths.markerPath);
}

export async function enableLocalHost(paths: LocalHostPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(paths.markerPath, `${JSON.stringify({ schemaVersion: 1, persistent: true })}\n`, {
    mode: 0o600,
  });
}

export async function disableLocalHost(paths: LocalHostPaths): Promise<void> {
  await rm(paths.markerPath, { force: true });
}

export async function readLocalHostListenerState(
  paths: LocalHostPaths,
): Promise<LocalHostListenerState> {
  const pidText = await readFile(paths.pidPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const runtimePath = await readFile(paths.runtimePath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  const pid = pidText === null ? null : Number.parseInt(pidText.trim(), 10);
  return {
    pid: pid !== null && Number.isSafeInteger(pid) && pid > 0 ? pid : null,
    runtimePath: runtimePath?.trim() || null,
  };
}

export async function writeLocalHostListenerState(
  paths: LocalHostPaths,
  runtimePath: string,
): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(paths.pidPath, `${process.pid}\n`, { mode: 0o600 });
  await writeFile(paths.runtimePath, `${runtimePath}\n`, { mode: 0o600 });
}

export async function clearLocalHostListenerState(paths: LocalHostPaths): Promise<void> {
  const state = await readLocalHostListenerState(paths).catch(() => null);
  if (state?.pid !== process.pid) return;
  await Promise.all([rm(paths.pidPath, { force: true }), rm(paths.runtimePath, { force: true })]);
}

function probeSocket(socketPath: string): Promise<LocalHostProbe> {
  const socket = new WebSocket("ws://localhost/", {
    createConnection: () => net.createConnection(socketPath),
  });
  return new Promise<LocalHostProbe>((resolve) => {
    let settled = false;
    const finish = (result: LocalHostProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(
      () =>
        finish({
          state: "unknown",
          socketPath,
          message: "Local Host probe timed out",
        }),
      PROBE_TIMEOUT_MS,
    );
    socket.once("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "codexhost/update/status", params: {} }));
    });
    socket.once("message", (data, isBinary) => {
      if (isBinary) {
        finish({ state: "unknown", socketPath, message: "Binary response" });
        return;
      }
      try {
        const response = JSON.parse(data.toString("utf8")) as {
          id?: unknown;
          result?: unknown;
          error?: { code?: unknown; message?: unknown };
        };
        if (response.id !== 1) return;
        const message = typeof response.error?.message === "string" ? response.error.message : "";
        if (message.includes("unknown variant `codexhost/update/status`")) {
          finish({
            state: "unknown",
            socketPath,
            message: "Socket belongs to a different app-server",
          });
        } else if (response.result !== undefined || response.error?.code === -32090) {
          finish({ state: "running", socketPath });
        }
      } catch (error) {
        finish({
          state: "unknown",
          socketPath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    socket.once("error", (error) => {
      const notRunning = error.message.includes("ECONNREFUSED") || error.message.includes("ENOENT");
      finish({
        state: notRunning ? "stopped" : "unknown",
        socketPath,
        message: error.message,
      });
    });
  }).finally(() => {
    if (socket.readyState === WebSocket.OPEN) socket.close();
    else socket.terminate();
  });
}

export async function probeLocalHost(paths: LocalHostPaths): Promise<LocalHostProbe> {
  if (!(await stat(paths.socketPath).catch(() => null))?.isSocket()) {
    return { state: "stopped", socketPath: paths.socketPath };
  }
  return probeSocket(paths.socketPath);
}
