import { z } from "zod";

import { hostThreadIdSchema } from "./ids.js";
import { remoteThreadOpenTargetSchema } from "./thread-open-target.js";

export const THREAD_WORKSPACE_OPEN_METHOD = "codexhost/thread/workspace/open";

export const threadWorkspaceOpenParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    remote: remoteThreadOpenTargetSchema.optional(),
  })
  .strict();
export type ThreadWorkspaceOpenParams = z.infer<typeof threadWorkspaceOpenParamsSchema>;

export const threadWorkspaceOpenResultSchema = z
  .object({
    workspace: z.string().min(1),
    application: z.literal("vscode"),
  })
  .strict();
export type ThreadWorkspaceOpenResult = z.infer<typeof threadWorkspaceOpenResultSchema>;
