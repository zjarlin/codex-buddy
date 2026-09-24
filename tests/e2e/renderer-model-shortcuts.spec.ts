import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { mountModelShortcuts } from "./packages/renderer-extension/src/renderer-model-shortcuts.ts";
      import { nativeModelBinding } from "./packages/renderer-extension/src/renderer-native-model-binding.ts";
      import { refreshNativeModels } from "./packages/renderer-extension/src/renderer-native-model-refresh.ts";
      import { selectFixedModel } from "./packages/renderer-extension/src/renderer-fixed-model-selection.ts";
      import { installBuddyControl } from "./packages/renderer-extension/src/buddy/control.ts";
      const composer = document.querySelector("#composer");
      const trigger = document.querySelector("#native");
      globalThis.calls = [];
      globalThis.fail = false;
      let harness = "codex";
      const props = {
        model: "gpt-a", reasoningEffort: "high", modelOptionsDisabled: false,
        modelOptions: [
          { model: { model: "gpt-a", displayName: "GPT Alpha", defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }] } },
          { model: { model: "deepseek-b", displayName: "DeepSeek Beta", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }] } },
          { model: { model: "locked", displayName: "Unavailable", defaultReasoningEffort: "low" }, disabledReason: "Unavailable" }
        ],
        onBeforeSelectModel: () => true,
        onSelectModel: (model, effort) => {
          globalThis.calls.push({ model, effort });
          props.model = model; props.reasoningEffort = effort;
          trigger.textContent = model;
        },
      };
      trigger.__reactFiber$fixture = { memoizedProps: props };
      globalThis.refreshes = [];
      const queryClient = {
        getQueryCache: () => ({ findAll: () => [{}] }),
        refetchQueries: async (filters) => {
          globalThis.refreshes.push(filters);
          await new Promise((resolve, reject) => {
            globalThis.finishRefresh = (fail) => fail ? reject(new Error("Refresh unavailable")) : resolve();
          });
          if (!props.modelOptions.some(({model}) => model.model === "gamma")) {
            props.modelOptions.push({model:{model:"gamma",displayName:"GPT Gamma"}});
          }
        },
      };
      trigger.__reactFiber$fixture.return = { memoizedProps: { client: queryClient } };
      const snapshot = { settings: { enabled: true, privateMode: false, bypass: true, role: "auto", plannerModel: null, executorModel: null }, models: [], decisions: [] };
      const client = {
        buddyStatus: async () => structuredClone(snapshot),
        buddyConfigure: async (settings) => {
          if (globalThis.fail) throw new Error("Configuration unavailable");
          snapshot.settings = settings;
          return structuredClone(snapshot);
        },
      };
      const router = installBuddyControl(() => ({ anchor: composer, threadId: "fixture", client }), () => "zh-CN");
      const shortcuts = mountModelShortcuts(async (id) => {
        await selectFixedModel(client, () => true, () => nativeModelBinding(trigger).select(id));
        render();
        await router.refresh();
      }, async () => {
        await refreshNativeModels(trigger, "local");
        render();
        return { synchronized: nativeModelBinding(trigger).view.models.length };
      });
      composer.before(shortcuts.root);
      const render = () => shortcuts.update(nativeModelBinding(trigger).view, harness, "zh-CN");
      globalThis.changeHarness = (value) => { harness = value; render(); };
      globalThis.disableModel = () => { props.modelOptionsDisabled = true; render(); };
      render();
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Shortcuts fixture did not build");

test("native manual refresh preserves favorites, search and selection and ignores stale errors", async ({
  page,
}) => {
  await page.route("http://shortcuts.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><body style="padding:320px 24px 24px;background:#191b20;color:#eee;color-scheme:dark"><div id="composer"><button id="native">gpt-a</button></div></body>',
    }),
  );
  await page.goto("http://shortcuts.test/");
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "收藏模型", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  const search = menu.getByRole("searchbox");
  await menu.getByRole("button", { name: "收藏 GPT Alpha", exact: true }).click();
  await search.fill("GPT");
  const refresh = menu.locator("[data-model-shortcuts-refresh]");
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await refresh.evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => Reflect.get(globalThis, "refreshes"))).toHaveLength(1);
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")(false));
  await expect(menu.getByRole("button", { name: "收藏 GPT Gamma", exact: true })).toBeVisible();
  await expect(menu.getByRole("status")).toContainText("同步 4 个");
  await expect(menu.getByRole("status")).toContainText("新增 1 个");
  await expect(search).toHaveValue("GPT");
  await expect(menu.getByRole("button", { name: "取消收藏 GPT Alpha", exact: true })).toBeVisible();
  await expect(page.locator("#native")).toHaveText("gpt-a");
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await refresh.click();
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")(true));
  await expect(menu.getByRole("status")).toHaveText("Refresh unavailable");
  await expect(search).toHaveValue("GPT");
  await expect(refresh).toBeEnabled();
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(40, 40, 40)",
  );
  await page.screenshot({ path: "test-results/model-shortcuts-refresh.png" });
  await refresh.click();
  await page.evaluate(() => Reflect.get(globalThis, "changeHarness")("pi"));
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")(true));
  await expect(page.getByRole("status")).not.toBeVisible();
});

test("favorite chips persist and select the exact native model with planning disabled", async ({
  page,
}) => {
  await page.route("http://shortcuts.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <!doctype html><style>body{margin:0;padding:320px 24px 24px;background:#191b20;color:#eee;font:14px system-ui;color-scheme:dark}#composer{padding:16px;border:1px solid #555;border-radius:18px}</style>
    <div id="composer"><textarea aria-label="Message"></textarea><button id="native">gpt-a</button></div>`,
    }),
  );
  await page.goto("http://shortcuts.test/");
  await page.addScriptTag({ content: bundle });
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  await manage.click();
  await menu.getByRole("button", { name: "收藏 GPT Alpha", exact: true }).click();
  await menu.getByRole("button", { name: "收藏 DeepSeek Beta", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await page.keyboard.press("Escape");
  const beta = page.locator('[data-model-shortcut="deepseek-b"]');
  await page.evaluate(() => Reflect.set(globalThis, "fail", true));
  await beta.click();
  await expect(page.getByRole("status")).toHaveText("Configuration unavailable");
  await expect(page.locator("#native")).toHaveText("gpt-a");
  await page.evaluate(() => Reflect.set(globalThis, "fail", false));
  await beta.focus();
  await page.keyboard.press("Enter");
  await expect(beta).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#native")).toHaveText("deepseek-b");
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    { model: "deepseek-b", effort: "low" },
  ]);
  await expect(page.locator("[data-buddy-router] summary")).toContainText("固定模型 · 不规划");
  await page.locator("[data-buddy-router] summary").click();
  await page.getByRole("switch", { name: /自动规划/ }).click();
  await expect(page.locator("[data-buddy-router] summary")).not.toContainText("固定模型");
  await page.setViewportSize({ width: 720, height: 800 });
  const settings = page.locator(".buddy-settings");
  expect(
    await settings.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(2);
  expect((await settings.boundingBox())?.height).toBeLessThan(155);
  await page.screenshot({ path: "test-results/model-shortcuts-compact.png" });
  await page.evaluate(() => Reflect.get(globalThis, "changeHarness")("pi"));
  await expect(beta).toHaveCount(0);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await expect(beta).toBeVisible();
  await page.evaluate(() => Reflect.get(globalThis, "disableModel")());
  await expect(beta).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
