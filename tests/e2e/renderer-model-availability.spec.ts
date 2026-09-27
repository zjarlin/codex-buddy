import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { mountModelShortcuts } from "./packages/renderer-extension/src/renderer-model-shortcuts.ts";
      let context = "local:thread-a";
      let harness = "codex";
      let locale = "zh-CN";
      let view = { models: [
        { id: "a", label: "Alpha" }, { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" }
      ], supportsCustomModel: true, supportsAvailabilityProbe: true };
      globalThis.reads = [];
      globalThis.probes = [];
      globalThis.pendingReads = [];
      globalThis.pendingProbes = [];
      globalThis.selections = [];
      globalThis.refreshes = 0;
      const readCache = (key) => JSON.parse(localStorage.getItem("availability:" + key) || "null")
        || { provider: key, checkedAt: null, results: [] };
      const shortcuts = mountModelShortcuts((id) => globalThis.selections.push(id), async () => {
        globalThis.refreshes++;
        await new Promise((resolve) => { globalThis.finishRefresh = resolve; });
        view.models.push({ id: "d", label: "Delta" });
        render();
        return { synchronized: 4 };
      }, {
        read: () => {
          const key = context;
          globalThis.reads.push(key);
          if (globalThis.deferRead) {
            return new Promise((resolve) => globalThis.pendingReads.push(resolve));
          }
          return Promise.resolve(readCache(key));
        },
        probe: (ids) => {
          const key = context;
          globalThis.probes.push({ context: key, ids });
          return new Promise((resolve, reject) => globalThis.pendingProbes.push((value, failure) => {
            if (failure) { reject(new Error(failure)); return; }
            localStorage.setItem("availability:" + key, JSON.stringify(value));
            resolve(value);
          }));
        }
      });
      const render = () => shortcuts.update(view, harness, locale, context);
      globalThis.changeContext = (key, agent = "codex") => { context = key; harness = agent; render(); };
      globalThis.setView = (value) => { view = { ...view, ...value }; render(); };
      globalThis.changeLocale = (value) => { locale = value; render(); };
      globalThis.disposeShortcuts = () => shortcuts.dispose();
      document.body.append(shortcuts.root);
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
const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Model availability fixture did not build");

const checkedAt = "2026-09-27T10:20:30.000Z";
const mixedSnapshot = {
  provider: "fixture",
  checkedAt,
  results: [
    { id: "a", status: "available", checkedAt, latencyMs: 15 },
    { id: "b", status: "unavailable", checkedAt, latencyMs: 25, error: "HTTP 429: quota exceeded" },
    { id: "catalog-missing", status: "available", checkedAt, latencyMs: 12 },
  ],
};

async function setup(page: Page, composerTop = 620) {
  await page.route("http://availability.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body style="margin:0;padding:${composerTop}px 24px 24px;background:#191b20;color:#eee;color-scheme:dark"></body>`,
    }),
  );
  await page.goto("http://availability.test/");
  await page.addScriptTag({ content: bundle });
}

const trigger = (page: Page) => page.getByRole("button", { name: "收藏模型", exact: true });
const menu = (page: Page) => page.getByRole("dialog", { name: "收藏模型", exact: true });
const probe = (page: Page) => menu(page).locator("[data-model-availability-probe]");
const tab = (page: Page, name: string) => menu(page).getByRole("tab", { name, exact: true });
const finishProbe = (page: Page, snapshot = mixedSnapshot, failure?: string) =>
  page.evaluate(
    ({ snapshot, failure }) => Reflect.get(globalThis, "pendingProbes").shift()(snapshot, failure),
    { snapshot, failure },
  );

test("only a manual click probes every catalog and favorite ID despite the active filter", async ({
  page,
}) => {
  await setup(page);
  expect(await page.evaluate(() => Reflect.get(globalThis, "reads"))).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "probes"))).toEqual([]);
  await page.evaluate(() =>
    localStorage.setItem("codexhost.model-favorites.v1:codex", '["Pinned/Only","b"]'),
  );
  await trigger(page).click();
  await expect(tab(page, "未探测 (4)")).toHaveAttribute("aria-selected", "true");
  await menu(page).getByRole("searchbox").fill("Alpha");
  await expect(menu(page).locator("[data-favorite-model-id]")).toHaveCount(1);
  await probe(page).click();
  await expect(probe(page)).toBeDisabled();
  await expect(probe(page)).toHaveText("正在探测模型…");
  await expect(menu(page).getByRole("button", { name: "刷新模型", exact: true })).toBeDisabled();
  await expect(menu(page).getByRole("searchbox")).toBeEnabled();
  await menu(page).getByRole("button", { name: "收藏 Alpha", exact: true }).click();
  await expect(
    menu(page).getByRole("button", { name: "取消收藏 Alpha", exact: true }),
  ).toBeFocused();
  await probe(page).evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => Reflect.get(globalThis, "probes"))).toEqual([
    { context: "local:thread-a", ids: ["a", "b", "c", "Pinned/Only"] },
  ]);
  await finishProbe(page);
  await expect(tab(page, "可用 (2)")).toHaveAttribute("aria-selected", "true");
  await expect(menu(page).getByRole("searchbox")).toHaveValue("Alpha");
  await expect(menu(page).locator("[data-favorite-model-id]")).toHaveCount(1);
  expect(await page.evaluate(() => Reflect.get(globalThis, "selections"))).toEqual([]);
});

