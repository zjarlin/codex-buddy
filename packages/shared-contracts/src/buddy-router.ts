import { z } from "zod";

export const BUDDY_MODELS_METHOD = "codexhost/buddy/models";
export const BUDDY_CATALOG_SYNC_METHOD = "codexhost/buddy/catalog-sync";
export const BUDDY_JEV_KEY_METHOD = "codexhost/buddy/jev-key";
export const BUDDY_STATUS_METHOD = "codexhost/buddy/status";
export const BUDDY_SETTINGS_METHOD = "codexhost/buddy/settings";
export const BUDDY_CANCEL_METHOD = "codexhost/buddy/cancel";
export const BUDDY_ANSWER_METHOD = "codexhost/buddy/answer";
export const buddyPlannerInputSchema = z.object({
  requestId: z.union([z.string(), z.number()]),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        header: z.string(),
        question: z.string(),
        isSecret: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string(), description: z.string().optional() }))
          .nullable(),
      }),
    )
    .min(1),
});
export const buddyAnswerSchema = z
  .object({
    threadId: z.string().min(1),
    requestId: z.union([z.string(), z.number()]),
    answers: z.record(z.string(), z.object({ answers: z.array(z.string().trim().min(1)).min(1) })),
  })
  .strict();
export type BuddyPlannerInput = z.infer<typeof buddyPlannerInputSchema>;
export type BuddyAnswer = z.infer<typeof buddyAnswerSchema>;
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
  runningThreadIds: z.array(z.string()).default([]),
  unreadable: z.number(),
});
export type BuddyInterrupted = z.infer<typeof buddyInterruptedSchema>;
const buddySettingsShape = {
  enabled: z.boolean().default(true),
  planning: z.boolean().default(true),
  privateMode: z.boolean().default(false),
  role: z.enum(["auto", "git", "io", "executor"]).default("auto"),
  bypass: z.boolean().default(true),
  jev: z.boolean().default(true),
  // System One 模型名同时是网关平台选择器：`typesafe/jev` 或内网 `laya`。
  systemOneModel: z.string().trim().min(1).max(200).default("typesafe/jev"),
  plannerModel: z.string().max(200).nullable().default(null),
  executorModel: z.string().max(200).nullable().default(null),
} as const;
// 持久化读取允许未知字段：旧运行时不应因为文件里出现新版本开关而拒绝启动。
export const buddySettingsFileSchema = z.object(buddySettingsShape).passthrough();
// 浏览器写入仍保持 strict，避免拼写错误或未声明字段静默落盘。
export const buddySettingsSchema = z.object(buddySettingsShape).strict();
export type BuddySettings = z.infer<typeof buddySettingsSchema>;
// JEV 连接单独配置，不进入会回传浏览器的 settings，避免密钥泄露到 renderer。
// apiKey 与 baseURL 均可选：省略表示保持不变，null/空串表示清除该项。
export const buddyJevKeySchema = z
  .object({
    apiKey: z.string().trim().max(400).nullable().optional(),
    baseURL: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type BuddyJevKey = z.infer<typeof buddyJevKeySchema>;
export const buddyCatalogSyncSchema = z.object({
  provider: z.string(),
  returned: z.number().int().nonnegative(),
  ids: z.array(z.string()),
});
export type BuddyCatalogSync = z.infer<typeof buddyCatalogSyncSchema>;
export const buddyModelSchema = z.object({
  id: z.string(),
  tier: z.enum(["夯", "垃"]),
  eligible: z.boolean(),
});
export const buddyModelRefreshSchema = z.object({
  returned: z.number().int().nonnegative(),
  synchronized: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
});
export const buddyDecisionSchema = z.object({
  threadId: z.string(),
  turnId: z.string().nullable(),
  phase: z.enum([
    "discovering",
    "planning",
    "waiting-input",
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
  judgment: z
    .object({
      // System One 决策来源：JEV 或本地 Laya，同一 wire protocol、不同上游平台。
      source: z.enum(["system-one"]),
      model: z.string(),
      decisions: z.record(
        z.string(),
        z.object({
          status: z.enum(["automatic", "review", "defer"]),
          strength: z.number(),
          basis: z.enum(["outcome-probability", "confidence-and-probability", "confidence"]),
        }),
      ),
    })
    .optional(),
  modelBypass: z
    .object({
      kind: z.literal("git-push"),
      skills: z.array(z.string()),
      skillWarning: z.string().nullable(),
      outcome: z.enum(["pending", "completed", "failed", "cancelled"]),
      successRate: z.number().min(0).max(100).nullable(),
      succeeded: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .optional(),
  plan: z.string().nullable(),
  pendingInput: buddyPlannerInputSchema.nullable().optional(),
  command: z.string().nullable(),
  exitCode: z.number().nullable(),
  updatedAt: z.string(),
});
export const buddySnapshotSchema = z.object({
  settings: buddySettingsSchema,
  models: z.array(buddyModelSchema),
  modelRefresh: buddyModelRefreshSchema.optional(),
  decisions: z.array(buddyDecisionSchema),
  // 只回传“是否已配置”，绝不回传密钥本身；baseURL 不是密钥，可回传以便界面显示。
  jevKeyConfigured: z.boolean().default(false),
  jevBaseUrl: z.string().nullable().default(null),
});
export const systemOneModelValues = ["typesafe/jev", "laya"] as const;
export type BuddyModel = z.infer<typeof buddyModelSchema>;
export type BuddyModelRefresh = z.infer<typeof buddyModelRefreshSchema>;
export type BuddyDecision = z.infer<typeof buddyDecisionSchema>;
export type BuddySnapshot = z.infer<typeof buddySnapshotSchema>;
