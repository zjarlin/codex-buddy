import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homePath, readConnection } from "@codexhost/buddy-engine";
import { noul, TypeSafeClient } from "@codexhost/jev";
import {
  buddyTranslateRequestSchema,
  buddyTranslateResultSchema,
  type BuddyTranslateRequest,
  type BuddyTranslateResult,
} from "@codexhost/shared-contracts";
import { privateJson } from "./private-transport.js";
import { createJevClient } from "./judgment.js";

/**
 * 翻译器使用两步策略：
 * 1. Laya 快速判断文本是否主要为英文（需要翻译到中文 UI）
 * 2. 若需要翻译，使用 Codex 当前网关的 q3 模型执行翻译
 *
 * 不调用公共翻译服务，不消耗 GPT/Claude token。
 */
export class BuddyTranslator {
  readonly #cache = new Map<string, { result: BuddyTranslateResult; timestamp: number }>();
  readonly #cacheTtlMs = 24 * 60 * 60 * 1000;
  readonly #home: string;
  readonly #environment: NodeJS.ProcessEnv;
  #jevClient: TypeSafeClient | null = null;
  #jevLoaded = false;

  constructor(environment: NodeJS.ProcessEnv) {
    this.#home = homePath(environment.CODEX_HOME);
    this.#environment = environment;
  }

  async #loadJevClient(): Promise<TypeSafeClient | null> {
    if (this.#jevLoaded) return this.#jevClient;
    this.#jevLoaded = true;
    try {
      const raw = JSON.parse(await readFile(join(this.#home, "buddy-jev.json"), "utf8"));
      const apiKey = typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
      const baseURL = typeof raw?.baseURL === "string" ? raw.baseURL.trim() : "";
      this.#jevClient = createJevClient(this.#environment, {
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      });
    } catch {
      this.#jevClient = createJevClient(this.#environment, {});
    }
    return this.#jevClient;
  }

  /**
   * 用 Laya 判断文本是否主要为英文、需要翻译到目标语言。
   * 返回 true 表示需要翻译，false 表示不需要（已经是目标语言或无法判断）。
   */
  async #needsTranslation(text: string, targetLocale: string): Promise<boolean> {
    // 目标不是中文时暂不支持（目前只处理 en→zh-CN）
    if (!targetLocale.startsWith("zh")) return false;

    const client = await this.#loadJevClient();
    if (!client) return false;

    try {
      const result = await client.systemOne(
        {
          model: "laya",
          state: text.slice(0, 4000),
          questions: {
            isEnglish: noul("这段文本的主要语言是否为英文？"),
          },
        },
        { timeout: 3000 },
      );
      // Laya 判定为英文的概率 > 0.6 则认为需要翻译
      return (result.answers.isEnglish.noul ?? 0) > 0.6;
    } catch {
      // Laya 不可用时回退到简单字符检测
      return this.#fallbackDetectEnglish(text);
    }
  }

  /** Laya 不可用时的兜底检测：拉丁字母占比 > 50% 视为英文 */
  #fallbackDetectEnglish(text: string): boolean {
    const latin = text.match(/[a-zA-Z]/g)?.length ?? 0;
    return latin / Math.max(text.length, 1) > 0.5;
  }

  /**
   * 使用 Codex 当前网关的 q3 模型执行翻译。
   * 复用隐私模式的网关凭据和连接配置。
   */
  async #translateWithQ3(text: string, targetLocale: string): Promise<{ translated: string; model: string }> {
    const config = await this.#readGatewayConfig();
    if (!config) throw new Error("未配置 Codex 网关；无法翻译。");

    const completionUrl = new URL(config.url);
    completionUrl.pathname = completionUrl.pathname.replace(/\/models$/u, "/chat/completions");

    // 优先 q3-14b，回退 q3-4b
    const models = ["q3-14b", "q3-4b"] as const;
    let lastError: Error | null = null;

    for (const model of models) {
      try {
        const response = await privateJson(completionUrl, config.headers, AbortSignal.timeout(30_000), {
          model,
          messages: [
            {
              role: "system",
              content: `你是专业翻译。将用户输入的英文翻译为简体中文。保留原文的 Markdown 格式、代码块和技术术语。只输出译文，不要解释。`,
            },
            { role: "user", content: text },
          ],
          stream: false,
          store: false,
          max_tokens: 8192,
        }) as { choices?: Array<{ message?: { content?: string } }> };

        const translated = response.choices?.[0]?.message?.content?.trim();
        if (!translated) throw new Error("翻译结果为空");
        return { translated, model };
      } catch (e) {
        lastError = e as Error;
      }
    }
    throw new Error(`q3 翻译失败: ${lastError?.message ?? "unknown"}`);
  }

  async #readGatewayConfig(): Promise<{ url: URL; headers: Headers } | null> {
    try {
      const connection = await readConnection(this.#home, this.#environment);
      return { url: connection.url, headers: connection.headers };
    } catch {
      return null;
    }
  }

  #cacheKey(req: BuddyTranslateRequest): string {
    return createHash("sha256")
      .update(`${req.targetLocale}:${req.text.slice(0, 500)}`)
      .digest("hex")
      .slice(0, 16);
  }

  async translate(value: unknown): Promise<BuddyTranslateResult> {
    const parsed = buddyTranslateRequestSchema.safeParse(value);
    if (!parsed.success) throw new Error("翻译请求无效");
    const req = parsed.data;

    const cacheKey = this.#cacheKey(req);
    const cached = this.#cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.#cacheTtlMs) return cached.result;

    const startTime = Date.now();

    // 第一步：Laya 判断是否需要翻译
    const needsTrans = await this.#needsTranslation(req.text, req.targetLocale);
    if (!needsTrans) {
      const result = buddyTranslateResultSchema.parse({
        translated: req.text,
        model: "noop",
        latencyMs: Date.now() - startTime,
      });
      this.#cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    // 第二步：q3 执行翻译
    const { translated, model } = await this.#translateWithQ3(req.text, req.targetLocale);
    const result = buddyTranslateResultSchema.parse({
      translated,
      model,
      latencyMs: Date.now() - startTime,
    });

    this.#cache.set(cacheKey, { result, timestamp: Date.now() });
    if (this.#cache.size > 500) {
      const oldest = [...this.#cache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100);
      for (const [k] of oldest) this.#cache.delete(k);
    }
    return result;
  }

  clearCache(): void {
    this.#cache.clear();
  }
}
