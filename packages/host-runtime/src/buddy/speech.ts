import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  BUDDY_SPEECH_AUDIO_MAX_BYTES,
  BUDDY_SPEECH_TEXT_MAX_CHARACTERS,
  buddySpeechRequestSchema,
  buddySpeechResultSchema,
  type BuddySpeechRequest,
  type BuddySpeechResult,
} from "@codexhost/shared-contracts";
import { gatewayJsonRequest } from "./gateway-request.js";

const SYNTHESIS_TIMEOUT_MS = 60_000;
/** 上游 JSON 的 base64 体积比音频本身大三分之一，读取上限按此放宽。 */
const RESPONSE_LIMIT_BYTES = Math.ceil(BUDDY_SPEECH_AUDIO_MAX_BYTES * 1.4);

/** UI 语言 -> 曼波 GPT-SoVITS 的 text_language；未知语言交给上游自动识别。 */
function synthesisLanguage(locale: string | undefined): string {
  if (!locale) return "auto";
  if (locale.startsWith("zh")) return "zh";
  if (locale.startsWith("en")) return "en";
  if (locale.startsWith("ja")) return "ja";
  if (locale.startsWith("ko")) return "ko";
  return "auto";
}

/**
 * 播报器调用 Sub2API 网关的 `POST /v1/media/tts`（曼波 / GPT-SoVITS），
 * 复用 Codex 网关凭据认证。返回 base64 音频，由 Renderer 负责播放；
 * 文本在发送前已截断，音频超过上限时直接判为不可播报，不返回残缺音频。
 */
export class BuddySpeech {
  readonly #home: string;

  constructor(private readonly environment: NodeJS.ProcessEnv) {
    this.#home = homePath(environment.CODEX_HOME);
  }

  async #config(): Promise<{ url: URL; headers: Headers } | null> {
    try {
      const connection = await readConnection(this.#home, this.environment);
      const url = new URL(connection.url);
      // connection.url 指向 `<网关根>/v1/models`，媒体入口与模型入口同根。
      url.pathname = url.pathname.replace(/\/models$/u, "/media/tts");
      return { url, headers: connection.headers };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("无法读取网关配置");
    }
  }

  async synthesize(value: unknown): Promise<BuddySpeechResult> {
    const parsed = buddySpeechRequestSchema.safeParse(value);
    if (!parsed.success) throw new Error("播报请求无效");
    const request: BuddySpeechRequest = parsed.data;
    const text = request.text
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, BUDDY_SPEECH_TEXT_MAX_CHARACTERS);
    if (!text) throw new Error("播报文本为空");

    const config = await this.#config();
    if (!config) throw new Error("未配置网关");

    const startedAt = Date.now();
    const response = (await gatewayJsonRequest(
      config.url,
      config.headers,
      {
        text,
        language: synthesisLanguage(request.locale),
        response_format: "wav",
        return_base64: true,
      },
      AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
      RESPONSE_LIMIT_BYTES,
    )) as { data?: Array<{ b64_json?: unknown }>; characters?: unknown };

    const audioBase64 = response.data?.[0]?.b64_json;
    if (typeof audioBase64 !== "string" || !audioBase64) throw new Error("语音服务未返回音频");
    // base64 长度为 4 的倍数，解码字节数约为其四分之三。
    if (Math.ceil((audioBase64.length * 3) / 4) > BUDDY_SPEECH_AUDIO_MAX_BYTES) {
      throw new Error("合成音频过大");
    }

    return buddySpeechResultSchema.parse({
      audioBase64,
      format: "wav",
      characters: text.length,
      latencyMs: Date.now() - startedAt,
    });
  }
}
