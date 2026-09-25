import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { createProjectSyncPage } from "./packages/renderer-extension/src/settings/project-sync-page.ts";
      import { createRendererSettingsPageRegistry } from "./packages/renderer-extension/src/settings/core.ts";
      import { rendererSettingsMessages } from "./packages/renderer-extension/src/settings/localization.ts";
      import { mountRendererSettingsShell } from "./packages/renderer-extension/src/settings/shell.ts";

      globalThis.setupProjectSync = (theme) => {
        document.documentElement.style.colorScheme = theme;
        const calls = [];
        let snapshot = { peers: [], pending: [{ requestId: "eb28d531-8ba0-4733-a24b-61bc6b2fa84c", name: "Desktop", fingerprint: "a123456789abcdef" }], connected: true, relay: "wss://relay.example.test", gitRemote: null, projects: [{
          name: "example", remote: "https://github.com/example/example.git", localPath: null, state: "missing"
        }] };
        const client = {
          inspectProjectSync: async () => snapshot,
          inviteProjectSync: async () => { calls.push(["invite"]); return { code: "12345678", expiresAt: Date.now() + 300000 }; },
          pairProjectSync: async ({ code }) => { calls.push(["pair", code]); snapshot = { ...snapshot, peers: [{ id: "53a62eae-5a99-4427-95d1-cb6cd1d340b8", name: "Laptop" }] }; return snapshot; },
          acceptProjectSync: async ({ requestId }) => { calls.push(["accept", requestId]); snapshot = { ...snapshot, pending: [] }; return snapshot; },
          rejectProjectSync: async () => snapshot,
          configureProjectSyncGit: async ({ remote }) => { calls.push(["git", remote]); snapshot = { ...snapshot, gitRemote: remote }; return snapshot; },
          pullProjectSyncGit: async () => { calls.push(["pull"]); return snapshot; },
          pushProjectSyncGit: async () => snapshot,
          syncProjectSync: async ({ peerId }) => { calls.push(["sync", peerId]); return snapshot; },
          removeProjectSyncPeer: async () => snapshot,
          addProjectSync: async () => snapshot,
          bindProjectSync: async () => snapshot,
          cloneProjectSync: async () => snapshot,
        };
        const messages = rendererSettingsMessages("zh-CN");
        const registry = createRendererSettingsPageRegistry([createProjectSyncPage(messages, () => client)]);
        const shell = mountRendererSettingsShell(registry, document, messages);
        shell.openSettings(undefined, "project-sync");
        globalThis.projectSyncFixture = { calls, dispose: () => shell.dispose() };
      };
    `,
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
const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Project sync fixture bundle missing");

async function setup(page: Page, theme: "light" | "dark", width: number): Promise<void> {
  await page.setViewportSize({ width, height: 850 });
  await page.route("http://localhost/project-sync-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto("http://localhost/project-sync-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((scheme) => Reflect.get(globalThis, "setupProjectSync")(scheme), theme);
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 420]) {
    test(`project sync settings ${theme} ${width}px`, async ({ page }) => {
      await setup(page, theme, width);
      const root = page.locator("[data-codexhost-settings-shell]");
      const dialog = root.locator("dialog");
      await expect(dialog).toBeVisible();
      await expect(root.getByText("本机未检出")).toBeVisible();
      await root.getByRole("button", { name: "同意" }).click();
      await root.getByRole("button", { name: "生成配对码" }).click();
      await expect(root.getByText(/12345678/)).toBeVisible();
      await root.getByLabel("对端配对码").fill("12345678");
      await root.getByRole("button", { name: "配对设备" }).click();
      await root.getByRole("button", { name: "同步" }).click();
      await root.getByLabel("私有 Git 清单仓库").fill("https://github.com/example/catalog.git");
      await root.getByRole("button", { name: "保存仓库" }).click();
      await root.getByRole("button", { name: "拉取清单" }).click();
      const calls = await page.evaluate(() => Reflect.get(globalThis, "projectSyncFixture").calls);
      expect(calls).toEqual([
        ["accept", "eb28d531-8ba0-4733-a24b-61bc6b2fa84c"],
        ["invite"],
        ["pair", "12345678"],
        ["sync", "53a62eae-5a99-4427-95d1-cb6cd1d340b8"],
        ["git", "https://github.com/example/catalog.git"],
        ["pull"],
      ]);
      const metrics = await root.evaluate((element) => {
        const dialog = element.shadowRoot?.querySelector("dialog");
        const content = element.shadowRoot?.querySelector(".settings-page__content");
        return {
          background: dialog ? getComputedStyle(dialog).backgroundColor : "",
          overflowing: content ? content.scrollWidth > content.clientWidth + 1 : true,
        };
      });
      expect(metrics.overflowing).toBe(false);
      expect(metrics.background).toBe(theme === "dark" ? "rgb(32, 32, 32)" : "rgb(255, 255, 255)");
    });
  }
}
