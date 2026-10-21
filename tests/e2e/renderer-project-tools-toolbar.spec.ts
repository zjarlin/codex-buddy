import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { installProjectTools } from "./packages/renderer-extension/src/project-tools/index.ts";
      import { rowProject } from "./packages/renderer-extension/src/project-tabs/native-binding.ts";

      const state = { openList: [], runList: [], config: null };
      const client = {
        async getProjectTools() {
          return {
            metadataPath: "/root/.codexhost/project-tools.json",
            config: { version: 1, bindings: [{
              target: { projectKind: "local", projectId: "project-1" },
              label: "demo",
              intranetUrl: "http://192.168.31.252:48201/",
              scripts: { start: "/repo/start.sh", restart: "/repo/restart.sh", stop: "/repo/stop.sh" },
              prompt: "make scripts",
            }] },
          };
        },
        async setProjectTools(config) { state.config = config; return { config, metadataPath: "/root/.codexhost/project-tools.json" }; },
        async runProjectScript(params) { state.runList.push(params.action); return { action: params.action, state: "completed", exitCode: 0, output: "", logPath: "/tmp/log" }; },
      };
      globalThis.open = (url) => { state.openList.push(url); return null; };
      globalThis.demo = { state, client, installProjectTools, rowProject };
    `,
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});

test("renders project actions in the titlebar and directly on the project row", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      body { margin: 0; font: 13px system-ui; }
      header { height: 44px; display: flex; align-items: center; padding: 0 12px; gap: 8px; }
      [data-app-shell-titlebar-content] { display: flex; align-items: center; gap: 8px; min-width: 0; }
      aside { width: 280px; padding: 8px; }
      [data-app-action-sidebar-project-row] { display: flex; align-items: center; gap: 4px; }
      [data-app-action-sidebar-project-label] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    </style>
    <header>
      <div data-app-shell-titlebar-content="" data-codexhost-titlebar-project="demo">
        <span>修正模型列表</span>
        <span>demo</span>
      </div>
    </header>
    <aside id="app-shell-sidebar">
      <div role="listitem" data-sidebar-project-container-id="project:project-1" data-sidebar-project-kind="local">
        <div data-app-action-sidebar-project-row="" data-app-action-sidebar-project-id="project-1" data-app-action-sidebar-project-label="demo">
          <span data-app-action-sidebar-project-label="">demo</span>
        </div>
      </div>
    </aside>
  `);
  await page.addScriptTag({ content: outputFiles[0]?.text ?? "" });
  await page.evaluate(() => {
    const demo = Reflect.get(globalThis, "demo");
    const row = document.querySelector(
      "[data-sidebar-project-container-id=project\\:project-1] [data-app-action-sidebar-project-row]",
    );
    Object.defineProperty(row, "__reactFiber$test", {
      value: {
        memoizedProps: {
          project: {
            projectKind: "local",
            projectId: "project-1",
            label: "demo",
            path: "/repo/demo",
          },
        },
      },
    });
    demo.control = demo.installProjectTools({
      getLocale: () => "zh-CN",
      getClient: () => demo.client,
    });
  });

  const titlebar = page.locator("[data-codexhost-project-titlebar-tools]");
  await expect(titlebar).toBeVisible();
  await expect(titlebar.locator("button")).toHaveCount(6);
  await expect(titlebar.locator("[data-codexhost-project-tool-more]")).toHaveCount(0);
  await expect(
    page.locator("[data-codexhost-project-tools] [data-codexhost-project-tool-more]"),
  ).toHaveCount(0);
  await expect(page.locator("[data-codexhost-project-tools] button")).toHaveCount(6);

  await titlebar.locator("[data-codexhost-project-tool-url]").click();
  await expect(titlebar.locator("a")).toHaveCount(1);
  await titlebar.locator("[data-codexhost-project-tool-action]").first().click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "demo").state.runList))
    .toEqual(["start"]);
});

test("adds, saves, and runs custom scripts from the dialog and titlebar", async ({ page }) => {
  await page.setContent(`
    <style>
      body { margin: 0; font: 13px system-ui; }
      header { height: 44px; display: flex; align-items: center; padding: 0 12px; gap: 8px; }
      [data-app-shell-titlebar-content] { display: flex; align-items: center; gap: 8px; min-width: 0; }
      aside { width: 280px; padding: 8px; }
      [data-app-action-sidebar-project-row] { display: flex; align-items: center; gap: 4px; }
      [data-app-action-sidebar-project-label] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    </style>
    <header>
      <div data-app-shell-titlebar-content="" data-codexhost-titlebar-project="demo">
        <span>修正模型列表</span>
        <span>demo</span>
      </div>
    </header>
    <aside id="app-shell-sidebar">
      <div role="listitem" data-sidebar-project-container-id="project:project-1" data-sidebar-project-kind="local">
        <div data-app-action-sidebar-project-row="" data-app-action-sidebar-project-id="project-1" data-app-action-sidebar-project-label="demo">
          <span data-app-action-sidebar-project-label="">demo</span>
        </div>
      </div>
    </aside>
  `);
  await page.addScriptTag({ content: outputFiles[0]?.text ?? "" });
  await page.evaluate(() => {
    const demo = Reflect.get(globalThis, "demo");
    const row = document.querySelector(
      "[data-sidebar-project-container-id=project\\:project-1] [data-app-action-sidebar-project-row]",
    );
    Object.defineProperty(row, "__reactFiber$test", {
      value: {
        memoizedProps: {
          project: {
            projectKind: "local",
            projectId: "project-1",
            label: "demo",
            path: "/repo/demo",
          },
        },
      },
    });
    demo.control = demo.installProjectTools({
      getLocale: () => "zh-CN",
      getClient: () => demo.client,
    });
  });

  const titlebar = page.locator("[data-codexhost-project-titlebar-tools]");
  const rowTools = page.locator("[data-codexhost-project-tools]");
  await titlebar.locator("[data-codexhost-project-tool-configure]").click();
  const dialog = page.locator("[data-codexhost-project-tools-dialog]");
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-codexhost-project-tool-metadata-path]")).toHaveValue(
    "/root/.codexhost/project-tools.json",
  );

  await dialog.locator("[data-codexhost-project-tool-add-script]").click();
  const custom = dialog.locator(
    "[data-codexhost-project-tool-custom-scripts] .codexhost-project-tool-custom-row",
  );
  await expect(custom).toHaveCount(1);
  await custom.locator("input").first().fill("部署");
  await custom.locator("input").nth(1).fill("/repo/deploy.sh");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();

  const saved = await page.evaluate(() => Reflect.get(globalThis, "demo").state.config);
  expect(saved.bindings[0].customScripts).toEqual([
    { id: "部署", name: "部署", path: "/repo/deploy.sh" },
  ]);

  await expect(rowTools.locator("[data-codexhost-project-tool-action]")).toHaveCount(4);
  await rowTools.locator(".codexhost-project-tool-custom").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "demo").state.runList))
    .toEqual(["部署"]);
});
