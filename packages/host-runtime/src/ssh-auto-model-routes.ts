import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  autoModelRoutesResultSchema,
  sshTurnActionsParamsSchema,
  turnActionsSnapshotSchema,
  turnActionInvocationSchema,
  sshAutoModelRoutesParamsSchema,
  type AutoModelRoutesResult,
} from "@codexhost/shared-contracts";
import { desktopSshConnection } from "./desktop-ssh-connection.js";

declare const __CODEXHOST_SSH_AUTO_MODEL_ROUTES_WORKER__: string;

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
      signal: AbortSignal.timeout(15_000),
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        child.kill();
        reject(new Error("Auto route response is too large"));
        return;
      }
      chunks.push(chunk);
    });
    child.once("close", (code) => {
      if (code !== 0) reject(new Error("SSH Auto route query failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(input.source);
  });

function workerSource(): Promise<string> {
  if (typeof __CODEXHOST_SSH_AUTO_MODEL_ROUTES_WORKER__ === "string") {
    return Promise.resolve(__CODEXHOST_SSH_AUTO_MODEL_ROUTES_WORKER__);
  }
  return readFile(new URL("./ssh-auto-model-routes-worker.bundle.mjs", import.meta.url), "utf8");
}

// SSH 目标仅来自 Desktop 保存的连接；固定 Worker 不开放任意命令或凭据读取接口。
export async function readSshAutoModelRoutes(input: {
  params: unknown;
  environment: NodeJS.ProcessEnv;
  execute?: Execute;
  workerSource?: () => Promise<string>;
}): Promise<AutoModelRoutesResult> {
  try {
    const params = sshAutoModelRoutesParamsSchema.parse(input.params);
    const connection = await desktopSshConnection(params.hostId, input.environment);
    const request = Buffer.from(JSON.stringify(params)).toString("base64");
    const source = await (input.workerSource ?? workerSource)();
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
      source,
    });
    const result = autoModelRoutesResultSchema.parse(JSON.parse(stdout));
    if (
      result.routes.some(
        (route) =>
          route.session_id !== params.threadId ||
          (route.run_id !== undefined && route.run_id !== route.turn_id) ||
          (params.runId !== undefined && route.turn_id !== params.runId),
      )
    ) {
      throw new Error("Mismatched SSH Thread");
    }
    return result;
  } catch {
    // SSH、文件、配置和上游异常都可能含有敏感数据，不透传原始错误。
    throw new Error("Unable to read Auto route observations on SSH Host");
  }
}

// 动作旁路复用固定 SSH Worker，凭据、隐私设置及执行记录留在远端。
export async function readSshTurnActions(input: {
  params: unknown;
  environment: NodeJS.ProcessEnv;
}): Promise<unknown> {
  try {
    const params = sshTurnActionsParamsSchema.parse(input.params);
    const connection = await desktopSshConnection(params.target.hostId, input.environment);
    const encoded = Buffer.from(JSON.stringify(params)).toString("base64");
    const stdout = await execute({
      arguments: [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "SendEnv=-*",
        ...connection.arguments,
        `node --input-type=module - '${encoded}'`,
      ],
      environment: input.environment,
      source: await workerSource(),
    });
    const result = JSON.parse(stdout);
    if (params.operation === "inspect") {
      const snapshot = turnActionsSnapshotSchema.parse(result);
      if (
        snapshot.threadId !== params.target.threadId ||
        snapshot.sourceTurnId !== params.sourceTurnId ||
        snapshot.latestTurnId !== params.latestTurnId ||
        snapshot.invocations.some((value) => value.threadId !== snapshot.threadId) ||
        (snapshot.recommendation &&
          (snapshot.recommendation.session_id !== snapshot.threadId ||
            snapshot.recommendation.run_id !== snapshot.sourceTurnId))
      )
        throw new Error("远程动作归属不匹配");
      return snapshot;
    }
    const receipt = turnActionInvocationSchema.parse(result);
    const expected = params.invocation;
    if (
      !expected ||
      receipt.threadId !== params.target.threadId ||
      receipt.invocationId !== expected.invocationId ||
      receipt.sourceTurnId !== expected.sourceTurnId ||
      receipt.actionId !== expected.actionId ||
      receipt.version !== expected.version
    )
      throw new Error("远程执行记录归属不匹配");
    return receipt;
  } catch {
    throw new Error("无法读取或保存远端回合动作，请检查 SSH 连接");
  }
}
