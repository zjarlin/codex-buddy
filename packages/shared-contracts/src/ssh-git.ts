import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";

export const SSH_GIT_METHOD = "codexhost/ssh/git";

// 仅转发确定的 Git 操作，不能把 SSH 通道当作任意命令或 Host RPC 代理。
export const sshGitMethods = [
  "codexhost/git/status",
  "codexhost/git/diff",
  "codexhost/git/content",
  "codexhost/git/stage",
  "codexhost/git/unstage",
  "codexhost/git/commit",
  "codexhost/git/push",
  "codexhost/git/fetch",
  "codexhost/git/sync",
  "codexhost/git/merge/continue",
  "codexhost/git/merge/abort",
  "codexhost/git/submodules",
  "codexhost/git/submodule/update",
  "codexhost/git/repositories",
  "codexhost/git/repository/link",
  "codexhost/git/repository/unlink",
  "codexhost/git/log",
  "codexhost/git/commit-detail",
  "codexhost/git/commit-diff",
  "codexhost/git/message-models",
  "codexhost/git/message/generate",
] as const;

export const sshGitParamsSchema = z
  .object({
    hostId: z.string().trim().min(1).max(1024),
    method: z.enum(sshGitMethods),
    params: z
      .object({ cwd: z.string().min(1).max(16_384), threadId: z.never().optional() })
      .catchall(jsonValueSchema),
  })
  .strict();
export type SshGitParams = z.infer<typeof sshGitParamsSchema>;
