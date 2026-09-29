import { z } from "zod";
import { autoModelRoutesParamsSchema } from "./auto-model-routes.js";

export const SSH_AUTO_MODEL_ROUTES_METHOD = "codexhost/ssh/auto/routes";

// 仅查询原生 Thread 的上游选模记录，连接参数和凭据均由 Host 解析。
export const sshAutoModelRoutesParamsSchema = autoModelRoutesParamsSchema
  .extend({
    hostId: z.string().trim().min(1).max(1024),
    modelProvider: z.string().min(1).max(512),
    rolloutPath: z
      .string()
      .min(1)
      .max(16_384)
      .refine((value) => !value.includes("\0")),
  })
  .strict();

export type SshAutoModelRoutesParams = z.infer<typeof sshAutoModelRoutesParamsSchema>;
