import { z } from "zod";

export const BUDDY_MODELS_METHOD = "codexhost/buddy/models";
export const BUDDY_CATALOG_SYNC_METHOD = "codexhost/buddy/catalog-sync";
export const BUDDY_JEV_KEY_METHOD = "codexhost/buddy/jev-key";
export const BUDDY_STATUS_METHOD = "codexhost/buddy/status";
export const BUDDY_SETTINGS_METHOD = "codexhost/buddy/settings";
export const BUDDY_CANCEL_METHOD = "codexhost/buddy/cancel";
export const EMERGENCY_PROVIDER_METHOD = "codexhost/emergency/provider";
export const BUDDY_INTERRUPTED_METHOD = "codexhost/buddy/interrupted";
export const BUDDY_CONTINUE_METHOD = "codexhost/buddy/continue";
export const buddyContinueSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    model: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export const buddyInterruptedSchema = z.object({
  threads: z
    .array(
      z.object({
        threadId: z.string(),
        turnId: z.string(),
        title: z.string(),
        status: z.enum(["failed", "interrupted", "cancelled"]),
        owner: z.enum(["codex", "external"]).default("codex"),
      }),
    )
    .default([]),
  runningThreadIds: z.array(z.string()).default([]),
  unreadable: z.number(),
});
export type BuddyInterrupted = z.infer<typeof buddyInterruptedSchema>;
const buddySettingsShape = {
  enabled: z.boolean().default(true),
  privateMode: z.boolean().default(false),
  role: z.enum(["auto", "git", "io", "executor"]).default("auto"),
  bypass: z.boolean().default(true),
  jev: z.boolean().default(true),
  // System One 模型名同时是网关平台选择器：`typesafe/jev` 或内网 `laya`。
  systemOneModel: z.string().trim().min(1).max(200).default("typesafe/jev"),
  executorModel: z.string().max(200).nullable().default(null),
} as const;
// 持久化读取忽略未知字段，兼容旧规划设置但不再向浏览器暴露。
export const buddySettingsFileSchema = z.object(buddySettingsShape);
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
// 应急供应商连接配置：apiKey 与 baseURL 均可选；省略表示保持不变，null/空串表示清除该项。
// enabled 控制是否启用故障转移反向代理（仅当已配置时生效）。
export const emergencyProviderConfigSchema = z
  .object({
    apiKey: z.string().trim().max(400).nullable().optional(),
    baseURL: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
export type EmergencyProviderConfig = z.infer<typeof emergencyProviderConfigSchema>;
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
  executorModel: z.string().nullable(),
  acceptedModel: z.string().nullable(),
  involvedModels: z.array(z.string()).default([]),
  judgment: z
    .discriminatedUnion("source", [
      z.object({
        source: z.literal("system-one"),
        model: z.string().min(1),
        decisions: z.record(
          z.string(),
          z.object({
            status: z.enum(["automatic", "review", "defer"]),
            strength: z.number(),
            basis: z.enum(["outcome-probability", "confidence-and-probability", "confidence"]),
          }),
        ),
      }),
      // 本地兜底不声称调用过决策模型，也不伪造逐题答案。
      z.object({
        source: z.literal("local-rules"),
        model: z.null(),
        decisions: z.object({}).strict(),
      }),
    ])
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
  command: z.string().nullable(),
  exitCode: z.number().nullable(),
  updatedAt: z.string(),
});
export const buddySnapshotSchema = z.object({
  // 旧 Host 的状态可能包含已移除的规划字段；读取时剥离，设置写入仍严格校验。
  settings: buddySettingsFileSchema,
  models: z.array(buddyModelSchema),
  modelRefresh: buddyModelRefreshSchema.optional(),
  decisions: z.array(buddyDecisionSchema),
  // 只回传“是否已配置”，绝不回传密钥本身；baseURL 不是密钥，可回传以便界面显示。
  jevKeyConfigured: z.boolean().default(false),
  jevBaseUrl: z.string().nullable().default(null),
  // 应急供应商：只回传"是否已配置"和"是否启用"，不回传密钥；baseURL 可回传以便界面显示。
  emergencyConfigured: z.boolean().default(false),
  emergencyEnabled: z.boolean().default(false),
  emergencyBaseUrl: z.string().nullable().default(null),
});
export const systemOneModelValues = ["typesafe/jev", "laya"] as const;
export type BuddyModel = z.infer<typeof buddyModelSchema>;
export type BuddyModelRefresh = z.infer<typeof buddyModelRefreshSchema>;
export type BuddyDecision = z.infer<typeof buddyDecisionSchema>;
export type BuddySnapshot = z.infer<typeof buddySnapshotSchema>;
