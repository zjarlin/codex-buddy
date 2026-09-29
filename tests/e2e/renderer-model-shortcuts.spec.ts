import { expect, test, type Page } from "@playwright/test";
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
      let context = "fixture";
      let viewOverrides = {};
      globalThis.composerKeys = [];
      document.addEventListener("keydown", (event) => globalThis.composerKeys.push(event.key));
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
      const snapshot = { settings: { enabled: true, planning: true, privateMode: false, bypass: true, role: "auto", plannerModel: null, executorModel: null }, models: [], decisions: [] };
      const client = {
        buddyStatus: async () => structuredClone(snapshot),
        buddyConfigure: async (settings) => {
          if (globalThis.deferSelection) {
            await new Promise((resolve, reject) => {
              globalThis.finishSelection = (fail) => fail ? reject(new Error("Selection unavailable")) : resolve();
            });
          }
          if (globalThis.fail) throw new Error("Configuration unavailable");
          snapshot.settings = settings;
          return structuredClone(snapshot);
        },
      };
      const router = installBuddyControl(() => ({ anchor: composer, threadId: "fixture", client }), () => "zh-CN");
      const shortcuts = mountModelShortcuts(async (id) => {
        if (harness !== "codex" && globalThis.resolveSelectionError) {
          viewOverrides = { ...viewOverrides, error: "External selection unavailable" };
          render();
          return;
        }
        const expectedContext = context;
        const expectedHarness = harness;
        await selectFixedModel(client, () => expectedContext === context && expectedHarness === harness, () => nativeModelBinding(trigger).select(id));
        render();
        await router.refresh();
      }, async () => {
        await refreshNativeModels(trigger, "local");
        render();
        return { synchronized: nativeModelBinding(trigger).view.models.length };
      });
      composer.before(shortcuts.root);
      const render = () => shortcuts.update({ ...nativeModelBinding(trigger).view, ...(harness === "codex" ? {} : { supportsCustomModel: false }), ...viewOverrides }, harness, "zh-CN", context);
      globalThis.changeHarness = (value) => { harness = value; render(); };
      globalThis.changeContext = (value) => { context = value; render(); };
      globalThis.disableModel = () => { props.modelOptionsDisabled = true; render(); };
      globalThis.setView = (value) => { viewOverrides = value; render(); };
      globalThis.setNativeOptions = (options) => { props.modelOptions = options; render(); };
      globalThis.setLockedModel = (id) => { props.lockedModelSlug = id; render(); };
      globalThis.setModels = (ids) => {
        props.modelOptions = ids.map((id) => props.modelOptions.find(({ model }) => model.model === id) ?? { model: { model: id, displayName: id } });
        render();
      };
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

const openShortcuts = async (page: Page) => {
  await page.route("http://shortcuts.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><body style="padding:320px 24px 24px;background:#191b20;color:#eee;color-scheme:dark"><div id="composer"><textarea aria-label="Message"></textarea><button id="native">gpt-a</button></div></body>',
    }),
  );
  await page.goto("http://shortcuts.test/");
  await page.addScriptTag({ content: bundle });
};

test("manual IDs preserve case and slashes, pin without selecting, and survive reload", async ({
  page,
}) => {
  await openShortcuts(page);
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  await manage.click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  const search = menu.getByRole("searchbox");
  const useId = menu.getByRole("button", { name: "使用此 ID", exact: true });
  const pinId = menu.getByRole("button", { name: "Pin 此 ID", exact: true });
  await expect(useId).toBeDisabled();
  await expect(pinId).toBeDisabled();
  await search.fill("  Vendor/Model-A:Latest  ");
  await search.press("Enter");
  expect(await page.evaluate(() => Reflect.get(globalThis, "composerKeys"))).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await pinId.click();
  await expect(pinId).toBeDisabled();
  await expect(menu.getByRole("button", { name: "取消收藏 Vendor/Model-A:Latest" })).toBeVisible();
  await page.screenshot({ path: "test-results/model-shortcuts-manual.png" });
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("codexhost.model-favorites.v1:codex") ?? "[]"),
    ),
  ).toEqual(["Vendor/Model-A:Latest"]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await useId.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#native")).toHaveText("Vendor/Model-A:Latest");
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    { model: "Vendor/Model-A:Latest", effort: null },
  ]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "composerKeys"))).toEqual([]);
  await expect(page.locator("[data-buddy-router] summary")).toContainText("固定模型 · 不规划");
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const chip = page.locator('[data-model-shortcut="Vendor/Model-A:Latest"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("目录未列出");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "calls").map(({ model }: { model: string }) => model),
    ),
  ).toEqual(["Vendor/Model-A:Latest"]);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  expect(await page.evaluate(() => Reflect.get(globalThis, "composerKeys"))).toEqual(["Enter"]);
});

