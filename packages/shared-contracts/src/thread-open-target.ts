import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

export const THREAD_OPEN_TARGET_METHOD = "codexhost/thread/open-target";

const remotePath = z
  .string()
  .min(1)
  .max(16_384)
  .startsWith("/")
  .refine((value) => !/[\0\r\n]/u.test(value));

const remoteHostId = z.string().trim().min(1).max(4_096);

export const threadOpenTargetParamsSchema = z.object({ threadId: hostThreadIdSchema }).strict();
export const threadOpenTargetSchema = z
  .object({
    workspace: remotePath,
    codexPath: remotePath,
    codexHome: remotePath,
  })
  .strict();

// 原生 SSH 服务没有 open-target RPC，会话目录仍由原生 thread/read 提供。
// 图形编辑器只连接该目录，不需要远端 Codex 运行环境。
export const remoteThreadWorkspaceSchema = z
  .object({
    workspace: remotePath,
    hostId: remoteHostId,
  })
  .strict();

// 终端续接需要在远端执行 codex，但可执行文件与 CODEX_HOME 属于连接事实；
// 两者缺省时由本机 Host 经同一 SSH 连接解析，Renderer 不猜测远端环境。
export const remoteThreadTerminalTargetSchema = remoteThreadWorkspaceSchema
  .extend({
    codexPath: remotePath.optional(),
    codexHome: remotePath.optional(),
  })
  .strict();

export type ThreadOpenTarget = z.infer<typeof threadOpenTargetSchema>;
export type RemoteThreadWorkspace = z.infer<typeof remoteThreadWorkspaceSchema>;
export type RemoteThreadTerminalTarget = z.infer<typeof remoteThreadTerminalTargetSchema>;
