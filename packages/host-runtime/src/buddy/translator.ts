import { createHash } from "node:crypto";
import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  buddyTranslateRequestSchema,
  buddyTranslateResultSchema,
  detectBuddyTranslateSourceLanguage,
  type BuddyTranslateRequest,
  type BuddyTranslateResult,
} from "@codexhost/shared-contracts";
import { GatewayHttpError, gatewayJsonRequest } from "./gateway-request.js";

// locale -> ISO 639-1（与 Sub2API langmap.go 对齐）
const LOCALE_TO_ISO: Record<string, string> = {
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  zh: "zh-CN",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  ru: "ru",
  pt: "pt",
  it: "it",
  th: "th",
  vi: "vi",
  id: "id",
  ms: "ms",
  ar: "ar",
  hi: "hi",
};

type TranslateResponse = {
  translations?: Array<{ text?: string; detected_language?: string }>;
  provider?: string;
};

/**
 * Sub2API 的 `/api/v1/translate` 用 `{code,message,data}` 包一层，
 * 但同一网关的历史版本直接返回翻译体；两种形状都接受，避免静默翻译失败。
 */
function readTranslateResponse(value: unknown): TranslateResponse | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nested = record.data;
  if (nested && typeof nested === "object") return nested as TranslateResponse;
  return Array.isArray(record.translations) ? (record as TranslateResponse) : null;
}

/**
 * 翻译器调用 Sub2API 网关的 POST /api/v1/translate 接口。
 * 复用 Codex 网关凭据认证，候选选择、健康评分和失败降级由网关统一负责，免费源优先、百度最后。
 * 不消耗 LLM token。
 */
export class BuddyTranslator {
  readonly #home: string;
  readonly #cache = new Map<string, { result: BuddyTranslateResult; ts: number }>();
  readonly #ttl = 24 * 60 * 60 * 1000;

  constructor(private readonly environment: NodeJS.ProcessEnv) {
    this.#home = homePath(environment.CODEX_HOME);
  }

  async #config(): Promise<{ url: URL; headers: Headers } | null> {
    try {
      const conn = await readConnection(this.#home, this.environment);
      const url = new URL(conn.url);
      url.pathname = "/api/v1/translate";
      return { url, headers: conn.headers };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("无法读取网关配置");
    }
  }

  #ck(req: BuddyTranslateRequest): string {
    return createHash("sha256")
      .update(`${req.targetLocale}:${req.text}`)
      .digest("hex")
      .slice(0, 16);
  }

  async translate(value: unknown): Promise<BuddyTranslateResult> {
    const parsed = buddyTranslateRequestSchema.safeParse(value);
    if (!parsed.success) throw new Error("翻译请求无效");
    const req = parsed.data;

    const target = LOCALE_TO_ISO[req.targetLocale] ?? req.targetLocale.slice(0, 2);
    const source = detectBuddyTranslateSourceLanguage(req.text);
    // 同语言或没有正文时，先跳过，避免读取配置、旧缓存或访问网关。
    if (!source || source.split("-")[0] === target.split("-")[0]) {
      return buddyTranslateResultSchema.parse({
        translated: req.text,
        model: "noop",
        latencyMs: 0,
      });
    }

    const ck = this.#ck(req);
    const cached = this.#cache.get(ck);
    if (cached && Date.now() - cached.ts < this.#ttl) return cached.result;

    const cfg = await this.#config();
    if (!cfg) throw new Error("未配置网关");

    const t0 = Date.now();
    const signal = AbortSignal.timeout(15_000);
    let payload: unknown;
    try {
      payload = await gatewayJsonRequest(
        cfg.url,
        cfg.headers,
        {
          q: [req.text],
          source,
          target,
          format: "text",
        },
        signal,
        1_048_576,
      );
    } catch (error) {
      if (signal.aborted) {
        throw new Error("翻译请求超时（15 秒），网关未及时返回结果");
      }
      if (error instanceof GatewayHttpError) {
        throw new Error(`翻译服务返回 ${error.message}`);
      }
      const reason = error instanceof Error ? error.message : "未知错误";
      const messages: Record<string, string> = {
        "Read failed": "读取翻译服务响应失败",
        "Invalid JSON": "翻译服务返回了无效的 JSON 响应",
        "Too large": "翻译服务响应超过大小限制",
      };
      throw new Error(messages[reason] ?? `翻译请求失败：${reason.slice(0, 300)}`);
    }
    const resp = readTranslateResponse(payload);

    const translated = resp?.translations?.[0]?.text;
    if (!translated) throw new Error("翻译服务未返回结果");

    const result = buddyTranslateResultSchema.parse({
      translated,
      model: `sub2api:${resp.provider ?? "unknown"}`,
      latencyMs: Date.now() - t0,
    });

    this.#cache.set(ck, { result, ts: Date.now() });
    if (this.#cache.size > 500) {
      for (const [k] of [...this.#cache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 100))
        this.#cache.delete(k);
    }
    return result;
  }

  clearCache(): void {
    this.#cache.clear();
  }
}
