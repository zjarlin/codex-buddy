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
  it("defaults to enabled and only explicit false turns it off", () => {
    const f = fixture();
    expect(readRendererSpeechEnabled(f.owner)).toBe(true);
    for (const raw of ["true", "1", "yes", "broken"]) {
      f.values.set(RENDERER_SPEECH_STORAGE_KEY, raw);
      expect(readRendererSpeechEnabled(f.owner)).toBe(true);
    }
    f.values.set(RENDERER_SPEECH_STORAGE_KEY, "false");
    expect(readRendererSpeechEnabled(f.owner)).toBe(false);
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

  it("keeps the default on when the preference store is unavailable", () => {
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
    expect(readRendererSpeechEnabled(owner)).toBe(true);
    expect(writeRendererSpeechEnabled(owner, false)).toBe(false);
  });
});
