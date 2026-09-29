import { open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  buddySettingsFileSchema,
  sshAutoModelRoutesParamsSchema,
  type AutoModelRoutesResult,
  type SshAutoModelRoutesParams,
} from "@codexhost/shared-contracts";
import { readAutoModelRoutes } from "./auto-model-routes.js";

function rolloutHome(input: SshAutoModelRoutesParams): string {
  const match = /^(.*)\/(?:sessions\/\d{4}\/\d{2}\/\d{2}|archived_sessions)\/([^/]+)$/u.exec(
    input.rolloutPath,
  );
  if (
    !match?.[1] ||
    !path.isAbsolute(input.rolloutPath) ||
    path.normalize(input.rolloutPath) !== input.rolloutPath ||
    !match[2]?.startsWith("rollout-") ||
    !match[2].endsWith(`-${input.threadId}.jsonl`)
  ) {
    throw new Error("Auto route Thread rollout path is unavailable");
  }
  return match[1];
}

async function readThreadMetadata(rolloutPath: string): Promise<unknown> {
  const file = await open(rolloutPath, "r");
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    while (size < 2 * 1024 * 1024) {
      const chunk = Buffer.alloc(16 * 1024);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      const value = chunk.subarray(0, bytesRead);
      const newline = value.indexOf(0x0a);
      chunks.push(newline < 0 ? value : value.subarray(0, newline));
      size += bytesRead;
      if (newline >= 0) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    throw new Error("Auto route Thread metadata is unavailable");
  } finally {
    await file.close();
  }
}

// 在 SSH 主机内读取已持久化 Thread，凭据和上游网络请求始终留在该主机。
export async function readSshAutoModelRoutesOnHost(
  params: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<AutoModelRoutesResult> {
  const input = sshAutoModelRoutesParamsSchema.parse(params);
  const home = rolloutHome(input);
  const [resolvedHome, resolvedRollout] = await Promise.all([
    realpath(home),
    realpath(input.rolloutPath),
  ]);
  if (resolvedRollout !== path.join(resolvedHome, path.relative(home, input.rolloutPath))) {
    throw new Error("Auto route Thread rollout ownership is unavailable");
  }
  const metadata = (await readThreadMetadata(resolvedRollout)) as {
    type?: unknown;
    payload?: { id?: unknown; model_provider?: unknown };
  } | null;
  if (
    metadata?.type !== "session_meta" ||
    metadata.payload?.id !== input.threadId ||
    metadata.payload.model_provider !== input.modelProvider
  ) {
    throw new Error("Auto route Thread provider ownership is unavailable");
  }
  return readAutoModelRoutes({
    params: { threadId: input.threadId, runId: input.runId },
    environment: { ...environment, CODEX_HOME: resolvedHome },
    async privateMode() {
      try {
        const settings = await readFile(path.join(resolvedHome, "buddy-router.json"), "utf8");
        return buddySettingsFileSchema.parse(JSON.parse(settings)).privateMode;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async readThread() {
      return { result: { thread: { id: input.threadId, modelProvider: input.modelProvider } } };
    },
  });
}

// 独立 Worker 从标准输入接收构建产物，仅向标准输出写已清理的观察数据。
if (process.argv[1] === "-") {
  try {
    const params = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    process.stdout.write(JSON.stringify(await readSshAutoModelRoutesOnHost(params)));
  } catch {
    process.stderr.write("Unable to read Auto route observations on SSH Host\n");
    process.exitCode = 1;
  }
}