test("tabs expose mixed results, missing catalog IDs, reasons and keyboard focus with favorites", async ({
  page,
}) => {
  await setup(page);
  await trigger(page).click();
  await probe(page).click();
  await finishProbe(page);
  await expect(tab(page, "可用 (2)")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "不可用 (1)")).toBeVisible();
  await expect(tab(page, "未探测 (1)")).toBeVisible();
  const missing = menu(page).locator('[data-favorite-model-id="catalog-missing"]');
  await expect(missing).toContainText("目录未列出");
  await missing.click();
  await expect(missing).toHaveAttribute("aria-pressed", "true");
  await expect(missing).toBeFocused();
  await expect(menu(page).locator("[data-model-availability-summary]")).toHaveAttribute(
    "title",
    checkedAt,
  );
  await tab(page, "可用 (2)").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "不可用 (1)")).toBeFocused();
  await expect(menu(page).getByRole("tabpanel")).toHaveAccessibleName("不可用 (1)");
  await expect(menu(page).locator('[data-favorite-model-id="b"]')).toContainText(
    "HTTP 429: quota exceeded",
  );
  await page.screenshot({ path: "test-results/model-availability-unavailable.png" });
  await expect(menu(page).locator('[data-favorite-model-id="a"]')).toHaveCount(0);
  await page.keyboard.press("End");
  await expect(tab(page, "未探测 (1)")).toBeFocused();
  await expect(menu(page).locator('[data-favorite-model-id="c"]')).toBeVisible();
  await page.keyboard.press("Home");
  await expect(tab(page, "可用 (2)")).toBeFocused();
  await menu(page).getByRole("searchbox").fill("catalog");
  await expect(menu(page).locator("[data-favorite-model-id]")).toHaveCount(1);
  await missing.click();
  await expect(missing).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: "test-results/model-availability.png" });
});

test("reopening and remounting read cached results without probing; refresh preserves classifications", async ({
  page,
}) => {
  await setup(page);
  await trigger(page).click();
  await probe(page).click();
  await finishProbe(page);
  await page.keyboard.press("Escape");
  await trigger(page).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "reads").length)).toBe(2);
  expect(await page.evaluate(() => Reflect.get(globalThis, "probes").length)).toBe(1);
  await menu(page).getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect(probe(page)).toBeDisabled();
  await expect(tab(page, "不可用 (1)")).toBeVisible();
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")());
  await expect(tab(page, "可用 (2)")).toBeVisible();
  await expect(tab(page, "未探测 (2)")).toBeVisible();
  await tab(page, "未探测 (2)").click();
  await expect(menu(page).locator('[data-favorite-model-id="d"]')).toBeVisible();
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await trigger(page).click();
  await expect(tab(page, "可用 (2)")).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => Reflect.get(globalThis, "probes"))).toEqual([]);
});

test("a failed batch retains the previous results and a manual retry replaces classifications", async ({
  page,
}) => {
  await setup(page);
  await trigger(page).click();
  await probe(page).click();
  await finishProbe(page);
  await tab(page, "不可用 (1)").click();
  await probe(page).click();
  await expect(menu(page).locator('[data-favorite-model-id="b"]')).toBeVisible();
  await finishProbe(page, mixedSnapshot, "Provider discovery failed");
  await expect(menu(page).locator("[data-model-availability-error]")).toHaveText(
    "Provider discovery failed",
  );
  await expect(tab(page, "不可用 (1)")).toHaveAttribute("aria-selected", "true");
  await expect(menu(page).locator('[data-favorite-model-id="b"]')).toContainText("HTTP 429");
  await probe(page).click();
  await finishProbe(page, {
    ...mixedSnapshot,
    results: mixedSnapshot.results.map((result) => ({ ...result, status: "available" })),
  });
  await expect(tab(page, "可用 (3)")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "不可用 (0)")).toBeVisible();
  await expect(menu(page).locator("[data-model-availability-error]")).toBeHidden();
  await expect(menu(page).locator("[data-model-availability-reason]")).toHaveCount(0);
});

