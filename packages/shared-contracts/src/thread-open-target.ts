import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

export const THREAD_OPEN_TARGET_METHOD = "codexhost/thread/open-target";

const remotePath = z
  .string()
  .min(1)
  .max(16_384)
  .startsWith("/")
  .refine((value) => !/[\0\r\n]/u.test(value));

export const threadOpenTargetParamsSchema = z.object({ threadId: hostThreadIdSchema }).strict();
export const threadOpenTargetSchema = z
  .object({
    workspace: remotePath,
    codexPath: remotePath,
    codexHome: remotePath,
  })
  .strict();
export const remoteThreadOpenTargetSchema = threadOpenTargetSchema
  .extend({
    hostId: z.string().trim().min(1).max(4_096),
  })
  .strict();

export type ThreadOpenTarget = z.infer<typeof threadOpenTargetSchema>;
export type RemoteThreadOpenTarget = z.infer<typeof remoteThreadOpenTargetSchema>;
