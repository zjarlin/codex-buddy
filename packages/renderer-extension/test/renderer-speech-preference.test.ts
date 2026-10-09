import { describe, expect, it } from "vitest";

import {
  RENDERER_SPEECH_CHANGE_EVENT,
  RENDERER_SPEECH_STORAGE_KEY,
  readRendererSpeechEnabled,
  writeRendererSpeechEnabled,
} from "../src/renderer-speech-preference.js";

function fixture(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(RENDERER_SPEECH_STORAGE_KEY, initial);
  const events: string[] = [];
  const owner = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  owner.addEventListener(RENDERER_SPEECH_CHANGE_EVENT, () => events.push("changed"));
  return { owner: owner as unknown as Window, values, events };
}

describe("Renderer speech preference", () => {
  it("defaults to disabled and requires explicit opt-in in the new preference", () => {
    const f = fixture();
    expect(readRendererSpeechEnabled(f.owner)).toBe(false);
    f.values.set("codexhost.speech-announcement.v1", "true");
    expect(readRendererSpeechEnabled(f.owner)).toBe(false);
    for (const raw of ["false", "1", "yes", "broken"]) {
      f.values.set(RENDERER_SPEECH_STORAGE_KEY, raw);
      expect(readRendererSpeechEnabled(f.owner)).toBe(false);
    }
    f.values.set(RENDERER_SPEECH_STORAGE_KEY, "true");
    expect(readRendererSpeechEnabled(f.owner)).toBe(true);
  });

  it("persists the switch and notifies the settings page", () => {
    const f = fixture();
    expect(writeRendererSpeechEnabled(f.owner, false)).toBe(true);
    expect(f.values.get(RENDERER_SPEECH_STORAGE_KEY)).toBe("false");
    expect(readRendererSpeechEnabled(f.owner)).toBe(false);
    expect(writeRendererSpeechEnabled(f.owner, true)).toBe(true);
    expect(readRendererSpeechEnabled(f.owner)).toBe(true);
    expect(f.events).toHaveLength(2);
  });

  it("stays disabled when the preference store is unavailable", () => {
    const owner = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    }) as unknown as Window;
    expect(readRendererSpeechEnabled(owner)).toBe(false);
    expect(writeRendererSpeechEnabled(owner, false)).toBe(false);
  });
});
