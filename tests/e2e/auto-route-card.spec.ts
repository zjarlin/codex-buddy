import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { installAutoRouteCards } from './packages/renderer-extension/src/auto-route-card/index.ts';
      const config = globalThis.fixtureConfig;
      let threadId = config.threadId;
      let hostId = 'ssh:252';
      let state = config.state || 'completed';
      let version = 1;
      let pending = null;
      let failed = false;
      let selectedModel = config.selectedModel;
      const route = () => ({
        request_id: '019ccb31-9520-7120-bc17-556e9a92d861', session_id: config.threadId, turn_id: 'turn-1',
        requested_model: 'auto', selected_model: 'model-first',
        ...(state === 'selected' ? {} : { resolved_model: config.model || 'gpt-5.6' }),
        attempted_models: ['model-first', 'gpt-5.6'], state, started_at: 1790651972645, updated_at: version,
        ...(config.candidates ? { candidates: config.candidates } : {}),
      });
      globalThis.calls = [];
      const client = { readAutoModelRoutes: async (id) => {
        globalThis.calls.push({ id, hostId });
        if (failed) throw new Error('provider offline');
        if (config.mode === 'failure') throw new Error('provider offline');
        if (config.mode === 'pending' && !pending) return new Promise((resolve) => { pending = resolve; });
        if (hostId !== 'ssh:252') return { supported: true, routes: [] };
        if (config.mode === 'empty') return { supported: true, routes: [] };
        if (config.unavailableReason) return { supported: false, routes: [], unavailableReason: config.unavailableReason };
        return { supported: config.mode !== 'unsupported', routes: config.mode === 'unsupported' ? [] : [route(), route()] };
      } };
      const cards = installAutoRouteCards({ getLocale: () => 'zh-CN', getContext: () => ({
        threadId, hostId, client, root: document.querySelector('main'),
        composer: document.querySelector('#composer'), selectedModel,
      }) });
      document.querySelector('#switch').onclick = () => { hostId = 'ssh:other'; };
      document.querySelector('#late').onclick = () => pending?.({ supported: true, routes: [route()] });
      document.querySelector('#complete').onclick = () => { state = 'completed'; version++; };
      document.querySelector('#failure').onclick = () => { failed = true; };
      document.querySelector('#dispose').onclick = () => cards.dispose();
      document.querySelector('#remount').onclick = () => document.querySelector('[data-response-annotation-conversation]').replaceChildren(document.createTextNode('Remounted answer'));
      document.querySelector('#model').onchange = (event) => { selectedModel = event.target.value; };
      document.querySelector('#response').onclick = () => {
        const response = document.createElement('div');
        response.dataset.responseAnnotationConversation = threadId;
        response.textContent = 'Native reply';
        document.querySelector('[data-content-search-turn-key]').append(response);
      };
    `,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2024",
  write: false,
});
const bundle = (() => {
  const source = outputFiles[0]?.text;
  if (!source) throw new Error("Auto route card fixture did not build");
  return source;
})();

async function setup(page: Page, config: Record<string, unknown> = {}, dark = false) {
  await page.setContent(`<!doctype html><html style="color-scheme:${dark ? "dark" : "light"}"><head><style>
    *{box-sizing:border-box} body{margin:0;background:${dark ? "#18191b" : "#fff"};color:${dark ? "#eee" : "#26282b"};font:14px/1.6 system-ui}
    main{max-width:720px;margin:32px auto;padding:0 20px} header{padding:12px 20px;border-bottom:1px solid #8883;font-weight:600}
    .user{padding:12px 0 20px;text-align:right}.answer{line-height:1.8}nav{margin:28px 0;display:flex;gap:8px;flex-wrap:wrap}nav button{padding:4px 8px}
    </style></head><body><header>Codex Buddy</header><main><div class="user">检查 Auto 模型回退逻辑，并修复工具调用兼容性。</div>
    <section data-turn-key="history-content:turn:turn-1"><div data-content-search-turn-key="turn-1" style="display:contents">${config.noResponse ? "" : `<div data-response-annotation-conversation="${threadId}"><div class="answer">已检查候选模型和工具调用配置。当前请求已完成模型回退，下面是检查结果。</div></div>`}</div></section>
    <section data-turn-key="unrelated"><div data-response-annotation-conversation="other-thread">另一条消息</div></section>
    <div id="composer"><label>Model <select id="model"><option value="auto">auto</option><option value="fixed">fixed</option></select></label><textarea aria-label="Message"></textarea></div>
    <nav><button id="switch">Switch Host</button><button id="late">Deliver late result</button><button id="complete">Complete</button><button id="failure">Provider offline</button><button id="remount">Remount turn</button><button id="response">Show reply</button><button id="dispose">Dispose</button></nav></main></body></html>`);
  await page.evaluate((value) => Reflect.set(globalThis, "fixtureConfig", value), {
    threadId,
    ...config,
  });
  await page.addScriptTag({ content: bundle });
}

for (const dark of [false, true]) {
  test(`prominent ${dark ? "dark" : "light"} card shows actual model and fallback detail`, async ({
    page,
  }) => {
    await setup(page, {}, dark);
    const card = page.getByRole("complementary", { name: "Auto routed" });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("gpt-5.6");
    await expect(card).toContainText("已完成");
    await expect(card).toContainText("1 次请求");
    await expect(card).toContainText("1 次回退");
    await page.getByRole("button", { name: "路由详情" }).click();
    await expect(card.locator("ol")).toBeVisible();
    await expect(card.locator("ol")).toContainText("model-first → gpt-5.6");
    await page.screenshot({
      path: test.info().outputPath(`auto-routed-${dark ? "dark" : "light"}.png`),
    });
    await card.screenshot({
      path: test.info().outputPath(`auto-routed-card-${dark ? "dark" : "light"}.png`),
    });
    await page.getByRole("button", { name: "Remount turn" }).click();
    await expect(card).toHaveCount(1);
    await page.getByRole("button", { name: "Switch Host" }).click();
    await expect(card).toHaveCount(0);
  });
}

test("narrow viewport wraps a long model identifier and failed state", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(
    page,
    {
      state: "failed",
      model: "vendor/very-long-model-name-with-tool-support-2026-instruct-production",
    },
    true,
  );
  const card = page.getByRole("complementary", { name: "Auto routed" });
  await expect(card).toContainText("失败");
  const overflow = await card.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.screenshot({ path: test.info().outputPath("auto-routed-narrow.png") });
});

test("candidate plan is ordered, searchable and fits a narrow conversation", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(
    page,
    {
      model: "glm-5.3",
      candidates: [
        { model: "deepseek-v4.1-flash", platform: "openai", eligible: true, order: 1 },
        { model: "glm-5.3", platform: "openai", eligible: true, order: 2 },
        ...Array.from({ length: 700 }, (_, index) => ({
          model: `vendor/unknown-${index}`,
          platform: "openai",
          eligible: true,
          order: index + 3,
        })),
        {
          model: "nvidia/riva-translate-4b-instruct-v2",
          platform: "openai",
          eligible: false,
          reason: "not_text_generation",
        },
        {
          model: "gpt-6-astra",
          platform: "openai",
          eligible: false,
          reason: "auto_policy_excluded",
        },
      ],
    },
    true,
  );
  const card = page.getByRole("complementary", { name: "Auto routed" });
  await expect(card).toContainText("702 条可用 / 共 704 条路由");
  await page.getByRole("button", { name: "路由详情" }).click();
  const table = card.getByRole("table", { name: "降级候选" });
  await expect(table.locator("tbody tr").first()).toContainText("deepseek-v4.1-flash");
  await page.screenshot({ path: test.info().outputPath("auto-route-candidates-narrow.png") });
  const search = card.getByRole("searchbox", { name: "搜索候选模型" });
  await search.fill("translate");
  await expect(table.locator("tbody tr:visible")).toHaveCount(1);
  await expect(table.locator("tbody tr:visible")).toContainText("专用模型");
  expect(await card.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await search.fill("unknown-699");
  await expect(table.locator("tbody tr:visible")).toHaveCount(1);
  await search.fill("does-not-exist");
  await expect(card).toContainText("没有匹配的候选");
});

test("pending is not success, updates in place and preserves expanded details", async ({
  page,
}) => {
  await setup(page, { state: "selected" });
  const card = page.getByRole("complementary", { name: "Auto routed" });
  await expect(card).toContainText("正在尝试");
  await expect(card).not.toContainText("已完成");
  await page.getByRole("button", { name: "路由详情" }).click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(card).toContainText("已完成");
  await expect(card.locator("ol")).toBeVisible();
  await page.getByRole("button", { name: "Provider offline" }).click();
  await expect(card).toContainText("路由状态暂时无法更新");
  await expect(card).toContainText("gpt-5.6");
  await page.getByRole("button", { name: "Dispose" }).click();
  await expect(card).toHaveCount(0);
});

test("rejects a late response from a retired Host", async ({ page }) => {
  await setup(page, { mode: "pending", selectedModel: "auto" });
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "calls").length)).toBe(1);
  await page.getByRole("button", { name: "Switch Host" }).click();
  await page.getByRole("button", { name: "Deliver late result" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "calls").length))
    .toBeGreaterThan(1);
  await expect(page.locator("[data-codexhost-auto-route]")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Auto 选模" })).toContainText("等待网关返回");
});

test("unsupported gateway does not add invented conversation content", async ({ page }) => {
  await setup(page, { mode: "unsupported" });
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "calls").length)).toBe(1);
  await expect(page.locator("[data-codexhost-auto-route]")).toHaveCount(0);
});

for (const [config, message] of [
  [{ unavailableReason: "host" }, "当前连接未提供 Auto 路由记录"],
  [{ unavailableReason: "provider" }, "当前供应商未提供 Auto 路由记录"],
  [{ mode: "unsupported" }, "当前连接暂未提供 Auto 路由记录"],
  [{ mode: "failure" }, "路由状态暂时无法更新"],
  [{ mode: "empty" }, "等待网关返回实际选中的模型"],
  [{ mode: "pending" }, "正在读取 Auto 路由记录"],
] as const) {
  test(`auto selection explains missing records: ${message}`, async ({ page }) => {
    await setup(page, { ...config, selectedModel: "auto" });
    const status = page.getByRole("status", { name: "Auto 选模" });
    await expect(status).toBeVisible();
    await expect(status).toContainText(message);
    await expect(page.locator("[data-codexhost-auto-route]")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("auto-route-status.png") });
    await page.getByRole("combobox", { name: "Model" }).selectOption("fixed");
    await expect(status).toHaveCount(0);
    await page.getByRole("combobox", { name: "Model" }).selectOption("auto");
    await expect(status).toContainText(message);
    await page.getByRole("button", { name: "Dispose" }).click();
    await expect(status).toHaveCount(0);
  });
}

test("privacy disables route feedback without inventing a provider failure", async ({ page }) => {
  await setup(page, { unavailableReason: "private", selectedModel: "auto" });
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "calls").length)).toBe(1);
  await expect(page.getByRole("status", { name: "Auto 选模" })).toHaveCount(0);
  await expect(page.locator("[data-codexhost-auto-route]")).toHaveCount(0);
});

test("confirmed selection appears before the reply and moves into its own turn", async ({
  page,
}) => {
  await setup(page, { state: "selected", selectedModel: "auto", noResponse: true });
  const card = page.getByRole("complementary", { name: "Auto routed" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("正在尝试");
  await expect(card).toContainText("gpt-5.6");
  await expect(card).toContainText("1 次请求");
  await expect(card).toContainText("等待回合显示");
  await expect(
    page.locator("[data-content-search-turn-key] [data-codexhost-auto-route]"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "路由详情" }).click();
  await page.screenshot({ path: test.info().outputPath("auto-selected-before-reply.png") });
  await page.getByRole("button", { name: "Show reply" }).click();
  await expect(card).toHaveCount(1);
  await expect(card).not.toContainText("等待回合显示");
  await expect(card.locator("ol")).toBeVisible();
  await expect(
    page.locator(
      `[data-response-annotation-conversation="${threadId}"] [data-codexhost-auto-route]`,
    ),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(card).toContainText("已完成");
  await page.screenshot({ path: test.info().outputPath("auto-selected-after-reply.png") });
});
