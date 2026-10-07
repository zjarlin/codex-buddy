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
      import { refreshNativeModelCatalog } from "./packages/renderer-extension/src/renderer-native-model-refresh.ts";
      import { RendererMethodUnavailableError } from "./packages/renderer-extension/src/renderer-request-sender.ts";
      const composer = document.querySelector("#composer");
      const trigger = document.querySelector("#native");
      const options = (ids) => ids.map((id) => ({model: {model: id, displayName: id}}));
      let context = "original";
      let props = {
        model: "model-0",
        modelOptions: options(["model-0", "old-a", "old-b"]),
        onSelectModel: (id) => { globalThis.selections.push(id); props.model = id; },
      };
      let config = { ids: Array.from({length: 26}, (_, i) => "model-" + i) };
      globalThis.configureRefresh = (next) => { config = { ...config, ...next }; };
      globalThis.selections = [];
      globalThis.syncs = 0;
      globalThis.refetches = [];
      globalThis.readContexts = [];
      globalThis.outcomes = [];
      let currentFiber;
      const rootState = {};
      const publish = (nextProps) => {
        const root = { stateNode: rootState };
        const provider = { memoizedProps: { client: queryClient }, return: root };
        const next = { memoizedProps: nextProps, return: provider, alternate: currentFiber };
        root.child = provider;
        provider.child = next;
        if (currentFiber) currentFiber.alternate = next;
        trigger.__reactFiber$fixture = currentFiber ?? next;
        currentFiber = next;
        rootState.current = root;
        props = nextProps;
      };
      const queryClient = {
        getQueryCache: () => ({ findAll: () => [{}] }),
        refetchQueries: async (filters) => {
          globalThis.refetches.push(filters);
          const nextProps = { ...props, modelOptions: options(config.ids) };
          const expectedContext = context;
          globalThis.commitRefresh = () => {
            if (expectedContext === context) publish(nextProps);
          };
          if (config.deferRefetch) {
            await new Promise((resolve, reject) => {
              globalThis.finishRefetch = (failure) => failure ? reject(new Error("Native refetch failed")) : resolve();
            });
          }
        },
      };
      const client = {
        buddyStatus: async () => {
          if (config.noBuddy) {
            throw new RendererMethodUnavailableError("codexhost/buddy/status", null);
          }
          return {settings: {privateMode: config.privateMode === true}};
        },
        syncCodexCatalog: async () => {
          globalThis.syncs++;
          if (config.syncFailure) throw new Error("Provider synchronization failed");
          return {provider: "fixture", returned: config.ids.length, ids: config.ids};
        },
      };
      const shortcuts = mountModelShortcuts(() => {}, async () => {
        const expectedContext = context;
        const isCurrent = () => expectedContext === context && composer.isConnected;
        const outcome = await refreshNativeModelCatalog({
          client, hostId: "local", isCurrent,
          trigger: () => { globalThis.readContexts.push(context); return trigger; },
        });
        if (!isCurrent() || !outcome) return undefined;
        globalThis.outcomes.push(outcome);
        render();
        return outcome;
      });
      composer.before(shortcuts.root);
      const render = () => shortcuts.update(nativeModelBinding(trigger).view, "codex", "zh-CN", context);
      globalThis.changeContext = () => {
        context = "replacement";
        publish({...props, model: "replacement-model", modelOptions: options(["replacement-model"])});
        render();
      };
      globalThis.nativeIds = () => nativeModelBinding(trigger).view.models.map(({id}) => id);
      publish(props);
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
if (!bundle) throw new Error("Native refresh fixture did not build");

const openFixture = async (page: Page) => {
  await page.route("http://native-refresh.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><body style="padding:320px 24px 24px;background:#191b20;color:#eee;color-scheme:dark"><div id="composer"><button id="native">model-0</button></div></body>',
    }),
  );
  await page.goto("http://native-refresh.test/");
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "收藏模型", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "收藏模型", exact: true });
  return {
    menu,
    search: menu.getByRole("searchbox"),
    refresh: menu.locator("[data-model-shortcuts-refresh]"),
  };
};

test("native commit adds all 26 models then removes stale models while preserving selection, pins and search", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { menu, search, refresh } = await openFixture(page);
  await menu.getByRole("button", { name: "收藏 model-0", exact: true }).click();
  await menu.getByRole("button", { name: "收藏 old-a", exact: true }).click();
  await search.fill("model-");
  await refresh.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length)).toBe(1);
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(menu.getByRole("status")).not.toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual([
    "model-0",
    "old-a",
    "old-b",
  ]);
  await page.evaluate(() => Reflect.get(globalThis, "commitRefresh")());
  await expect(refresh).toBeEnabled();
  await expect(menu.getByRole("status")).toContainText("远程返回 26 个，同步 26 个");
  await expect(menu.getByRole("status")).toContainText("新增 25 个，移除 2 个");
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual(
    Array.from({ length: 26 }, (_, i) => `model-${i}`),
  );
  await expect(search).toHaveValue("model-");
  await expect(page.locator('[data-model-shortcut="model-0"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-model-shortcut="old-a"] [data-model-missing-hint]')).toHaveCount(
    0,
  );
  await expect(menu.getByRole("button", { name: "收藏 model-25", exact: true })).toBeVisible();

  await page.evaluate(() =>
    Reflect.get(
      globalThis,
      "configureRefresh",
    )({ ids: Array.from({ length: 17 }, (_, i) => `model-${i}`) }),
  );
  await refresh.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length)).toBe(2);
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => Reflect.get(globalThis, "commitRefresh")());
  await expect(menu.getByRole("status")).toContainText("远程返回 17 个，同步 17 个，移除 9 个");
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual(
    Array.from({ length: 17 }, (_, i) => `model-${i}`),
  );
  await expect(menu.getByRole("button", { name: "收藏 model-25", exact: true })).toHaveCount(0);
  await expect(search).toHaveValue("model-");
  expect(await page.evaluate(() => Reflect.get(globalThis, "selections"))).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "refetches"))).toEqual([
    { queryKey: ["models", "list", "local"], type: "active" },
    { queryKey: ["models", "list", "local"], type: "active" },
  ]);
  expect(errors).toEqual([]);
});

