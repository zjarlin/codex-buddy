import { z } from "zod";

export const BUDDY_MODELS_METHOD = "codexhost/buddy/models";
export const BUDDY_STATUS_METHOD = "codexhost/buddy/status";
export const BUDDY_SETTINGS_METHOD = "codexhost/buddy/settings";
export const BUDDY_CANCEL_METHOD = "codexhost/buddy/cancel";
export const BUDDY_INTERRUPTED_METHOD = "codexhost/buddy/interrupted";
export const BUDDY_CONTINUE_METHOD = "codexhost/buddy/continue";
export const buddyContinueSchema = z
  .object({ threadId: z.string().min(1), turnId: z.string().min(1) })
  .strict();
export const buddyInterruptedSchema = z.object({
  threads: z.array(
    z.object({
      threadId: z.string(),
      turnId: z.string(),
      title: z.string(),
      status: z.enum(["failed", "interrupted", "cancelled"]),
    }),
  ),
  unreadable: z.number(),
});
export type BuddyInterrupted = z.infer<typeof buddyInterruptedSchema>;
export const buddySettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    privateMode: z.boolean().default(false),
    role: z.enum(["auto", "git", "io", "executor"]).default("auto"),
    bypass: z.boolean().default(true),
    plannerModel: z.string().max(200).nullable().default(null),
    executorModel: z.string().max(200).nullable().default(null),
  })
  .strict();
export type BuddySettings = z.infer<typeof buddySettingsSchema>;
export const buddyModelSchema = z.object({
  id: z.string(),
  tier: z.enum(["夯", "垃"]),
  eligible: z.boolean(),
});
export const buddyDecisionSchema = z.object({
  threadId: z.string(),
  turnId: z.string().nullable(),
  phase: z.enum([
    "discovering",
    "planning",
    "executing",
    "retrying",
    "bypass",
    "completed",
    "failed",
    "cancelled",
  ]),
  role: z.enum(["git", "io", "executor"]),
  difficulty: z.enum(["simple", "standard", "advanced"]),
  score: z.number(),
  reason: z.string(),
  plannerModel: z.string().nullable(),
  executorModel: z.string().nullable(),
  acceptedModel: z.string().nullable(),
  involvedModels: z.array(z.string()).default([]),
  plan: z.string().nullable(),
  command: z.string().nullable(),
  exitCode: z.number().nullable(),
  updatedAt: z.string(),
});
export const buddySnapshotSchema = z.object({
  settings: buddySettingsSchema,
  models: z.array(buddyModelSchema),
  decisions: z.array(buddyDecisionSchema),
});
export type BuddyModel = z.infer<typeof buddyModelSchema>;
export type BuddyDecision = z.infer<typeof buddyDecisionSchema>;
export type BuddySnapshot = z.infer<typeof buddySnapshotSchema>;
