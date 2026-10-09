import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingConfirmationRecord } from "../src/pending-confirmations-state.js";
import { createRendererSpeechAnnouncer } from "../src/renderer-speech.js";
import {
  RENDERER_SPEECH_CHANGE_EVENT,
  RENDERER_SPEECH_STORAGE_KEY,
} from "../src/renderer-speech-preference.js";

class FakeAudio {
  static readonly instances: FakeAudio[] = [];
  readonly src: string;
  readonly listeners = new Map<string, () => void>();
  pauseCalls = 0;
  playCalls = 0;
  playResult: Promise<void> = Promise.resolve();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener);
  }

  removeAttribute(): void {}

  pause(): void {
    this.pauseCalls += 1;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    return this.playResult;
  }
}

function entry(hostId: string, summary: string): PendingConfirmationRecord {
  return {
    hostId,
    threadId: "thread-a",
    turnId: "turn-a",
    status: "completed",
    title: "Task A",
    summary,
    completedAt: 0,
    state: "pending",
    confirmedAt: null,
  };
}

function installGlobals(options: { focused?: boolean } = {}) {
  const previous = {
    document: Reflect.get(globalThis, "document"),
    window: Reflect.get(globalThis, "window"),
    Audio: Reflect.get(globalThis, "Audio"),
  };
  FakeAudio.instances.length = 0;
  Reflect.set(
    globalThis,
    "document",
    Object.assign(new EventTarget(), {
      hidden: false,
      hasFocus: () => options.focused ?? true,
    }),
  );
  Reflect.set(globalThis, "window", new EventTarget());
  Reflect.set(globalThis, "Audio", FakeAudio);
  return () => {
    Reflect.set(globalThis, "document", previous.document);
    Reflect.set(globalThis, "window", previous.window);
    Reflect.set(globalThis, "Audio", previous.Audio);
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Renderer speech announcement", () => {
  it("synthesizes a cleaned summary and plays the returned audio", async () => {
    const restore = installGlobals();
    const synthesizeSpeech = vi.fn(async () => ({
      audioBase64: "UklGRg==",
      format: "wav" as const,
      characters: 6,
      latencyMs: 12,
    }));
    const announcer = createRendererSpeechAnnouncer(
      { getLocale: () => "zh-CN", getClient: () => ({ synthesizeSpeech }) },
      () => true,
    );

    announcer.announce(entry("local", "# 完成\n\n```sh\nrm -rf /\n```\n结果是 **成功**。"));
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

    expect(synthesizeSpeech).toHaveBeenCalledWith({ text: "完成 结果是 成功。", locale: "zh-CN" });
    expect(FakeAudio.instances[0]?.src).toBe("data:audio/wav;base64,UklGRg==");
    expect(FakeAudio.instances[0]?.playCalls).toBe(1);
    announcer.dispose();
    restore();
  });

  it("stays silent when disabled, unfocused, or without a speech-capable client", async () => {
    const restore = installGlobals({ focused: false });
    const synthesizeSpeech = vi.fn();
    const enabled = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => ({ synthesizeSpeech }) },
      () => true,
    );
    enabled.announce(entry("local", "done"));
    expect(synthesizeSpeech).not.toHaveBeenCalled();

    const unfocusedRestore = installGlobals();
    const disabled = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => ({ synthesizeSpeech }) },
      () => false,
    );
    disabled.announce(entry("local", "done"));
    const missingClient = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => null },
      () => true,
    );
    missingClient.announce(entry("local", "done"));
    await Promise.resolve();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(0);
    unfocusedRestore();
    restore();
  });

  it("announces one Turn only once even when the completion notification repeats", async () => {
    const restore = installGlobals();
    const synthesizeSpeech = vi.fn(async () => ({
      audioBase64: "AAAA",
      format: "wav" as const,
      characters: 4,
      latencyMs: 3,
    }));
    const announcer = createRendererSpeechAnnouncer(
      { getLocale: () => "zh-CN", getClient: () => ({ synthesizeSpeech }) },
      () => true,
    );

    announcer.announce(entry("local", "结果"));
    announcer.announce(entry("local", "结果"));
    await vi.waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledOnce());
    // 同一会话的新回合可以重新播报。
    announcer.announce({ ...entry("local", "结果"), turnId: "turn-b" });
    await vi.waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledTimes(2));
    announcer.dispose();
    restore();
  });

  it("replays with automatic speech disabled and exposes synthesis failures", async () => {
    const restore = installGlobals();
    const failing = vi.fn(async () => {
      throw new Error("HTTP 404");
    });
    const announcer = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => ({ synthesizeSpeech: failing }) },
      () => false,
    );
    await expect(announcer.replay(entry("local", "done"))).rejects.toThrow("HTTP 404");
    expect(failing).toHaveBeenCalledOnce();
    expect(FakeAudio.instances).toHaveLength(0);

    // 手动重播停止此前音频，避免同一窗口的摘要重叠。
    const ok = vi.fn(async () => ({
      audioBase64: "AAAA",
      format: "mp3" as const,
      characters: 2,
      latencyMs: 1,
    }));
    const playing = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => ({ synthesizeSpeech: ok }) },
      () => true,
    );
    await playing.replay(entry("local", "first"));
    expect(FakeAudio.instances).toHaveLength(1);
    await playing.replay(entry("local", "second"));
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
    expect(FakeAudio.instances[1]?.src).toBe("data:audio/mpeg;base64,AAAA");
    playing.dispose();
    announcer.dispose();
    restore();
  });

  it("exposes playback rejection so the manual control can display it", async () => {
    const restore = installGlobals();
    vi.spyOn(FakeAudio.prototype, "play").mockRejectedValueOnce(new Error("NotAllowedError"));
    const announcer = createRendererSpeechAnnouncer(
      {
        getLocale: () => "en",
        getClient: () => ({
          synthesizeSpeech: async () => ({
            audioBase64: "AAAA",
            format: "wav",
            characters: 4,
            latencyMs: 1,
          }),
        }),
      },
      () => false,
    );
    await expect(announcer.replay(entry("local", "done"))).rejects.toThrow("NotAllowedError");
    expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
    announcer.dispose();
    restore();
  });

  it("cancels automatic synthesis on blur and stops automatic playback", async () => {
    const focus = { focused: true };
    const restore = installGlobals(focus);
    const result = { audioBase64: "AAAA", format: "wav" as const, characters: 4, latencyMs: 1 };
    let resolveSynthesis: (value: typeof result) => void = () => {};
    const synthesizeSpeech = vi.fn(
      () =>
        new Promise<typeof result>((resolve) => {
          resolveSynthesis = resolve;
        }),
    );
    const announcer = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => ({ synthesizeSpeech }) },
      () => true,
    );
    announcer.announce(entry("local", "first"));
    focus.focused = false;
    window.dispatchEvent(new Event("blur"));
    resolveSynthesis(result);
    await Promise.resolve();
    expect(FakeAudio.instances).toHaveLength(0);

    focus.focused = true;
    announcer.announce({ ...entry("local", "second"), turnId: "turn-b" });
    resolveSynthesis(result);
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    focus.focused = false;
    window.dispatchEvent(new Event("blur"));
    expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
    announcer.dispose();
    restore();
  });

  it("discards an older synthesis result when manual requests finish out of order", async () => {
    const restore = installGlobals();
    const result = { audioBase64: "AAAA", format: "wav" as const, characters: 4, latencyMs: 1 };
    const resolvers: ((value: typeof result) => void)[] = [];
    const announcer = createRendererSpeechAnnouncer(
      {
        getLocale: () => "en",
        getClient: () => ({
          synthesizeSpeech: () => new Promise<typeof result>((resolve) => resolvers.push(resolve)),
        }),
      },
      () => false,
    );
    const first = announcer.replay(entry("local", "first"));
    const second = announcer.replay(entry("local", "second"));
    resolvers[1]?.({ ...result, audioBase64: "BBBB" });
    await second;
    resolvers[0]?.(result);
    await first;
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0]?.src).toBe("data:audio/wav;base64,BBBB");
    announcer.dispose();
    restore();
  });

  it("stops automatic speech when the preference is disabled in either window", async () => {
    const restore = installGlobals();
    let enabled = true;
    const announcer = createRendererSpeechAnnouncer(
      {
        getLocale: () => "en",
        getClient: () => ({
          synthesizeSpeech: async () => ({
            audioBase64: "AAAA",
            format: "wav",
            characters: 4,
            latencyMs: 1,
          }),
        }),
      },
      () => enabled,
    );
    announcer.announce(entry("local", "first"));
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    enabled = false;
    window.dispatchEvent(new Event(RENDERER_SPEECH_CHANGE_EVENT));
    expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);

    enabled = true;
    announcer.announce({ ...entry("local", "second"), turnId: "turn-b" });
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    enabled = false;
    window.dispatchEvent(Object.assign(new Event("storage"), { key: RENDERER_SPEECH_STORAGE_KEY }));
    expect(FakeAudio.instances[1]?.pauseCalls).toBe(1);
    announcer.dispose();
    restore();
  });
});