test("catalog removal preserves native pins and empty catalogs still allow manual IDs", async ({
  page,
}) => {
  await openShortcuts(page);
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  await manage.click();
  await menu.getByRole("button", { name: "收藏 GPT Alpha", exact: true }).click();
  await page.evaluate(() => Reflect.get(globalThis, "setModels")(["deepseek-b", "locked"]));
  const removedPin = page.locator('[data-model-shortcut="gpt-a"]');
  await expect(removedPin).toHaveAccessibleName("gpt-a");
  await expect(removedPin).toContainText("目录未列出");
  await expect(menu.getByRole("button", { name: "取消收藏 gpt-a", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await removedPin.click();
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "calls").map(({ model }: { model: string }) => model),
    ),
  ).toEqual(["gpt-a"]);
  await page.evaluate(() =>
    Reflect.get(
      globalThis,
      "setNativeOptions",
    )([{ model: { model: "gpt-a", displayName: "GPT Alpha restored" } }]),
  );
  await expect(removedPin).toHaveCount(1);
  await expect(removedPin).toHaveAccessibleName("GPT Alpha restored");
  await expect(removedPin.locator("[data-model-missing-hint]")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "setModels")([]));
  await manage.click();
  await menu.getByRole("button", { name: "取消收藏 gpt-a", exact: true }).click();
  await expect(removedPin).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(manage).toBeEnabled();
  await manage.click();
  await menu.getByRole("searchbox").fill("Empty/CatalogModel");
  await menu.getByRole("button", { name: "Pin 此 ID", exact: true }).click();
  await menu.getByRole("button", { name: "使用此 ID", exact: true }).click();
  await expect(page.locator("#native")).toHaveText("Empty/CatalogModel");
});

