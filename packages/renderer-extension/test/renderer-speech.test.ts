import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingConfirmationRecord } from "../src/pending-confirmations-state.js";
import { createRendererSpeechAnnouncer } from "../src/renderer-speech.js";

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
    Audio: Reflect.get(globalThis, "Audio"),
  };
  FakeAudio.instances.length = 0;
  Reflect.set(globalThis, "document", {
    hidden: false,
    hasFocus: () => options.focused ?? true,
  });
  Reflect.set(globalThis, "Audio", FakeAudio);
  return () => {
    Reflect.set(globalThis, "document", previous.document);
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
    // A different Turn in the same Thread is a new announcement.
    announcer.announce({ ...entry("local", "结果"), turnId: "turn-b" });
    await vi.waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledTimes(2));
    announcer.dispose();
    restore();
  });

  it("replays on demand regardless of the preference and reports synthesis failures quietly", async () => {
    const restore = installGlobals();
    const failing = vi.fn(async () => {
      throw new Error("HTTP 404");
    });
    const announcer = createRendererSpeechAnnouncer(
      { getLocale: () => "en", getClient: () => ({ synthesizeSpeech: failing }) },
      () => false,
    );
    expect(() => announcer.replay(entry("local", "done"))).not.toThrow();
    await vi.waitFor(() => expect(failing).toHaveBeenCalledOnce());
    expect(FakeAudio.instances).toHaveLength(0);

    // A new announcement stops the previous audio so two summaries never overlap.
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
    playing.replay(entry("local", "first"));
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    playing.replay(entry("local", "second"));
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
    expect(FakeAudio.instances[1]?.src).toBe("data:audio/mpeg;base64,AAAA");
    playing.dispose();
    restore();
  });
});
