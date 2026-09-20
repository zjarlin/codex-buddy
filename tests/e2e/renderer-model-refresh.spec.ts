import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { mountRendererModelPicker, renderRendererModelPicker } from "./packages/renderer-extension/src/renderer-model-picker.ts";
      let view = { status: "ready", selected: { id: "a" }, catalog: {
        models: [{ ref: { id: "a" }, label: "Alpha" }], thinkingOptions: []
      }};
      globalThis.refreshes = 0;
      const render = () => renderRendererModelPicker(control, view, true, "pi", "zh-CN");
      const control = mountRendererModelPicker("refresh", () => {}, () => {}, () => {
        globalThis.refreshes++;
        view = { ...view, status: "loading" };
        render();
      });
      globalThis.finishRefresh = (fail) => {
        view = { ...view, status: fail ? "error" : "ready", error: fail ? "Refresh failed" : undefined,
          catalog: { ...view.catalog, models: [
            { ref: { id: "a" }, label: "Alpha" }, { ref: { id: "b" }, label: "Beta" }
          ] }
        };
        render();
      };
      document.body.append(control.root);
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
const browserBundle = outputFiles[0]?.text;
if (!browserBundle) throw new Error("Model refresh test bundle was not generated");

test("manual refresh preserves menu, search and selection, then supports retry", async ({
  page,
}) => {
  await page.setContent(
    '<!doctype html><body style="display:flex;align-items:flex-end;height:100vh;margin:0"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.locator("[data-codexhost-model-control] > button").click();
  const menu = page.locator('[aria-label="Model"]');
  const refresh = page.locator("[data-refresh-models]");
  const search = page.getByRole("searchbox");
  await search.fill("a");
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(menu).toBeVisible();
  await expect(search).toHaveValue("a");
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")(false));
  await expect(menu.locator("[data-model-id=b]")).toBeVisible();
  await expect(menu.locator("[data-model-id=a]")).toHaveAttribute("aria-checked", "true");
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await page.evaluate(() => Reflect.get(globalThis, "finishRefresh")(true));
  await expect(menu.getByRole("status")).toHaveText("Refresh failed");
  await expect(menu).toBeVisible();
  await expect(refresh).toBeEnabled();
  await page.screenshot({ path: "test-results/model-refresh.png" });
  await refresh.click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "refreshes"))).toBe(3);
});
