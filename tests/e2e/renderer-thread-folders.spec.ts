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
          { projectKind: "local", projectId: "one", label: "项目一", folder: { id: "plan", name: "计划" }, threads: [["thread-a", "任务 A"], ["thread-b", "任务 B"]] },
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
          header.textContent = project.label;
          section.append(header);
          for (const [threadId, title] of project.threads) {
            const row = document.createElement("button");
            const dataAttributes = {
              "data-app-action-sidebar-thread-row": "",
              "data-app-action-sidebar-thread-host-id": "local",
              "data-app-action-sidebar-thread-id": "local:" + threadId,
            };
            for (const [name, value] of Object.entries(dataAttributes)) row.setAttribute(name, value);
            bind(row, fiber({ conversationId: threadId, dataAttributes }));
            row.innerHTML = '<span data-thread-title-trigger><span data-thread-title>' + title + '</span></span>';
            section.append(row);
          }
          document.querySelector("#app-shell-sidebar").append(section);
        }
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
  await page.setContent("");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupThreadFolders")());

  const projectOne = page.locator('[data-sidebar-project-container-id="project:one"]');
  const projectTwo = page.locator('[data-sidebar-project-container-id="project:two"]');
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).toContainText("计划");
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).not.toContainText("归档");
  await expect(projectTwo.locator("[data-codexhost-thread-folders]")).toContainText("归档");
  await expect(projectTwo.locator("[data-codexhost-thread-folders]")).not.toContainText("计划");

  const rowA = projectOne.locator('[data-app-action-sidebar-thread-id="local:thread-a"]');
  await rowA.hover();
  await rowA.locator("[data-codexhost-thread-actions-trigger]").click();
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

  await projectOne.getByRole("button", { name: "计划", exact: true }).click();
  await expect(rowA).toBeVisible();
  await expect(projectOne.getByText("任务 B")).toBeHidden();
  await expect(projectTwo.getByText("任务 C")).toBeVisible();

  await projectOne.getByRole("button", { name: "未分类", exact: true }).click();
  await expect(rowA).toBeHidden();
  await expect(projectOne.getByText("任务 B")).toBeVisible();

  await page.evaluate(() => Reflect.get(globalThis, "threadFolderFixture").dispose());
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).toHaveCount(0);
  await expect(rowA).toBeVisible();
  await expect(projectOne.getByText("任务 B")).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "threadFolderFixture").writes.length),
  ).toBe(3);
});