test("late reads and probes cannot overwrite a new context or a newer probe", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => Reflect.set(globalThis, "deferRead", true));
  await trigger(page).click();
  await page.evaluate(() => {
    Reflect.get(globalThis, "changeContext")("remote:thread-a");
    Reflect.set(globalThis, "deferRead", false);
  });
  await trigger(page).click();
  await page.evaluate(
    (snapshot) => Reflect.get(globalThis, "pendingReads").shift()(snapshot),
    mixedSnapshot,
  );
  await expect(tab(page, "未探测 (3)")).toHaveAttribute("aria-selected", "true");
  await probe(page).click();
  await page.evaluate(() => Reflect.get(globalThis, "changeContext")("remote:thread-b", "other"));
  await trigger(page).click();
  await finishProbe(page);
  await expect(tab(page, "未探测 (3)")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.evaluate(() => Reflect.set(globalThis, "deferRead", true));
  await trigger(page).click();
  await probe(page).click();
  await finishProbe(page);
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingReads").shift()({
      provider: "old",
      checkedAt: null,
      results: [],
    }),
  );
  await expect(tab(page, "可用 (2)")).toHaveAttribute("aria-selected", "true");
  await probe(page).click();
  await page.evaluate(() => Reflect.get(globalThis, "disposeShortcuts")());
  await finishProbe(page);
  await expect(page.locator("[data-model-favorites-menu]")).toHaveCount(0);
});

test("probe capability is opt-in and all availability controls follow the locale", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    Reflect.get(globalThis, "setView")({ supportsAvailabilityProbe: false }),
  );
  await trigger(page).click();
  await expect(menu(page).getByRole("tablist")).toHaveCount(0);
  await expect(probe(page)).toBeHidden();
  await expect(menu(page).locator("[data-favorite-model-id]")).toHaveCount(3);
  expect(await page.evaluate(() => Reflect.get(globalThis, "reads"))).toEqual([]);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    Reflect.get(globalThis, "setView")({ supportsAvailabilityProbe: true });
    Reflect.get(globalThis, "changeLocale")("en");
  });
  await page.getByRole("button", { name: "Favorite models", exact: true }).click();
  await expect(page.getByRole("button", { name: "Probe all models", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Untested (3)", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tablist")).toHaveAccessibleName("Model availability");
});

test("a composer 320px from the top keeps controls visible and scrolls the model list", async ({
  page,
}) => {
  await setup(page, 320);
  await page.evaluate(() =>
    Reflect.get(
      globalThis,
      "setView",
    )({
      models: Array.from({ length: 40 }, (_, index) => ({
        id: `model-${index}`,
        label: `Model ${index}`,
      })),
    }),
  );
  await trigger(page).click();
  const panel = menu(page).getByRole("tabpanel");
  await expect(tab(page, "未探测 (40)")).toBeVisible();
  await expect(probe(page)).toBeVisible();
  const layout = await panel.evaluate((element) => {
    const dialog = element.closest<HTMLElement>("[data-model-favorites-menu]");
    const tabList = dialog?.querySelector<HTMLElement>("[role=tablist]");
    const bounds = element.getBoundingClientRect();
    return {
      panelHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      panelBottom: bounds.bottom,
      dialogBottom: dialog?.getBoundingClientRect().bottom ?? 0,
      dialogTop: dialog?.getBoundingClientRect().top ?? -1,
      tabsBottom: tabList?.getBoundingClientRect().bottom ?? 0,
      panelTop: bounds.top,
    };
  });
  expect(layout.dialogTop).toBeGreaterThanOrEqual(8);
  expect(layout.dialogBottom).toBeLessThanOrEqual(322);
  expect(layout.panelHeight).toBeGreaterThan(30);
  expect(layout.scrollHeight).toBeGreaterThan(layout.panelHeight);
  expect(layout.panelTop).toBeGreaterThanOrEqual(layout.tabsBottom);
  expect(layout.panelBottom).toBeLessThan(layout.dialogBottom);
  const last = menu(page).getByRole("button", { name: "收藏 Model 39", exact: true });
  await last.click();
  await expect(
    menu(page).getByRole("button", { name: "取消收藏 Model 39", exact: true }),
  ).toBeFocused();
  await expect(probe(page)).toBeInViewport();
  await expect(tab(page, "未探测 (40)")).toBeInViewport();
  await page.screenshot({ path: "test-results/model-availability-short-menu.png" });
});
