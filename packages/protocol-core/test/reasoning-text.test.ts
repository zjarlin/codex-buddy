import { describe, expect, it } from "vitest";

import { appendReasoningDisplayText, reasoningDisplayText } from "../src/reasoning-text.js";

describe("incremental Reasoning text", () => {
  it.each(["", "\r\n", "First\nSecond\r\n", "Last \n", "Last\u2028"])(
    "preserves full-text normalization for %j",
    (text) => {
      expect(reasoningDisplayText(text)).toBe(text.replace(/[\r\n]+$/u, ""));
    },
  );

  it("preserves a large internal newline run without treating it as a suffix", () => {
    const text = "\n".repeat(100_000) + "Last";
    expect(reasoningDisplayText(text)).toBe(text);
    expect(reasoningDisplayText(text + "\r\n")).toBe(text);
  });

  it.each(["", "\r\n", "Initial\r\n", "Initial", "\n\nInitial\n"])(
    "matches full-text normalization with initial text %j",
    (initial) => {
      let raw = initial;
      let visible = reasoningDisplayText(initial);
      let trailing = initial.slice(visible.length);
      const chunks = ["", "\n", "\r", "\n", "Next\r\n", "\n", " ", "中文", "\r", "Last\n"];
      for (const text of chunks) {
        const result = appendReasoningDisplayText(trailing, text);
        raw += text;
        visible += result.delta;
        trailing = result.trailingLineBreaks;
        expect(visible).toBe(reasoningDisplayText(raw));
        expect(visible + trailing).toBe(raw);
      }
    },
  );

  it("normalizes only the new fragment after a large pending newline suffix", () => {
    const trailing = "\r\n".repeat(100_000);
    expect(appendReasoningDisplayText(trailing, "\n")).toEqual({
      delta: "",
      trailingLineBreaks: trailing + "\n",
    });
    expect(appendReasoningDisplayText(trailing, "Next\n")).toEqual({
      delta: trailing + "Next",
      trailingLineBreaks: "\n",
    });
  });
});
