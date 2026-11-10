import { z } from "zod";

/**
 * Native Codex Thread goal, as returned by the official `thread/goal/get` request.
 * Goals belong to the official Codex runtime; external Harness Threads do not
 * expose this state through the Host.
 */
export const threadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

export const threadGoalSchema = z.object({
  threadId: z.string().min(1),
  objective: z.string(),
  status: threadGoalStatusSchema,
  tokenBudget: z.number().int().nonnegative().nullable(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const threadGoalGetResultSchema = z.object({
  goal: threadGoalSchema.nullable(),
});

export type ThreadGoalStatus = z.infer<typeof threadGoalStatusSchema>;
export type ThreadGoal = z.infer<typeof threadGoalSchema>;
export type ThreadGoalGetResult = z.infer<typeof threadGoalGetResultSchema>;
