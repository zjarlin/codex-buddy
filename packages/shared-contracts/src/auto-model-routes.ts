import { z } from "zod";

export const AUTO_MODEL_ROUTES_METHOD = "codexhost/auto/routes";
export const autoModelRoutesParamsSchema = z.object({
  threadId: z.string().uuid(),
  runId: z.string().min(1).max(128).optional(),
});
const model = z.string().min(1).max(512);
const candidate = z.object({
  model,
  platform: z.string().max(64),
  aliases: z.array(model).optional(),
  eligible: z.boolean(),
  order: z.number().int().positive().optional(),
  reason: z.string().max(128).optional(),
});
export const autoModelRouteSchema = z.object({
  request_id: z.string().uuid(),
  session_id: z.string().uuid(),
  turn_id: z.string().min(1).max(128),
  run_id: z.string().min(1).max(128).optional(),
  requested_model: model,
  selected_model: z.string().max(512),
  resolved_model: model.optional(),
  attempted_models: z.array(model),
  plan_id: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  candidates: z.array(candidate).optional(),
  state: z.enum([
    "selected",
    "responding",
    "queued",
    "running",
    "completed",
    "failed",
    "interrupted",
  ]),
  operation: z
    .object({
      kind: z.enum(["translation", "image_generation", "video_generation"]),
      provider: z.string().min(1).max(64).optional(),
      task_id: z.string().min(1).max(128).optional(),
      source_language: z.string().min(1).max(64).optional(),
      target_language: z.string().min(1).max(64).optional(),
      artifacts: z
        .array(
          z.object({
            kind: z.enum(["image", "video"]),
            url: z
              .string()
              .max(4096)
              .url({ protocol: /^https?$/ }),
          }),
        )
        .max(16)
        .optional(),
    })
    .optional(),
  started_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});
export const autoModelRouteListSchema = z.object({
  object: z.literal("list"),
  data: z.array(autoModelRouteSchema).max(128),
});
export const autoModelRoutesResultSchema = z.object({
  supported: z.boolean(),
  routes: z.array(autoModelRouteSchema).max(128),
  unavailableReason: z.enum(["host", "provider", "private"]).optional(),
});
export type AutoModelRoute = z.infer<typeof autoModelRouteSchema>;
export type AutoModelRoutesResult = z.infer<typeof autoModelRoutesResultSchema>;
