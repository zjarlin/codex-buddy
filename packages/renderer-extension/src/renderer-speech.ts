import {
  BUDDY_SPEECH_TEXT_MAX_CHARACTERS,
  type BuddySpeechResult,
} from "@codexhost/shared-contracts";

import type { PendingConfirmationRecord } from "./pending-confirmations-state.js";
import type { RendererModelClient } from "./renderer-model-client.js";

type SpeechClient = Pick<RendererModelClient, "synthesizeSpeech">;

export interface RendererSpeechOptions {
  getLocale(): string;
  getClient(hostId: string): SpeechClient | null;
}

export interface RendererSpeechAnnouncer {
  /** 为一次完成通知播报摘要；未开启、不可见或已不可用时静默跳过。 */
  announce(entry: PendingConfirmationRecord): void;
  /** 用户手动重播：不受开关与窗口焦点限制。 */
  replay(entry: PendingConfirmationRecord): void;
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
 * 同一时间只播一条：新播报会停掉上一条；合成或播放失败都不打断用户工作。
 */
export function createRendererSpeechAnnouncer(
  options: RendererSpeechOptions,
  isEnabled: () => boolean,
): RendererSpeechAnnouncer {
  let audio: HTMLAudioElement | null = null;
  let generation = 0;
  let disposed = false;
  const announced = new Map<string, true>();

  const stop = (): void => {
    generation += 1;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio = null;
  };

  const play = (result: BuddySpeechResult): void => {
    stop();
    const version = generation;
    const element = new Audio(dataUrl(result));
    audio = element;
    element.addEventListener("ended", () => {
      if (version === generation && audio === element) audio = null;
    });
    void element.play().catch(() => {
      if (version === generation && audio === element) audio = null;
    });
  };

  const run = async (entry: PendingConfirmationRecord): Promise<void> => {
    const text = spokenText(entry.summary);
    if (!text) return;
    const client = options.getClient(entry.hostId);
    if (!client?.synthesizeSpeech) return;
    const version = generation;
    const result = await client.synthesizeSpeech({ text, locale: options.getLocale() });
    if (disposed || version !== generation) return;
    play(result);
  };

  const speak = (entry: PendingConfirmationRecord): void => {
    void run(entry).catch(() => {
      /* 网关未启用媒体或合成失败时保持静默，不改变完成提醒本身。 */
    });
  };

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
      speak(entry);
    },
    // 手动重播来自用户点击完成弹窗，不受开关与焦点限制。
    replay(entry) {
      if (disposed) return;
      speak(entry);
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
