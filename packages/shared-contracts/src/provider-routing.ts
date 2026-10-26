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
  z.object({ action: z.literal("move"), id: z.string(), direction: z.enum(["up", "down"]) }),
]);

export const providerRoutingSnapshotSchema = z.object({
  enabled: z.boolean(),
  providers: z.array(fallbackProviderSchema.extend({ keyConfigured: z.boolean() })),
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
export type ProviderFailure = NonNullable<ProviderRoutingSnapshot["failures"]>[number];
export type ProviderRouteObservation = z.infer<typeof providerRouteObservationSchema>;
