import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { installProjectTools } from "./packages/renderer-extension/src/project-tools/index.ts";
      import { rowProject } from "./packages/renderer-extension/src/project-tabs/native-binding.ts";
      import { installRendererProjectActions } from "./packages/renderer-extension/src/renderer-project-actions.ts";

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
      const nativeCalls = [];
      const fiber = (props, parent = null, key = null) => ({
        memoizedProps: props,
        return: parent,
        key,
        child: null,
        sibling: null,
        stateNode: null,
      });
      // 最小原生项目菜单：真实 Desktop 的菜单项 Fiber 链与这里一致。
      globalThis.mountNativeMenu = (project) => {
        const trigger = document.querySelector("[data-demo-menu-trigger]");
        trigger.addEventListener("click", () => {
          document.querySelector("[role=menu]")?.remove();
          const menu = document.createElement("div");
          menu.setAttribute("role", "menu");
          const close = () => { menu.remove(); trigger.focus(); };
          const projectFiber = fiber({ project });
          const owner = fiber({
            getContextMenuItems: () => [],
            triggerAriaLabel: project.label + " 项目操作",
            onOpenChange: (open) => { if (!open) close(); },
          }, projectFiber);
          const menuFiber = fiber({ role: "menu" }, owner);
          const labels = [
            ["pin-project", "置顶"],
            ["edit-project", "编辑"],
            ["reveal-project-folder", "在访达中显示"],
            ["archive-project-threads", "归档聊天"],
            ["remove-project", "移除项目"],
          ];
          let previous = null;
          for (const [id, label] of labels) {
            const element = document.createElement("div");
            element.setAttribute("role", "menuitem");
            element.tabIndex = -1;
            element.textContent = label;
            element.addEventListener("click", () => { nativeCalls.push(id); close(); });
            const itemFiber = fiber({ role: "menuitem" }, menuFiber, id);
            const hostFiber = fiber({ role: "menuitem" }, itemFiber);
            itemFiber.child = hostFiber;
            if (previous) previous.sibling = itemFiber;
            else menuFiber.child = itemFiber;
            previous = itemFiber;
            // 原生 React 把 fiber 挂成可枚举自有属性，rowProject/menu 解析依赖它。
            Object.defineProperty(element, "__reactFiber$demo", {
              configurable: true,
              enumerable: true,
              value: hostFiber,
            });
            menu.append(element);
          }
          document.body.append(menu);
          menu.querySelector("[role=menuitem]")?.focus();
        });
      };
      globalThis.demo = {
        state,
        client,
        nativeCalls,
        installProjectTools,
        rowProject,
        installRendererProjectActions,
        mountNativeMenu: globalThis.mountNativeMenu,
      };
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
          <button type="button" data-demo-menu-trigger aria-label="demo 项目操作">…</button>
        </div>
      </div>
    </aside>
  `);
  await page.addScriptTag({ content: outputFiles[0]?.text ?? "" });
  await page.evaluate(
    () => {
      const demo = Reflect.get(globalThis, "demo");
      // 原生行组件挂在 listitem 上：rowProject 从容器向上读 React 树。
      const row = document.querySelector("[data-sidebar-project-container-id=project\\:project-1]");
      Object.defineProperty(row, "__reactFiber$test", {
        configurable: true,
        enumerable: true,
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
      demo.actions = demo.installRendererProjectActions({
        getClient: () => demo.client,
        getLocale: () => "zh-CN",
      });
      demo.control = demo.installProjectTools({
        getLocale: () => "zh-CN",
        getClient: () => demo.client,
      });
      demo.actions.registerContribution(demo.control.menuContribution());
    },
    { timeout: 120000 },
  );

  const titlebar = page.locator("[data-codexhost-project-titlebar-tools]");
  const rowTools = page.locator("[data-codexhost-project-tools]");
  await expect(titlebar).toBeVisible();
  // 配置与 Prompt 不再直接出现在标题栏或项目行上。
  await expect(titlebar.locator("[data-codexhost-project-tool-configure]")).toHaveCount(0);
  await expect(titlebar.locator("[data-codexhost-project-tool-prompt]")).toHaveCount(0);
  await expect(rowTools.locator("[data-codexhost-project-tool-configure]")).toHaveCount(0);
  await expect(rowTools.locator("[data-codexhost-project-tool-prompt]")).toHaveCount(0);
  // 只剩一个访问地址按钮和三个脚本动作。
  await expect(rowTools.locator("button")).toHaveCount(4);

  // 只绑定一个地址时不弹选择器，直接在项目行上打开。
  await rowTools.locator("[data-codexhost-project-tool-url]").click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "demo").state.openList)).toEqual([
    "http://192.168.31.252:48201/",
  ]);
  await rowTools.locator("[data-codexhost-project-tool-action]").first().click();
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
          <button type="button" data-demo-menu-trigger aria-label="demo 项目操作">…</button>
        </div>
      </div>
    </aside>
  `);
  await page.addScriptTag({ content: outputFiles[0]?.text ?? "" });
  await page.evaluate(
    () => {
      const demo = Reflect.get(globalThis, "demo");
      // 原生行组件挂在 listitem 上：rowProject 从容器向上读 React 树。
      const row = document.querySelector("[data-sidebar-project-container-id=project\\:project-1]");
      Object.defineProperty(row, "__reactFiber$test", {
        configurable: true,
        enumerable: true,
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
      demo.actions = demo.installRendererProjectActions({
        getClient: () => demo.client,
        getLocale: () => "zh-CN",
      });
      demo.control = demo.installProjectTools({
        getLocale: () => "zh-CN",
        getClient: () => demo.client,
      });
      demo.actions.registerContribution(demo.control.menuContribution());
      demo.mountNativeMenu({
        projectKind: "local",
        projectId: "project-1",
        label: "demo",
        path: "/repo/demo",
      });
    },
    { timeout: 120000 },
  );

  const rowTools = page.locator("[data-codexhost-project-tools]");
  await page.locator("[data-demo-menu-trigger]").click();
  const menu = page.locator('[role="menu"]');
  await expect(menu).toBeVisible();
  // 两个高风险入口都收在“…”菜单里，排在原生归档/移除之前。
  await expect(menu.getByRole("menuitem")).toHaveText([
    "置顶",
    "编辑",
    "在访达中显示",
    "复制绝对路径",
    "在终端中打开",
    "用 VS Code 打开",
    "配置项目快捷操作",
    "打开 Prompt",
    "归档聊天",
    "移除项目",
  ]);
  await menu.locator("[data-codexhost-project-tool-configure]").click();
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
  // 中文名没有 ASCII 片段，标识回落到 script；名称与路径原样保存。
  expect(saved.bindings[0].customScripts).toEqual([
    { id: "script", name: "部署", path: "/repo/deploy.sh" },
  ]);

  // 内置 start/restart/stop 之后追加自定义脚本，按钮用脚本名做无障碍名称。
  await expect(rowTools.locator("[data-codexhost-project-tool-action]")).toHaveCount(4);
  await rowTools.getByRole("button", { name: "部署: demo" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "demo").state.runList))
    .toEqual(["script"]);
});
