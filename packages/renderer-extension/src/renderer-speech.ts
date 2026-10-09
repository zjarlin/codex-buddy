import {
  BUDDY_SPEECH_TEXT_MAX_CHARACTERS,
  type BuddySpeechResult,
} from "@codexhost/shared-contracts";

import type { PendingConfirmationRecord } from "./pending-confirmations-state.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import {
  RENDERER_SPEECH_CHANGE_EVENT,
  RENDERER_SPEECH_STORAGE_KEY,
} from "./renderer-speech-preference.js";

type SpeechClient = Pick<RendererModelClient, "synthesizeSpeech">;

export interface RendererSpeechOptions {
  getLocale(): string;
  getClient(hostId: string): SpeechClient | null;
}

export interface RendererSpeechAnnouncer {
  /** 为一次完成通知播报摘要；未开启、不可见或已不可用时静默跳过。 */
  announce(entry: PendingConfirmationRecord): void;
  /** 用户手动重播：不受开关与窗口焦点限制。 */
  replay(entry: PendingConfirmationRecord): Promise<void>;
  dispose(): void;
}

/** 摘要来自 Markdown 文本，播报前去掉标记与代码块，避免念出符号。 */
function spokenText(summary: string): string {
  return summary
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(?:[#>*-]+|\d+\.)\s+/gmu, "")
    .replace(/[*_~|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, BUDDY_SPEECH_TEXT_MAX_CHARACTERS);
}

/** 同一条完成通知重复到达时只播一次；上限按最近 500 条完成通知去重。 */
const ANNOUNCED_LIMIT = 500;

function announcementKey(entry: PendingConfirmationRecord): string {
  return `${entry.hostId}\u0000${entry.threadId}\u0000${entry.turnId}`;
}

function dataUrl(result: BuddySpeechResult): string {
  return `data:audio/${result.format === "mp3" ? "mpeg" : "wav"};base64,${result.audioBase64}`;
}

/**
 * 完成播报只调用 Host 的网关语音合成，再由本模块播放音频。
 * 同一窗口只播一条，最新请求替换此前音频与尚未完成的合成。
 * 自动播报在失焦时取消；手动重播将合成和播放错误交给卡片显示。
 */
export function createRendererSpeechAnnouncer(
  options: RendererSpeechOptions,
  isEnabled: () => boolean,
): RendererSpeechAnnouncer {
  let audio: HTMLAudioElement | null = null;
  let generation = 0;
  let disposed = false;
  let automaticPlayback = false;
  const announced = new Map<string, true>();

  const stop = (): void => {
    generation += 1;
    automaticPlayback = false;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio = null;
  };

  const run = async (entry: PendingConfirmationRecord, automatic: boolean): Promise<void> => {
    stop();
    const version = generation;
    automaticPlayback = automatic;
    const chinese = options.getLocale().startsWith("zh");
    const text = spokenText(entry.summary);
    if (!text) throw new Error(chinese ? "没有可播报的摘要。" : "No summary to read aloud.");
    const client = options.getClient(entry.hostId);
    if (!client?.synthesizeSpeech) {
      throw new Error(
        chinese ? "当前 Host 不支持语音播报。" : "This Host does not support speech.",
      );
    }
    try {
      const result = await client.synthesizeSpeech({ text, locale: options.getLocale() });
      if (disposed || version !== generation) return;
      if (automatic && (!isEnabled() || document.hidden || !document.hasFocus())) return;
      const element = new Audio(dataUrl(result));
      audio = element;
      element.addEventListener("ended", () => {
        if (audio === element) audio = null;
      });
      await element.play();
    } catch (error) {
      if (disposed || version !== generation) return;
      stop();
      throw error;
    }
  };

  const onBlur = (): void => {
    if (automaticPlayback && (document.hidden || !document.hasFocus())) stop();
  };
  const onPreferenceChanged = (): void => {
    if (automaticPlayback && !isEnabled()) stop();
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key === RENDERER_SPEECH_STORAGE_KEY) onPreferenceChanged();
  };
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onBlur);
  window.addEventListener(RENDERER_SPEECH_CHANGE_EVENT, onPreferenceChanged);
  window.addEventListener("storage", onStorage);

  return {
    announce(entry) {
      if (disposed || !isEnabled()) return;
      // 与完成弹窗一致：只有用户正看着应用时才出声。
      if (document.hidden || !document.hasFocus()) return;
      const key = announcementKey(entry);
      if (announced.has(key)) return;
      announced.set(key, true);
      while (announced.size > ANNOUNCED_LIMIT) {
        const oldest = announced.keys().next().value;
        if (oldest === undefined) break;
        announced.delete(oldest);
      }
      void run(entry, true).catch((error: unknown) => {
        console.warn("[codexhost] Speech announcement failed", error);
      });
    },
    // 手动重播来自用户点击完成弹窗，不受开关与焦点限制。
    replay(entry) {
      if (disposed) return Promise.resolve();
      return run(entry, false);
    },
    dispose() {
      disposed = true;
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
      window.removeEventListener(RENDERER_SPEECH_CHANGE_EVENT, onPreferenceChanged);
      window.removeEventListener("storage", onStorage);
      stop();
    },
  };
}
