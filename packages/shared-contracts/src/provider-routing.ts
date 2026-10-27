import { z } from "zod";
import { hostThreadIdSchema, hostTurnIdSchema } from "./ids.js";

export const PROVIDER_ROUTING_METHOD = "codexhost/providers/routing";

export const providerEndpointSchema = z
  .string()
  .trim()
  .pipe(z.url({ protocol: /^https?$/u }))
  .refine(
    (value) => !/[?#@]/u.test(value),
    "Use an HTTP(S) API base URL without credentials, query or fragment",
  );

export const fallbackProviderSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9-]+$/u),
  name: z.string().trim().min(1).max(80),
  baseUrl: providerEndpointSchema,
  model: z.string().trim().max(200).default(""),
  enabled: z.boolean(),
});

// 网关模型目录由「拉取」写入，不属于用户表单字段：保存名称/顺序/开关时不会覆盖它。
export const providerModelsSchema = z.object({
  // 上一次从该网关 `/v1/models` 拉取到的模型；空表示尚未拉取或拉取失败。
  models: z.array(z.string().trim().min(1).max(200)).max(2000).default([]),
  modelsSyncedAt: z.number().int().nonnegative().nullable().default(null),
});

// 多个网关合并后的模型目录：同一个模型只出现一次，providers 记录提供该模型的网关名称。
export const providerModelCatalogEntrySchema = z.object({
  model: z.string().min(1).max(200),
  providers: z.array(z.string().min(1).max(80)).min(1),
});

export const providerSyncResultSchema = z.object({
  provider: z.string().min(1).max(80),
  modelCount: z.number().int().nonnegative(),
  error: z.string().max(400).optional(),
});

export const providerRouteObservationSchema = z.object({
  request_id: z.string().min(1).max(120),
  thread_id: hostThreadIdSchema,
  turn_id: hostTurnIdSchema,
  provider_id: z.string().min(1).max(120),
  provider_name: z.string().min(1).max(120),
  base_url: providerEndpointSchema,
  model: z.string().max(200).optional(),
  fallback: z.boolean(),
  state: z.enum(["responding", "completed", "failed"]),
  failure_kind: z.enum(["network", "timeout", "http", "stream"]).optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  request_kind: z.string().min(1).max(80).optional(),
  started_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});

export const providerRoutingParamsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    threadId: hostThreadIdSchema.optional(),
    runId: hostTurnIdSchema.optional(),
  }),
  z.object({ action: z.literal("configure"), enabled: z.boolean() }),
  z.object({
    action: z.literal("save"),
    provider: fallbackProviderSchema,
    apiKey: z.string().trim().min(1).max(8192).optional(),
  }),
  z.object({ action: z.literal("remove"), id: z.string() }),
  // 从网关的 `/v1/models` 直接拉取模型目录；省略 id 时同步全部已启用且已保存密钥的网关。
  z.object({ action: z.literal("sync"), id: z.string().optional() }),
  z.object({ action: z.literal("move"), id: z.string(), direction: z.enum(["up", "down"]) }),
]);

export const providerRoutingSnapshotSchema = z.object({
  enabled: z.boolean(),
  providers: z.array(
    fallbackProviderSchema
      .extend(providerModelsSchema.shape)
      .extend({ keyConfigured: z.boolean() }),
  ),
  modelCatalog: z.array(providerModelCatalogEntrySchema).optional(),
  syncResults: z.array(providerSyncResultSchema).optional(),
  primaryProviders: z.array(
    z.object({ id: z.string(), name: z.string(), baseUrl: z.string(), covered: z.boolean() }),
  ),
  ready: z.boolean(),
  lastRoute: z.object({ provider: z.string(), fallback: z.boolean(), at: z.number() }).nullable(),
  failures: z
    .array(
      z.object({
        provider: z.string(),
        kind: z.enum(["network", "timeout", "http", "stream"]),
        status: z.number().int().optional(),
        at: z.number(),
        retryAt: z.number(),
      }),
    )
    .optional(),
  routes: z.array(providerRouteObservationSchema).max(512).optional(),
});

export type ProviderRoutingParams = z.infer<typeof providerRoutingParamsSchema>;
export type ProviderRoutingSnapshot = z.infer<typeof providerRoutingSnapshotSchema>;
export type FallbackProvider = z.infer<typeof fallbackProviderSchema>;
export type ProviderModels = z.infer<typeof providerModelsSchema>;
export type ProviderModelCatalogEntry = z.infer<typeof providerModelCatalogEntrySchema>;
export type ProviderSyncResult = z.infer<typeof providerSyncResultSchema>;
export type ProviderFailure = NonNullable<ProviderRoutingSnapshot["failures"]>[number];
export type ProviderRouteObservation = z.infer<typeof providerRouteObservationSchema>;
