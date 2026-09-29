import { z } from "zod";

export const SESSION_ROUTE_METHOD = "codexhost/session/route";

export const sessionRouteParamsSchema = z
  .object({
    message: z.string().trim().min(1).max(12_000),
    cwd: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .strict();

export const sessionRouteResultSchema = z
  .object({
    candidates: z.array(
      z.object({
        threadId: z.string().min(1),
        title: z.string().nullable(),
        cwd: z.string().min(1),
        confidence: z.number().min(0).max(1),
        preview: z.string().max(4_000),
      }).strict(),
    ).max(32),
    reason: z.string().min(1),
  })
  .strict();

export type SessionRouteParams = z.infer<typeof sessionRouteParamsSchema>;
export type SessionRouteResult = z.infer<typeof sessionRouteResultSchema>;
