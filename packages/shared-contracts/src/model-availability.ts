import { z } from "zod";

export const MODEL_AVAILABILITY_METHOD = "codexhost/models/availability";

export const modelAvailabilityParamsSchema = z
  .object({
    action: z.enum(["read", "probe"]),
    modelIds: z.array(z.string().min(1).max(500)).max(10_000).optional(),
  })
  .strict();

export const modelAvailabilityResultSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["available", "unavailable"]),
  checkedAt: z.string(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});

export const modelAvailabilitySnapshotSchema = z.object({
  provider: z.string(),
  checkedAt: z.string().nullable(),
  results: z.array(modelAvailabilityResultSchema),
});

export type ModelAvailabilityParams = z.infer<typeof modelAvailabilityParamsSchema>;
export type ModelAvailabilityResult = z.infer<typeof modelAvailabilityResultSchema>;
export type ModelAvailabilitySnapshot = z.infer<typeof modelAvailabilitySnapshotSchema>;
