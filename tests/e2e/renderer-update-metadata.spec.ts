import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const { outputFiles } = await build({
  stdin: {
    contents: `import { createDefaultRendererSettingsPages } from "./packages/renderer-extension/src/settings/pages.ts";
      import { createRendererSettingsPageRegistry } from "./packages/renderer-extension/src/settings/core.ts";
      import { rendererSettingsMessages } from "./packages/renderer-extension/src/settings/localization.ts";
      import { mountRendererSettingsShell } from "./packages/renderer-extension/src/settings/shell.ts";
      const messages = rendererSettingsMessages("zh-CN");
      const client = {
        checkUpdate: () => new Promise((_, reject) => setTimeout(() => reject(new Error("API unavailable")), 2000)),
        readUpdateStatus: async () => ({ currentVersion: "0.10.29", installation: "macos-dmg", status: null }),
        startUpdate: async () => { throw new Error("Not part of this fixture"); },
      };
      const registry = createRendererSettingsPageRegistry(createDefaultRendererSettingsPages(messages, () => client).filter(page => page.id === "updates"));
      const shell = mountRendererSettingsShell(registry, document, messages);
      shell.openSettings(undefined, "updates");`,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Updates fixture bundle missing");

test("shows installed version before online discovery and preserves it after failure", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.route("http://localhost/update-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><body></body></html>',
    }),
  );
  await page.goto("http://localhost/update-test");
  await page.addScriptTag({ content: bundle });
  const metadata = page.locator(".settings-update-metadata");
  const panel = page.locator(".settings-update-panel");
  await expect(metadata).toContainText("v0.10.29");
  await expect(metadata).toContainText("macOS DMG");
  await expect(panel).toHaveAttribute("data-update-state", "pending");
  await page.screenshot({ path: testInfo.outputPath("local-version-pending.png") });
  await expect(panel).toHaveAttribute("data-update-state", "failed");
  await expect(metadata).toContainText("v0.10.29");
  await expect(metadata).toContainText("macOS DMG");
  await expect(panel).not.toContainText("当前已是最新版本");
  await page.screenshot({ path: testInfo.outputPath("local-version-failed.png") });
});
