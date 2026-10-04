import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  buddyTranslateRequestSchema,
  buddyTranslateResultSchema,
  type BuddyTranslateRequest,
  type BuddyTranslateResult,
} from "@codexhost/shared-contracts";

// locale -> ISO 639-1（与 Sub2API langmap.go 对齐）
const LOCALE_TO_ISO: Record<string, string> = {
  "zh-CN": "zh-CN", "zh-TW": "zh-TW", "zh": "zh-CN",
  "en": "en", "ja": "ja", "ko": "ko",
  "fr": "fr", "de": "de", "es": "es", "ru": "ru",
  "pt": "pt", "it": "it", "th": "th", "vi": "vi",
  "id": "id", "ms": "ms", "ar": "ar", "hi": "hi",
};

function detectSourceLang(text: string): string {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const jp = text.match(/[\u3040-\u30ff]/g)?.length ?? 0;
  const kr = text.match(/[\uac00-\ud7af]/g)?.length ?? 0;
  const latin = text.match(/[a-zA-Z]/g)?.length ?? 0;
  if (jp > cjk && jp > latin) return "ja";
  if (kr > latin) return "ko";
  if (cjk > latin) return "zh-CN";
  return "en";
}

async function gatewayPost(
  url: URL, headers: Headers, body: unknown, signal: AbortSignal,
): Promise<unknown> {
  const payload = JSON.stringify(body);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(url, {
      method: "POST", agent: false, signal,
      headers: {
        ...Object.fromEntries(headers),
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks: Buffer[] = []; let len = 0;
      res.on("data", (c: Buffer) => {
        len += c.length;
        if (len > 1_048_576) { res.destroy(); reject(new Error("Too large")); }
        chunks.push(c);
      });
      res.on("error", () => reject(new Error("Read failed")));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error("Invalid JSON")); }
      });
    });
    req.on("error", (e) => reject(signal.aborted ? new Error("Aborted") : e));
    req.end(payload);
  });
}

/**
 * 翻译器调用 Sub2API 网关的 POST /api/v1/translate 接口。
 * 复用 Codex 网关凭据认证，后端服务商优先级：腾讯 > 百度 > 有道。
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
      .update(`${req.targetLocale}:${req.text.slice(0, 500)}`)
      .digest("hex").slice(0, 16);
  }

  async translate(value: unknown): Promise<BuddyTranslateResult> {
    const parsed = buddyTranslateRequestSchema.safeParse(value);
    if (!parsed.success) throw new Error("翻译请求无效");
    const req = parsed.data;

    const ck = this.#ck(req);
    const cached = this.#cache.get(ck);
    if (cached && Date.now() - cached.ts < this.#ttl) return cached.result;

    const cfg = await this.#config();
    if (!cfg) throw new Error("未配置网关");

    const target = LOCALE_TO_ISO[req.targetLocale] ?? req.targetLocale.slice(0, 2);
    const source = detectSourceLang(req.text);
    // 同源同目标直接跳过
    if (source === target) {
      const r = buddyTranslateResultSchema.parse({
        translated: req.text, model: "noop", latencyMs: 0,
      });
      this.#cache.set(ck, { result: r, ts: Date.now() });
      return r;
    }

    const t0 = Date.now();
    const resp = await gatewayPost(cfg.url, cfg.headers, {
      q: [req.text], source, target, format: "text",
    }, AbortSignal.timeout(15_000)) as {
      translations?: Array<{ text?: string; detected_language?: string }>;
      provider?: string;
    };

    const translated = resp.translations?.[0]?.text;
    if (!translated) throw new Error("翻译服务未返回结果");

    const result = buddyTranslateResultSchema.parse({
      translated,
      model: `sub2api:${resp.provider ?? "unknown"}`,
      latencyMs: Date.now() - t0,
    });

    this.#cache.set(ck, { result, ts: Date.now() });
    if (this.#cache.size > 500) {
      for (const [k] of [...this.#cache.entries()]
        .sort((a, b) => a[1].ts - b[1].ts).slice(0, 100))
        this.#cache.delete(k);
    }
    return result;
  }

  clearCache(): void { this.#cache.clear(); }
}
