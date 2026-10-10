import { createHash } from "node:crypto";
import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  buddyTranslateRequestSchema,
  buddyTranslateResultSchema,
  buddyTranslateBatchRequestSchema,
  buddyTranslateBatchResultSchema,
  detectBuddyTranslateSourceLanguage,
  type BuddyTranslateRequest,
  type BuddyTranslateResult,
  type BuddyTranslateBatchResult,
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

    const translated = await this.#requestGateway([req.text], source, target);
    const result = buddyTranslateResultSchema.parse({
      translated: translated.texts[0] ?? "",
      model: translated.model,
      latencyMs: translated.latencyMs,
    });
    if (!result.translated) throw new Error("翻译服务未返回结果");
    this.#remember(ck, result);
    return result;
  }

  /**
   * 一个回合结束后一次性翻译所有待翻译段落，把逐条请求收敛为一次网关调用。
   * 同语言/无正文/命中缓存的段落不进入网关请求，返回顺序与请求顺序一致。
   */
  async translateBatch(value: unknown): Promise<BuddyTranslateBatchResult> {
    const parsed = buddyTranslateBatchRequestSchema.safeParse(value);
    if (!parsed.success) throw new Error("批量翻译请求无效");
    const req = parsed.data;
    const target = LOCALE_TO_ISO[req.targetLocale] ?? req.targetLocale.slice(0, 2);

    const skipped = new Map<string, BuddyTranslateBatchResult["items"][number]>();
    const pending: { id: string; text: string; source: string }[] = [];
    let latencyMs = 0;

    // 摘要和缓存按“段落 id”记录，网关只收到去重后的唯一文本。
    for (const item of req.items) {
      const source = detectBuddyTranslateSourceLanguage(item.text);
      if (!source || source.split("-")[0] === target.split("-")[0]) {
        skipped.set(item.id, { id: item.id, translated: item.text, model: "noop", latencyMs: 0 });
        continue;
      }
      const ck = this.#ck({ text: item.text, targetLocale: req.targetLocale });
      const cached = this.#cache.get(ck);
      if (cached && Date.now() - cached.ts < this.#ttl) {
        skipped.set(item.id, { id: item.id, ...cached.result });
        continue;
      }
      pending.push({ id: item.id, text: item.text, source });
    }

    if (pending.length > 0) {
      const unique = [...new Set(pending.map((p) => p.text))];
      const translated = await this.#requestGateway(unique, pending[0]?.source ?? "en", target);
      latencyMs = translated.latencyMs;
      const model = translated.model;
      for (const entry of pending) {
        const text = translated.texts[unique.indexOf(entry.text)] ?? "";
        const result = buddyTranslateResultSchema.parse({
          translated: text,
          model,
          latencyMs,
        });
        this.#remember(this.#ck({ text: entry.text, targetLocale: req.targetLocale }), result);
        skipped.set(entry.id, { id: entry.id, ...result });
      }
    }

    return buddyTranslateBatchResultSchema.parse({
      items: req.items.map(
        (item) =>
          skipped.get(item.id) ?? { id: item.id, translated: item.text, model: "noop", latencyMs },
      ),
    });
  }

  #remember(ck: string, result: BuddyTranslateResult): void {
    this.#cache.set(ck, { result, ts: Date.now() });
    if (this.#cache.size > 500) {
      for (const [k] of [...this.#cache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 100))
        this.#cache.delete(k);
    }
  }

  /** 一次网关请求翻译多个段落，返回的文本顺序与传入顺序一致，并保持网关错误语义。 */
  async #requestGateway(
    texts: string[],
    source: string,
    target: string,
  ): Promise<{ texts: string[]; model: string; latencyMs: number }> {
    if (texts.length === 0) return { texts: [], model: "noop", latencyMs: 0 };

    const cfg = await this.#config();
    if (!cfg) throw new Error("未配置网关");

    const t0 = Date.now();
    const signal = AbortSignal.timeout(15_000);
    let payload: unknown;
    try {
      payload = await gatewayJsonRequest(
        cfg.url,
        cfg.headers,
        { q: texts, source, target, format: "text" },
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
    const results = resp?.translations ?? [];
    if (results.length !== texts.length) throw new Error("翻译服务未返回结果");
    const textsOut = results.map((entry) => entry?.text ?? "");
    if (textsOut.some((text, index) => !text && (texts[index] ?? "").trim() !== "")) {
      throw new Error("翻译服务未返回结果");
    }

    return {
      texts: textsOut,
      model: `sub2api:${resp?.provider ?? "unknown"}`,
      latencyMs: Date.now() - t0,
    };
  }

  clearCache(): void {
    this.#cache.clear();
  }
}
