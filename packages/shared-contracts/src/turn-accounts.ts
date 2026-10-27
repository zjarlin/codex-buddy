import { z } from "zod";

export const TURN_ACCOUNTS_METHOD = "codexhost/turn/accounts";

// 回合的调度账号归属：只按会话与回合时间窗向网关询问，入参里不出现账号池或凭据。
export const turnAccountsParamsSchema = z
  .object({
    threadId: z.string().uuid(),
    runId: z.string().min(1).max(128).optional(),
    since: z.number().int().nonnegative().optional(),
    until: z.number().int().nonnegative().optional(),
  })
  .strict();

const identity = z.string().min(1).max(128);
// 网关响应按字段白名单取值：多余字段（例如密钥或账号池细节）被丢弃而不是透传。
export const turnAccountSchema = z.object({
  account_id: z.number().int().positive(),
  account_name: z.string().max(256).optional(),
  model: z.string().max(512),
  created_at: z.string().min(1).max(64).optional(),
  output_tokens: z.number().int().nonnegative().optional(),
});

export const turnAccountListSchema = z.object({
  object: z.literal("list"),
  data: z.array(turnAccountSchema).max(50),
});

export const turnAccountsResultSchema = z
  .object({
    supported: z.boolean(),
    accounts: z.array(turnAccountSchema).max(50),
    // attribution = 「会话 + 时间窗」推断，不是网关原生的 turn_id 关联。
    attribution: z.enum(["window", "unknown"]).default("unknown"),
    unavailableReason: z.enum(["host", "provider", "private"]).optional(),
    runId: identity.optional(),
  })
  .strict();

export type TurnAccountsParams = z.infer<typeof turnAccountsParamsSchema>;
export type TurnAccount = z.infer<typeof turnAccountSchema>;
export type TurnAccountsResult = z.infer<typeof turnAccountsResultSchema>;
