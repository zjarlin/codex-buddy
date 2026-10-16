import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) {
  test.use({ launchOptions: { executablePath: browserExecutable } });
}

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installThreadFolders } from "./packages/renderer-extension/src/thread-folders/index.ts";
      import { installRendererThreadActions } from "./packages/renderer-extension/src/renderer-thread-actions.ts";

      globalThis.setupThreadFolders = () => {
        document.documentElement.lang = "zh-CN";
        document.body.innerHTML = '<style>body{margin:0;background:#202124;color:#eee;font:13px system-ui}aside{width:300px;min-height:100vh;padding:12px;box-sizing:border-box;background:#292a2e}section{margin:8px 0 14px}section>button{width:100%;padding:8px;text-align:left;border:0;background:transparent;color:inherit;font-weight:600}section>[data-app-action-sidebar-thread-row]{padding-left:24px;font-weight:400}[data-thread-title-trigger]{display:block;min-width:0}[data-codexhost-thread-actions-trigger]{float:right}</style><aside id="app-shell-sidebar"></aside>';
        const projects = [
          { projectKind: "local", projectId: "one", label: "项目一", folder: { id: "plan", name: "计划" }, threads: [["thread-a", "任务 A", { type: "loading", unread: false, unreadCount: 0 }], ["thread-b", "任务 B", { type: "idle", unread: true, unreadCount: 0 }]] },
          { projectKind: "local", projectId: "two", label: "项目二", folder: { id: "done", name: "归档" }, threads: [["thread-c", "任务 C"]] },
        ];
        const bind = (element, value) => Object.defineProperty(element, "__reactFiber$fixture", { enumerable: true, value });
        const fiber = (props, parent = null) => ({ memoizedProps: props, return: parent, key: null });
        for (const project of projects) {
          const section = document.createElement("section");
          section.setAttribute("role", "listitem");
          section.setAttribute("data-sidebar-project-kind", project.projectKind);
          section.setAttribute("data-sidebar-project-container-id", "project:" + project.projectId);
          bind(section, fiber({ group: { projectKind: project.projectKind, projectId: project.projectId, label: project.label } }));
          const header = document.createElement("button");
          header.setAttribute("data-app-action-sidebar-project-row", "");
          header.setAttribute("aria-expanded", "true");
          header.textContent = project.label;
          section.append(header);
          for (const [threadId, title, statusState] of project.threads) {
            const row = document.createElement("button");
            const dataAttributes = {
              "data-app-action-sidebar-thread-row": "",
              "data-app-action-sidebar-thread-host-id": "local",
              "data-app-action-sidebar-thread-id": "local:" + threadId,
            };
            for (const [name, value] of Object.entries(dataAttributes)) row.setAttribute(name, value);
            bind(row, fiber({ conversationId: threadId, dataAttributes, statusState }));
            row.innerHTML = '<span data-thread-title-trigger><span data-thread-title>' + title + '</span></span>';
            row.addEventListener("click", () => { globalThis.openedFolderThread = threadId; });
            section.append(row);
          }
          document.querySelector("#app-shell-sidebar").append(section);
        }
        // 原生收起项目时会同时改写项目头的 aria-expanded 并卸载该项目下的会话行；
        // 这里用同一对动作模拟，便于断言外部投影的文件夹树跟随收起。
        const toggleProject = (projectId, expanded) => {
          const section = document.querySelector('[data-sidebar-project-container-id="project:' + projectId + '"]');
          section.querySelector('[data-app-action-sidebar-project-row]').setAttribute("aria-expanded", String(expanded));
          for (const row of [...section.querySelectorAll("[data-app-action-sidebar-thread-row]")]) {
            if (expanded) section.append(row);
            else row.remove();
          }
        };
        const control = (label, action) => {
          const element = document.createElement("button");
          element.type = "button";
          element.textContent = label;
          element.addEventListener("click", action);
          document.body.append(element);
        };
        control("折叠项目一", () => toggleProject("one", false));
        control("展开项目一", () => toggleProject("one", true));
        let saved = {
          version: 1,
          projects: {
            '["local","local","one"]': { folders: [{ id: "plan", name: "计划" }], assignments: {}, selected: null },
            '["local","local","two"]': { folders: [{ id: "done", name: "归档" }], assignments: {}, selected: null },
          },
        };
        const writes = [];
        const client = {
          getThreadFolders: async () => ({ config: saved }),
          setThreadFolders: async (config) => { saved = structuredClone(config); writes.push(saved); return { config: saved }; },
          openThreadTerminal: async () => ({ workspace: "/tmp/one", terminal: "terminal" }),
          openThreadWorkspace: async () => ({ workspace: "/tmp/one", application: "vscode" }),
        };
        const folderControl = installThreadFolders({ getLocale: () => "zh-CN", getClient: () => client });
        const actionsControl = installRendererThreadActions({ getClient: () => client, getLocale: () => "zh-CN", threadFolders: folderControl.threadMenu });
        folderControl.refresh();
        actionsControl.refresh();
        globalThis.threadFolderFixture = { folderControl, actionsControl, writes, config: () => saved, dispose: () => { actionsControl.dispose(); folderControl.dispose(); } };
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Thread folder fixture bundle is unavailable");

test("groups conversations independently per project and restores native rows on dispose", async ({
  page,
}) => {
  await page.route("https://folders.test/", (route) =>
    route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }),
  );
  await page.goto("https://folders.test/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupThreadFolders")());

  const projectOne = page.locator('[data-sidebar-project-container-id="project:one"]');
  const projectTwo = page.locator('[data-sidebar-project-container-id="project:two"]');
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).toContainText("计划");
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).not.toContainText("归档");
  await expect(projectTwo.locator("[data-codexhost-thread-folders]")).toContainText("归档");
  await expect(projectTwo.locator("[data-codexhost-thread-folders]")).not.toContainText("计划");

  // 未归档的原生行也应保留原生未读蓝点语义：这里先确认 thread-b 的未读状态
  // 在投影后仍可见，避免只覆盖 running。
  const rowA = projectOne.locator('[data-app-action-sidebar-thread-id="local:thread-a"]');
  await rowA.click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到文件夹…", exact: true }).click();
  await page
    .locator("[data-codexhost-thread-folder-dialog]")
    .getByRole("button", { name: "计划", exact: true })
    .click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Reflect.get(globalThis, "threadFolderFixture").config().projects[
            '["local","local","one"]'
          ].assignments["thread-a"],
      ),
    )
    .toBe("plan");

  const filed = projectOne.locator('[data-codexhost-folder-thread="thread-a"]');
  await expect(filed).toBeVisible();
  // 归档后的会话入口仍投影原生状态：执行中转圈、未读蓝点。
  await expect(filed).toHaveAttribute("data-codexhost-folder-thread-status", "running");
  await expect(filed.locator("svg")).toBeVisible();
  await filed.click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "openedFolderThread"))).toBe("thread-a");
  await page.screenshot({ path: "test-results/thread-folder-tree.png" });
  await expect(rowA).toBeHidden();
  await expect(projectOne.getByText("任务 B")).toBeVisible();
  await expect(projectTwo.getByText("任务 C")).toBeVisible();
  await projectOne.getByRole("button", { name: "计划", exact: true }).click();
  await expect(filed).toBeHidden();
  await projectOne.getByRole("button", { name: "计划", exact: true }).click();
  await expect(filed).toBeVisible();

  await filed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到文件夹…", exact: true }).click();
  await page.getByRole("button", { name: "未分类", exact: true }).click();
  await expect(rowA).toBeVisible();
  await expect(filed).toHaveCount(0);

  await projectOne.locator("[data-app-action-sidebar-project-row]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建文件夹", exact: true }).click();
  await page.getByRole("dialog").locator("input").last().fill("新文件夹");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(projectOne.getByRole("button", { name: "新文件夹", exact: true })).toBeVisible();
  await expect(projectOne.getByRole("tab")).toHaveCount(0);

  await page.evaluate(() => Reflect.get(globalThis, "threadFolderFixture").dispose());
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).toHaveCount(0);
  await expect(rowA).toBeVisible();
  await expect(projectOne.getByText("任务 B")).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "threadFolderFixture").writes.length),
  ).toBe(3);
  expect(errors).toEqual([]);
});

test("hides the projected folder tree while the native project row is collapsed", async ({
  page,
}) => {
  await page.route("https://folders.test/", (route) =>
    route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }),
  );
  await page.goto("https://folders.test/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupThreadFolders")());

  const projectOne = page.locator('[data-sidebar-project-container-id="project:one"]');
  const projectTwo = page.locator('[data-sidebar-project-container-id="project:two"]');
  const tree = projectOne.locator("[data-codexhost-thread-folders]");
  await expect(tree).toBeVisible();
  await expect(tree).toContainText("计划");

  await page.getByRole("button", { name: "折叠项目一", exact: true }).click();
  await expect(tree).toBeHidden();
  await expect(projectOne.getByRole("button", { name: "计划", exact: true })).toBeHidden();
  // 折叠一个项目不影响其他项目的投影。
  await expect(projectTwo.locator("[data-codexhost-thread-folders]")).toBeVisible();

  await page.getByRole("button", { name: "展开项目一", exact: true }).click();
  await expect(tree).toBeVisible();
  await expect(projectOne.getByRole("button", { name: "计划", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
