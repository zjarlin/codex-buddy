import { z } from "zod";

export const GIT_WORKFLOW_STATUS_METHOD = "codexhost/git/workflow/status";
export const GIT_WORKFLOW_RUN_METHOD = "codexhost/git/workflow/run";

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