test("external Harness pins stay isolated and missing models can only be unpinned", async ({
  page,
}) => {
  await openShortcuts(page);
  await page.evaluate(() => {
    localStorage.setItem("codexhost.model-favorites.v1:codex", '["Native/Only"]');
    localStorage.setItem("codexhost.model-favorites.v1:pi", '["Harness/Only"]');
    window.dispatchEvent(new Event("storage"));
    Reflect.get(globalThis, "changeHarness")("pi");
    Reflect.get(globalThis, "setModels")([]);
  });
  await expect(page.locator('[data-model-shortcut="Native/Only"]')).toHaveCount(0);
  const externalPin = page.locator('[data-model-shortcut="Harness/Only"]');
  await expect(externalPin).toBeDisabled();
  await externalPin.evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  await manage.click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  await expect(menu.getByRole("button", { name: "使用此 ID", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Pin 此 ID", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "取消收藏 Harness/Only", exact: true }).click();
  await expect(externalPin).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(manage).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "changeHarness")("codex"));
  await expect(page.locator('[data-model-shortcut="Native/Only"]')).toBeEnabled();
});

test("hidden disabled and absent locked IDs stay pinnable but cannot be selected", async ({
  page,
}) => {
  await openShortcuts(page);
  await page.getByRole("button", { name: "收藏模型", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  const search = menu.getByRole("searchbox");
  const useId = menu.getByRole("button", { name: "使用此 ID", exact: true });
  const pinId = menu.getByRole("button", { name: "Pin 此 ID", exact: true });
  await search.fill("Hidden/Blocked");
  await pinId.click();
  const hiddenPin = page.locator('[data-model-shortcut="Hidden/Blocked"]');
  await expect(hiddenPin).toBeEnabled();
  await page.evaluate(() => {
    Reflect.get(
      globalThis,
      "setNativeOptions",
    )([
      {
        model: { model: "Hidden/Blocked", displayName: "Hidden blocked", hidden: true },
        disabledReason: "Unavailable",
      },
    ]);
    Reflect.get(globalThis, "setLockedModel")("Locked/Absent");
  });
  await expect(hiddenPin).toBeDisabled();
  await expect(useId).toBeDisabled();
  await menu.getByRole("button", { name: "取消收藏 Hidden/Blocked", exact: true }).click();
  await expect(pinId).toBeEnabled();
  await pinId.click();
  await expect(hiddenPin).toBeDisabled();
  await search.fill("Locked/Absent");
  await expect(useId).toBeDisabled();
  await expect(pinId).toBeEnabled();
  await pinId.click();
  const lockedPin = page.locator('[data-model-shortcut="Locked/Absent"]');
  await expect(lockedPin).toBeDisabled();
  await useId.evaluate((button: HTMLButtonElement) => button.click());
  await lockedPin.evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await page.evaluate(() => Reflect.get(globalThis, "setLockedModel")(null));
  await expect(lockedPin).toBeEnabled();
  await expect(useId).toBeEnabled();
  await expect(hiddenPin).toBeDisabled();
});

test("resolved external selection errors never show a successful selection", async ({ page }) => {
  await openShortcuts(page);
  await page.evaluate(() => {
    localStorage.setItem("codexhost.model-favorites.v1:pi", '["gpt-a","deepseek-b"]');
    Reflect.set(globalThis, "resolveSelectionError", true);
    Reflect.get(globalThis, "changeHarness")("pi");
  });
  const root = page.locator("[data-codexhost-model-shortcuts]");
  for (const id of ["deepseek-b", "gpt-a"]) {
    await page.locator(`[data-model-shortcut="${id}"]`).click();
    await expect(root.locator("[data-model-shortcuts-error]")).toHaveText(
      "External selection unavailable",
    );
    await expect(root.locator("[data-model-shortcuts-status]")).toBeHidden();
  }
  await expect(page.locator('[data-model-shortcut="deepseek-b"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("#native")).toHaveText("gpt-a");
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
});

test("disabled models remain pinnable while global busy states block all actions", async ({
  page,
}) => {
  await openShortcuts(page);
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  await manage.click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  const search = menu.getByRole("searchbox");
  const useId = menu.getByRole("button", { name: "使用此 ID", exact: true });
  const pinId = menu.getByRole("button", { name: "Pin 此 ID", exact: true });
  await search.fill("locked");
  await expect(useId).toBeDisabled();
  await expect(pinId).toBeEnabled();
  await expect(menu.getByRole("button", { name: "收藏 Unavailable", exact: true })).toBeEnabled();
  await pinId.click();
  await expect(pinId).toBeDisabled();
  await expect(useId).toBeDisabled();
  await expect(
    menu.getByRole("button", { name: "取消收藏 Unavailable", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    localStorage.setItem("codexhost.model-favorites.v1:codex", '["locked","gpt-a"]');
    window.dispatchEvent(new Event("storage"));
  });
  await expect(page.locator('[data-model-shortcut="locked"]')).toBeDisabled();
  await search.fill("gpt-a");
  const unpin = menu.getByRole("button", { name: "取消收藏 GPT Alpha", exact: true });
  for (const state of [{ disabled: true }, { refreshing: true }]) {
    await page.evaluate((value) => Reflect.get(globalThis, "setView")(value), state);
    await expect(manage).toBeDisabled();
    await expect(search).toBeDisabled();
    await expect(useId).toBeDisabled();
    await expect(pinId).toBeDisabled();
    await expect(unpin).toBeDisabled();
    await expect(page.locator('[data-model-shortcut="gpt-a"]')).toBeDisabled();
    await unpin.evaluate((button: HTMLButtonElement) => button.click());
  }
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await page.evaluate(() => Reflect.get(globalThis, "setView")({}));
  await expect(unpin).toBeEnabled();
  await search.fill("Refresh/Manual");
  await menu.locator("[data-model-shortcuts-refresh]").click();
  await expect(useId).toBeDisabled();
  await expect(pinId).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")(false));
  await expect(search).toHaveValue("Refresh/Manual");
  await expect(useId).toBeEnabled();
  await expect(pinId).toBeEnabled();
});

test("manual selection errors are retryable and stale selection cannot alter a new context", async ({
  page,
}) => {
  await openShortcuts(page);
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  await manage.click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  const search = menu.getByRole("searchbox");
  const useId = menu.getByRole("button", { name: "使用此 ID", exact: true });
  const pinId = menu.getByRole("button", { name: "Pin 此 ID", exact: true });
  await search.fill("Pending/Model");
  await page.evaluate(() => Reflect.set(globalThis, "fail", true));
  await useId.click();
  await expect(menu.getByRole("status")).toHaveText("Configuration unavailable");
  await expect(search).toHaveValue("Pending/Model");
  await expect(useId).toBeEnabled();
  await page.evaluate(() => {
    Reflect.set(globalThis, "fail", false);
    Reflect.set(globalThis, "deferSelection", true);
  });
  await useId.click();
  await expect(useId).toBeDisabled();
  await expect(pinId).toBeDisabled();
  await expect(menu.locator("[data-model-shortcuts-refresh]")).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "changeContext")("next-thread"));
  await expect(menu).not.toBeVisible();
  await expect(page.locator("[data-model-favorites-header] input")).toHaveValue("");
  await page.evaluate(() => Reflect.get(globalThis, "finishSelection")(true));
  await expect(page.locator("[data-codexhost-model-shortcuts] [role=status]:visible")).toHaveCount(
    0,
  );
  await manage.click();
  await expect(search).toHaveValue("");
  await expect(menu.getByRole("status")).not.toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await page.evaluate(() => Reflect.set(globalThis, "deferSelection", false));
  await search.fill("Current/Model");
  await useId.click();
  await expect(page.locator("#native")).toHaveText("Current/Model");
  await expect(menu.getByRole("status")).toHaveText("已选择 Current/Model，下次发送生效");
  await expect(page.locator('[data-model-shortcut="Current/Model"]')).toHaveCount(0);
});

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
  await page.getByRole("switch", { name: /Auto Router/ }).click();
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

test("favorite chip remove button unpins without selecting and persists after reload", async ({
  page,
}) => {
  await openShortcuts(page);
  const manage = page.getByRole("button", { name: "收藏模型", exact: true });
  await manage.click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  await menu.getByRole("button", { name: "收藏 GPT Alpha", exact: true }).click();
  await menu.getByRole("button", { name: "收藏 DeepSeek Beta", exact: true }).click();
  await page.keyboard.press("Escape");

  const remove = page.locator('[data-model-shortcut-remove="deepseek-b"]');
  await expect(remove).toHaveAccessibleName("取消收藏 DeepSeek Beta");
  await remove.click();
  await expect(page.locator('[data-model-shortcut="deepseek-b"]')).toHaveCount(0);
  await expect(page.locator('[data-model-shortcut="gpt-a"]')).toBeVisible();
  await expect(page.locator("#native")).toHaveText("gpt-a");
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("codexhost.model-favorites.v1:codex") ?? "[]"),
    ),
  ).toEqual(["gpt-a"]);

  await page.reload();
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-model-shortcut="deepseek-b"]')).toHaveCount(0);
  await expect(page.locator('[data-model-shortcut="gpt-a"]')).toBeVisible();
});
