import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

type TranslationFixtureWindow = Window & { requests: string[] };

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
import { installTranslateCards } from './packages/renderer-extension/src/translate-card/index.ts';
globalThis.requests = [];
installTranslateCards({ getLocale: () => 'zh-CN', getContext: () => ({
 threadId: 'thread', root: document.querySelector('main'), client: {
 translate: async ({ text }) => { globalThis.requests.push(text); return { translated: '中文：' + text, model: 'fixture', latencyMs: 1 }; }
 }
}) });`,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  write: false,
});

test("translates progress messages independently and refreshes changed text", async ({ page }) => {
  await page.setContent(`<main><section data-content-search-turn-key="turn">
<div data-response-annotation-conversation="thread" data-response-annotation-target="progress-1"><h4 class="sr-only">ChatGPT said:</h4><div data-markdown-text-style="assistant-message" class="_MarkdownRoot"><p>Let me inspect the actual server capacity before choosing a model.</p><pre>const command = "never translate code";</pre></div><div data-codexhost-turn-actions>提交代码</div></div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="progress-2"><div data-markdown-text-style="assistant-message" class="_MarkdownRoot"><p>Now let me check the adapter wiring and account state.</p></div></div>
</section></main>`);
  const source = outputFiles[0]?.text;
  if (!source) throw new Error("Translation fixture bundle unavailable");
  await page.addScriptTag({ content: source });
  await expect(page.locator('[data-state="completed"]')).toHaveCount(2);
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests.length),
  ).toBe(2);
  await page
    .locator("[data-response-annotation-conversation]")
    .first()
    .evaluate((node) => {
      const paragraph = node.querySelector("p");
      if (!paragraph) throw new Error("Progress paragraph unavailable");
      paragraph.textContent =
        "The server has enough capacity. Next I will verify the serving configuration.";
    });
  await expect(page.locator(".codexhost-translate-content").first()).toContainText(
    "The server has enough",
  );
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests.length),
  ).toBe(3);
  const requests = await page.evaluate(
    () => (window as unknown as TranslationFixtureWindow).requests,
  );
  expect(requests.every((text) => !text.includes("中文："))).toBe(true);
  expect(
    requests.every(
      (text) =>
        !text.includes("ChatGPT said:") &&
        !text.includes("never translate code") &&
        !text.includes("提交代码"),
    ),
  ).toBe(true);
});