test("a missing favorite automatically synchronizes and waits for the native commit", async ({
  page,
}) => {
  const { menu, search, refresh } = await openFixture(page);
  await search.fill("model-25");
  await menu.getByRole("button", { name: "Pin 此 ID", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length)).toBe(1);
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(search).toBeEnabled();
  const chip = page.locator('[data-model-shortcut="model-25"]');
  await expect(chip).toBeEnabled();
  await expect(chip.locator("[data-model-missing-hint]")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "commitRefresh")());
  await expect(refresh).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(globalThis, "outcomes"))).toEqual([
    { returned: 26, synchronized: 26 },
  ]);
  await expect(search).toHaveValue("model-25");
  await expect(menu.getByRole("status")).not.toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "selections"))).toEqual([]);
});

test("refresh publishes an empty native catalog without removing favorites", async ({ page }) => {
  const { menu, refresh } = await openFixture(page);
  await menu.getByRole("button", { name: "收藏 old-a", exact: true }).click();
  await page.evaluate(() => Reflect.get(globalThis, "configureRefresh")({ ids: [] }));
  await refresh.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length)).toBe(1);
  await page.evaluate(() => Reflect.get(globalThis, "commitRefresh")());
  await expect(refresh).toBeEnabled();
  await expect(menu.getByRole("status")).toContainText("远程返回 0 个，同步 0 个");
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual([]);
  await expect(page.locator('[data-model-shortcut="old-a"]')).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(globalThis, "refetches"))).toHaveLength(1);
});

test("an uncommitted catalog reports real partial counts and permits a successful retry", async ({
  page,
}) => {
  const { menu, search, refresh } = await openFixture(page);
  await search.fill("model-");
  await refresh.click();
  await expect(menu.getByRole("status")).toHaveText("远程返回 26 个，同步 1 个");
  await expect(refresh).toBeEnabled();
  await expect(search).toHaveValue("model-");
  expect(await page.evaluate(() => Reflect.get(globalThis, "outcomes"))).toEqual([
    { returned: 26, synchronized: 1 },
  ]);
  await refresh.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length)).toBe(2);
  await page.evaluate(() => Reflect.get(globalThis, "commitRefresh")());
  await expect(menu.getByRole("status")).toContainText("同步 26 个");
  await expect(refresh).toBeEnabled();
});

test("a Host without Buddy Router still refreshes its native model catalog", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { menu, refresh } = await openFixture(page);
  await page.evaluate(() => Reflect.get(globalThis, "configureRefresh")({ noBuddy: true }));
  await refresh.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length)).toBe(1);
  await page.evaluate(() => Reflect.get(globalThis, "commitRefresh")());
  await expect(refresh).toBeEnabled();
  await expect(menu.getByRole("status")).toHaveText("模型列表已刷新");
  expect(await page.evaluate(() => Reflect.get(globalThis, "syncs"))).toBe(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual(
    Array.from({ length: 26 }, (_, i) => `model-${i}`),
  );
  expect(errors).toEqual([]);
});

test("provider sync failures and privacy mode leave the native catalog untouched", async ({
  page,
}) => {
  const { menu, refresh } = await openFixture(page);
  await page.evaluate(() => Reflect.get(globalThis, "configureRefresh")({ syncFailure: true }));
  await refresh.click();
  await expect(menu.getByRole("status")).toHaveText("Provider synchronization failed");
  await expect(refresh).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(globalThis, "refetches"))).toEqual([]);
  await page.evaluate(() =>
    Reflect.get(globalThis, "configureRefresh")({ syncFailure: false, privateMode: true }),
  );
  await refresh.click();
  await expect(menu.getByRole("status")).toHaveText("隐私模式下不刷新在线模型目录。");
  expect(await page.evaluate(() => Reflect.get(globalThis, "syncs"))).toBe(1);
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual([
    "model-0",
    "old-a",
    "old-b",
  ]);
});

for (const deferRefetch of [false, true]) {
  test(`a context change during ${deferRefetch ? "refetch" : "React commit wait"} discards old reads and counts`, async ({
    page,
  }) => {
    const { refresh } = await openFixture(page);
    await page.evaluate(
      (deferred) => Reflect.get(globalThis, "configureRefresh")({ deferRefetch: deferred }),
      deferRefetch,
    );
    await refresh.click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, "refetches").length))
      .toBe(1);
    await page.evaluate(() => Reflect.get(globalThis, "changeContext")());
    if (deferRefetch) await page.evaluate(() => Reflect.get(globalThis, "finishRefetch")(true));
    await page.getByRole("button", { name: "收藏模型", exact: true }).click();
    await expect(refresh).toBeEnabled();
    await page.waitForTimeout(75);
    await expect(page.getByRole("status")).not.toBeVisible();
    expect(await page.evaluate(() => Reflect.get(globalThis, "readContexts"))).not.toContain(
      "replacement",
    );
    expect(await page.evaluate(() => Reflect.get(globalThis, "outcomes"))).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(globalThis, "nativeIds")())).toEqual([
      "replacement-model",
    ]);
  });
}
