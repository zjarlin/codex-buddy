import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

type TranslationFixtureWindow = Window & { requests: string[] };

const commands = `Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 22,5985 } | Select LocalAddress
Get-NetFirewallProfile | Select Name,Enabled,DefaultInboundAction`;
const nativeCode = `<div data-markdown-copy="code-block"><div data-markdown-copy="exclude">powershell <button>Copy code</button></div><div><code>${commands}</code></div></div>`;
const english = "Check which services are listening before changing the firewall rules.";
const chineseTechnical =
  "3D 是「Qt 宿主 + Web(Three.js) 应用」。拉 RWebThree.dll / ShapeWebThree.dll 与 webview-vs、样例 web3d 资源。";

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
import { installTranslateCards } from './packages/renderer-extension/src/translate-card/index.ts';
globalThis.requests = [];
globalThis.pending = [];
document.querySelector('[data-fixture-action="progress"]')?.addEventListener('click', () => {
 document.querySelector('main p').textContent = 'The server has enough capacity. Next I will verify the serving configuration.';
});
document.querySelector('[data-fixture-action="code"]')?.addEventListener('click', () => {
 document.querySelector('[data-markdown-text-style="assistant-message"]').innerHTML = ${JSON.stringify(nativeCode)};
});
document.querySelector('[data-fixture-action="chinese"]')?.addEventListener('click', () => {
 document.querySelector('[data-markdown-text-style="assistant-message"]').innerHTML = '<p>' + ${JSON.stringify(chineseTechnical)} + '</p>' + ${JSON.stringify(nativeCode)};
});
document.querySelector('[data-fixture-action="resolve"]')?.addEventListener('click', () => {
 for (const resolve of globalThis.pending.splice(0)) resolve({ translated: '过期译文', model: 'fixture', latencyMs: 1 });
});
installTranslateCards({ getLocale: () => 'zh-CN', getContext: () => ({
 threadId: 'thread', root: document.querySelector('main'), client: {
 translate: async ({ text }) => {
  globalThis.requests.push(text);
  const reply = globalThis.fixtureReplies?.shift();
  if (reply?.pending) return new Promise(resolve => globalThis.pending.push(resolve));
  if (reply && 'rpcError' in reply) throw { code: -32603, message: reply.rpcError };
  if (reply && 'error' in reply) throw new Error(reply.error);
  return { translated: '中文：' + text, model: 'fixture', latencyMs: 1 };
 }
 }
}) });`,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  write: false,
});

async function startFixture(
  page: Page,
  replies: Array<{ error?: string; rpcError?: string; pending?: boolean }> = [],
) {
  const source = outputFiles[0]?.text;
  if (!source) throw new Error("Translation fixture bundle unavailable");
  await page.addScriptTag({ content: `globalThis.fixtureReplies = ${JSON.stringify(replies)};` });
  await page.addScriptTag({ content: source });
}

async function setMessage(page: Page, content: string) {
  await page.setContent(`<style>body { font: 14px sans-serif; padding: 24px; } main { max-width: 680px; } [data-markdown-copy="code-block"] { background: #f3f4f6; padding: 12px; } code { display: block; white-space: pre-wrap; } aside { margin-top: 24px; } .sr-only { display: none; }</style>
<main><section data-content-search-turn-key="turn"><div data-response-annotation-conversation="thread" data-response-annotation-target="message"><div data-markdown-text-style="assistant-message">${content}</div></div></section></main>
<aside><button data-fixture-action="code">更新为代码</button><button data-fixture-action="chinese">更新为中文说明和代码</button><button data-fixture-action="resolve">完成旧请求</button></aside>`);
}

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test("translates progress messages independently and refreshes changed text", async ({
  page,
}, testInfo) => {
  await page.setContent(`<main><section data-content-search-turn-key="turn">
<div data-response-annotation-conversation="thread" data-response-annotation-target="progress-1"><h4 class="sr-only">ChatGPT said:</h4><div data-markdown-text-style="assistant-message" class="_MarkdownRoot"><p>Let me inspect the actual server capacity before choosing a model.</p><pre>const command = "never translate code";</pre></div><div data-codexhost-turn-actions>提交代码</div></div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="progress-2"><div data-markdown-text-style="assistant-message" class="_MarkdownRoot"><p>Now let me check the adapter wiring and account state.</p></div></div>
</section></main><button data-fixture-action="progress">更新进度</button>`);
  await startFixture(page);
  await expect(page.locator('[data-state="completed"]')).toHaveCount(2);
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests.length),
  ).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("progress-before.png") });
  await page.getByRole("button", { name: "更新进度" }).click();
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
  await page.screenshot({ path: testInfo.outputPath("progress-updated.png") });
});

test("skips native code and translates only English prose", async ({ page }, testInfo) => {
  await page.setContent(`<style>body { font: 14px sans-serif; padding: 24px; } code { display: block; white-space: pre-wrap; } [data-markdown-copy="code-block"] { background: #f3f4f6; padding: 8px; } main { max-width: 680px; }</style>
<main><section data-content-search-turn-key="turn">
<div data-response-annotation-conversation="thread" data-response-annotation-target="code">${nativeCode}</div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="chinese"><p>请先检查服务监听状态，再确认防火墙的入站规则。</p>${nativeCode}</div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="english"><p>${english}</p>${nativeCode}</div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="pre"><pre>${commands}</pre></div>
</section></main>`);
  await startFixture(page);
  await expect(page.locator('[data-state="completed"]')).toHaveCount(1);
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
  ).toEqual([english]);
  for (const target of ["code", "chinese", "pre"]) {
    await expect(
      page.locator(`[data-response-annotation-target="${target}"] [data-codexhost-translate]`),
    ).toHaveCount(0);
  }
  for (const code of await page.locator("code").all()) {
    expect(await code.textContent()).toBe(commands);
  }
  await page.screenshot({ path: testInfo.outputPath("native-code-skipped.png"), fullPage: true });
});

test("skips Chinese explanations with inline APIs, filenames and long paths", async ({
  page,
}, testInfo) => {
  await page.setContent(`<main><section data-content-search-turn-key="turn">
<div data-response-annotation-conversation="thread" data-response-annotation-target="plain"><p>${chineseTechnical}</p></div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="inline"><p>决定性发现：<code>RWebThree</code> 是 <code>QWebEngineView</code> 子类，即 3D 组件 = Qt WebEngine 载入 HTML(Three.js) 页面，C++↔JS 走 QWebChannel：</p><ul><li><code>runScript(QString,bool) -&gt; QVariant</code>（执行 JS 取回值）、<code>exeScript(QString)</code></li><li><code>setUrl/url/reload</code>、<code>onInit/onLoaded/onStartLoad/checkHealth/handleCrash/timerEvent</code></li><li>资源：<code>/qwebchannel.js</code>、<code>/3rdparty/marked.min.js</code></li></ul><p>反编译 OnInit / runScript 看它载入哪个页面与 JS 接口名。</p></div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="path"><p>请检查 <code>/${"very-long-path/".repeat(100)}QWebEngineView.js</code> 的加载状态。</p></div>
<div data-response-annotation-conversation="thread" data-response-annotation-target="references"><p><code>runScript(QString,bool)</code> <code>/qwebchannel.js</code> <code>/3rdparty/marked.min.js</code></p></div>
</section></main>`);
  await startFixture(page);
  await page.waitForTimeout(2200);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
  ).toEqual([]);
  await expect(page.locator("[data-codexhost-translate]")).toHaveCount(0);
  await expect(page.locator("code").first()).toHaveText("RWebThree");
  await page.screenshot({
    path: testInfo.outputPath("chinese-technical-skipped.png"),
    fullPage: true,
  });
});

test("translates English prose with Chinese labels and preserves inline references", async ({
  page,
}, testInfo) => {
  const expected =
    "Check the setting labelled 中文 before loading QWebEngineView and calling runScript(QString,bool).";
  await setMessage(
    page,
    "<p>Check the setting labelled <code>中文</code> before loading <code>QWebEngineView</code> and calling <code>runScript(QString,bool)</code>.</p>",
  );
  await startFixture(page);
  await expect(page.locator('[data-state="completed"]')).toHaveCount(1);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
  ).toEqual([expected]);
  await page.screenshot({ path: testInfo.outputPath("english-with-references.png") });
});

test("shows a specific error as text and retries only on click", async ({ page }, testInfo) => {
  const reason =
    '翻译服务返回 HTTP 503：Provider unavailable <img src=x onerror="alert(1)">（请求 ID：fixture-123）\n' +
    "详细原因".repeat(180);
  await setMessage(page, `<p>${english}</p>`);
  await startFixture(page, [{ error: reason }]);
  await expect(page.locator('[data-state="error"]')).toBeVisible();
  await expect(page.locator(".codexhost-translate-error-detail")).toBeHidden();
  await page.getByText("查看失败原因", { exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(reason);
  await expect(page.locator(".codexhost-translate-error-detail img")).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
  ).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("error-detail.png") });
  await page.getByText("查看失败原因", { exact: true }).click();
  await expect(page.locator(".codexhost-translate-error-detail")).toBeHidden();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator('[data-state="completed"]')).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
  ).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath("retry-completed.png") });
});

test("preserves JSON-RPC error messages across the Host boundary", async ({ page }, testInfo) => {
  await setMessage(page, `<p>${english}</p>`);
  await startFixture(page, [{ rpcError: "翻译请求超时（15 秒），网关未及时返回结果" }]);
  await page.getByText("查看失败原因", { exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("翻译请求超时（15 秒），网关未及时返回结果");
  await page.screenshot({ path: testInfo.outputPath("rpc-error-detail.png") });
});

test("explains when the service provides no reason", async ({ page }, testInfo) => {
  await setMessage(page, `<p>${english}</p>`);
  await startFixture(page, [{ error: "" }]);
  await page.getByText("查看失败原因", { exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("翻译服务未提供具体错误原因。");
  await page.screenshot({ path: testInfo.outputPath("unknown-error.png") });
});

for (const state of ["pending", "error", "completed"] as const) {
  test(`removes ${state} cards when prose becomes Chinese with code`, async ({
    page,
  }, testInfo) => {
    await setMessage(page, `<p>${english}</p>`);
    await startFixture(page, [
      state === "pending"
        ? { pending: true }
        : state === "error"
          ? { error: "翻译请求超时（15 秒）" }
          : {},
    ]);
    await expect(
      page.locator(`[data-state="${state === "pending" ? "loading" : state}"]`),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("before-change.png") });
    await page.getByRole("button", { name: "更新为中文说明和代码", exact: true }).click();
    await expect(page.locator("[data-codexhost-translate]")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("card-removed.png") });
    if (state === "pending") {
      await page.getByRole("button", { name: "完成旧请求", exact: true }).click();
      await page.waitForTimeout(1200);
      await expect(page.locator("[data-codexhost-translate]")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("late-response-ignored.png") });
    }
    expect(
      await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
    ).toHaveLength(1);
  });
}

test("removes a completed card when prose becomes code only", async ({ page }, testInfo) => {
  await setMessage(page, `<p>${english}</p>`);
  await startFixture(page);
  await expect(page.locator('[data-state="completed"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("before-code.png") });
  await page.getByRole("button", { name: "更新为代码", exact: true }).click();
  await expect(page.locator("[data-codexhost-translate]")).toHaveCount(0);
  expect(await page.locator("code").textContent()).toBe(commands);
  expect(
    await page.evaluate(() => (window as unknown as TranslationFixtureWindow).requests),
  ).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("code-only.png") });
});
