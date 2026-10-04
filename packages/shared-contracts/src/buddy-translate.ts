import { z } from "zod";

export const BUDDY_TRANSLATE_METHOD = "codexhost/buddy/translate";

export const buddyTranslateRequestSchema = z.object({
  text: z.string().min(1).max(64_000),
  targetLocale: z.string().min(2).max(10),
}).strict();

export type BuddyTranslateRequest = z.infer<typeof buddyTranslateRequestSchema>;

export const buddyTranslateResultSchema = z.object({
  translated: z.string(),
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
});

export type BuddyTranslateResult = z.infer<typeof buddyTranslateResultSchema>;
