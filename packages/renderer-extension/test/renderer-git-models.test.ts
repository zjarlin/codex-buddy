import { afterEach, expect, test, vi } from "vitest";
import { cachedGitMessageModels } from "../src/renderer-git-models.js";
afterEach(() => vi.unstubAllGlobals());

test("prefers ask from the shared native catalog while respecting availability", () => {
  const models = [
    { id: "flash", label: "Fast" },
    { id: "ask", label: "Ask" },
    { id: "tts", label: "Audio" },
  ];
  expect(cachedGitMessageModels({ models })?.defaultModel).toBe("ask");
  const unavailable = cachedGitMessageModels({ models, unavailableModelIds: ["ask"] });
  expect(unavailable?.defaultModel).toBe("flash");
  expect(unavailable?.models.find((model) => model.id === "tts")?.eligible).toBe(false);
});

test("reuses custom favorites only when the native catalog supports custom model IDs", () => {
  vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify(["ask", "flash"]) } });
  const view = { models: [{ id: "flash", label: "Fast" }] };
  expect(cachedGitMessageModels(view)?.defaultModel).toBe("flash");
  const custom = cachedGitMessageModels({ ...view, supportsCustomModel: true });
  expect(custom?.defaultModel).toBe("ask");
  expect(custom?.models.every((model) => model.recommended)).toBe(true);
  expect(cachedGitMessageModels(undefined)).toBeNull();
});
