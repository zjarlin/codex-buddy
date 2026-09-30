import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  remoteProjectsInspectParamsSchema,
  remoteProjectsSnapshotSchema,
  remoteProjectsSyncParamsSchema,
  type RemoteProjectsSnapshot,
} from "@codexhost/shared-contracts";

import { desktopSshConnection } from "./desktop-ssh-connection.js";

declare const __CODEXHOST_SSH_REMOTE_PROJECTS_WORKER__: string;

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
      signal: AbortSignal.timeout(45_000),
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        child.kill();
        reject(new Error("Shared project response is too large"));
        return;
      }
      chunks.push(chunk);
    });
    child.once("close", (code) => {
      if (code !== 0) reject(new Error("Shared project query failed on SSH Host"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(input.source);
  });

function workerSource(): Promise<string> {
  if (typeof __CODEXHOST_SSH_REMOTE_PROJECTS_WORKER__ === "string") {
    return Promise.resolve(__CODEXHOST_SSH_REMOTE_PROJECTS_WORKER__);
  }
  return readFile(new URL("./ssh-remote-projects-worker.bundle.mjs", import.meta.url), "utf8");
}

async function runRemote(input: {
  params: unknown;
  action: "inspect" | "sync";
  environment: NodeJS.ProcessEnv;
  execute?: Execute;
  source?: () => Promise<string>;
}): Promise<RemoteProjectsSnapshot> {
  try {
    const parsed =
      input.action === "sync"
        ? remoteProjectsSyncParamsSchema.parse(input.params)
        : remoteProjectsInspectParamsSchema.parse(input.params);
    const connection = await desktopSshConnection(parsed.hostId, input.environment);
    const request = Buffer.from(JSON.stringify({ action: input.action })).toString("base64");
    const stdout = await (input.execute ?? execute)({
      arguments: [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "SendEnv=-*",
        ...connection.arguments,
        `node --input-type=module - '${request}'`,
      ],
      environment: input.environment,
      source: await (input.source ?? workerSource)(),
    });
    const snapshot = remoteProjectsSnapshotSchema.parse(JSON.parse(stdout));
    if (snapshot.account.current !== true) throw new Error("Current account identity is missing");
    return snapshot;
  } catch {
    // SSH, Codex configuration, authentication and project metadata can all
    // contain sensitive values. Return one stable error at this boundary.
    throw new Error("无法读取 SSH 主机上的共享项目，请检查远端 Codex 登录和连接状态");
  }
}

export function inspectSshRemoteProjects(input: {
  params: unknown;
  environment: NodeJS.ProcessEnv;
  execute?: Execute;
  source?: () => Promise<string>;
}): Promise<RemoteProjectsSnapshot> {
  return runRemote({ ...input, action: "inspect" });
}

export function syncSshRemoteProjects(input: {
  params: unknown;
  environment: NodeJS.ProcessEnv;
  execute?: Execute;
  source?: () => Promise<string>;
}): Promise<RemoteProjectsSnapshot> {
  return runRemote({ ...input, action: "sync" });
}
