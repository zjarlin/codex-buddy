import { z } from "zod";
import {
  gitGeneratedMessageSchema,
  gitMessageGenerateParamsSchema,
  gitMessageModelsSchema,
  gitWorkspaceStatusSchema,
  type GitGeneratedMessage,
  type GitMessageModels,
} from "@codexhost/shared-contracts";
import { GitWorkspace } from "./git-workspace.js";
import { readGitMessageRevision } from "./git-message-revision.js";

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("models") }).strict(),
  z.object({ kind: z.literal("revision"), status: gitWorkspaceStatusSchema }).strict(),
  z
    .object({
      kind: z.literal("generate"),
      cwd: z.string().trim().min(1).max(16_384),
      model: z.string().trim().min(1).max(512),
      paths: z.array(z.string().trim().min(1).max(16_384)).max(10_000),
    })
    .strict(),
]);

// 这个进程由本机固定源代码启动，但配置、认证、Git 与模型请求全部留在 SSH 主机内。
export async function readSshGitMessageOnHost(
  request: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<GitMessageModels | GitGeneratedMessage | string | null> {
  const input = requestSchema.parse(request);
  if (input.kind === "revision") return readGitMessageRevision(input.status);
  const git = new GitWorkspace(environment);
  if (input.kind === "models")
    return gitMessageModelsSchema.parse(await git.messageModels(environment));
  const params = gitMessageGenerateParamsSchema.parse({
    cwd: input.cwd,
    model: input.model,
    paths: input.paths,
  });
  if (!params.cwd) throw new Error("SSH Git workspace is unavailable");
  return gitGeneratedMessageSchema.parse(
    await git.generateMessage({
      cwd: params.cwd,
      model: params.model,
      paths: params.paths,
      environment,
    }),
  );
}

// 独立 Worker 只从参数读取已验证的模型请求，标准输出不包含配置或上游错误。
if (process.argv[1] === "-") {
  try {
    const request = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    process.stdout.write(JSON.stringify(await readSshGitMessageOnHost(request)));
  } catch {
    process.stderr.write("Unable to process Git message request on SSH Host\n");
    process.exitCode = 1;
  }
}
