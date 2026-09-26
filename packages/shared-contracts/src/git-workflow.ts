import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

export const GIT_WORKFLOW_STATUS_METHOD = "codexhost/git/workflow/status";
export const GIT_WORKFLOW_RUN_METHOD = "codexhost/git/workflow/run";

// 自动工作流始终使用聊天项目，不接收提交面板的仓库选择。
export const gitWorkflowParamsSchema = z.object({ threadId: hostThreadIdSchema }).strict();
export type GitWorkflowParams = z.infer<typeof gitWorkflowParamsSchema>;

export const gitWorkflowSnapshotSchema = z
  .object({
    workspace: z.string().nullable(),
    phase: z.enum(["idle", "waiting", "starting", "running", "completed", "failed", "skipped"]),
    threadId: z.string().nullable(),
    turnId: z.string().nullable(),
    message: z.string(),
  })
  .strict();
export type GitWorkflowSnapshot = z.infer<typeof gitWorkflowSnapshotSchema>;
