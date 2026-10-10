import { z } from "zod";

export const BUDDY_TRANSLATE_METHOD = "codexhost/buddy/translate";

/** 只判断自然语言，代码和技术标识符不应触发翻译。 */
export function detectBuddyTranslateSourceLanguage(
  text: string,
): "zh-CN" | "ja" | "ko" | "en" | null {
  const prose = text
    .replace(/(?:```|~~~)[\s\S]*?(?:(?:```|~~~)|$)/g, " ")
    .replace(/(`+)[\s\S]*?\1/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, " ")
    .replace(/\b[A-Za-z_]\w*\([^()\r\n]*\)/g, " ")
    .replace(/[A-Za-z][A-Za-z0-9_]*(?:[./\\|:@-][A-Za-z0-9_]+)*/g, (token) =>
      /[0-9_./\\|:@]|[a-z][A-Z]|[A-Z]{2}/.test(token) ? " " : token,
    );
  const han = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
  const kana = prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const hangul = prose.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  // 英文按单词计数，避免少量长英文名称压过中文说明。
  const latin = prose.match(/\p{Script=Latin}+/gu)?.length ?? 0;
  if (kana > han && kana >= hangul && kana >= latin) return "ja";
  if (hangul > han && hangul >= kana && hangul >= latin) return "ko";
  if (han > 0 && han >= latin) return "zh-CN";
  return /\p{L}/u.test(prose) ? "en" : null;
}

export const buddyTranslateRequestSchema = z
  .object({
    text: z.string().min(1).max(64_000),
    targetLocale: z.string().min(2).max(10),
  })
  .strict();

export type BuddyTranslateRequest = z.infer<typeof buddyTranslateRequestSchema>;

export const buddyTranslateResultSchema = z.object({
  translated: z.string(),
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
});

export type BuddyTranslateResult = z.infer<typeof buddyTranslateResultSchema>;

/**
 * 批量翻译：一个回合结束后一次性翻译该会话内所有待翻译英文段落，
 * 避免运行中逐条请求把 Host 请求队列压满。
 * 单条上限沿用 buddyTranslateRequestSchema，最多 200 段。
 */
export const BUDDY_TRANSLATE_BATCH_METHOD = "codexhost/buddy/translate/batch";
export const BUDDY_TRANSLATE_BATCH_MAX_ITEMS = 200;

export const buddyTranslateBatchItemSchema = z
  .object({
    id: z.string().min(1).max(512),
    text: z.string().min(1).max(64_000),
  })
  .strict();

export const buddyTranslateBatchRequestSchema = z
  .object({
    items: z.array(buddyTranslateBatchItemSchema).min(1).max(BUDDY_TRANSLATE_BATCH_MAX_ITEMS),
    targetLocale: z.string().min(2).max(10),
  })
  .strict();

export const buddyTranslateBatchItemResultSchema = z.object({
  id: z.string().min(1).max(512),
  translated: z.string(),
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
});

export const buddyTranslateBatchResultSchema = z.object({
  items: z.array(buddyTranslateBatchItemResultSchema),
});

export type BuddyTranslateBatchItem = z.infer<typeof buddyTranslateBatchItemSchema>;
export type BuddyTranslateBatchRequest = z.infer<typeof buddyTranslateBatchRequestSchema>;
export type BuddyTranslateBatchItemResult = z.infer<typeof buddyTranslateBatchItemResultSchema>;
export type BuddyTranslateBatchResult = z.infer<typeof buddyTranslateBatchResultSchema>;
