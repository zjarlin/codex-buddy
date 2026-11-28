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
      import { installProjectTools } from "./packages/renderer-extension/src/project-tools/index.ts";
      import { RendererMethodUnavailableError } from "./packages/renderer-extension/src/renderer-request-sender.ts";

      globalThis.setupUnsupportedHost = () => {
        document.documentElement.lang = "zh-CN";
        localStorage.setItem("codexhost.thread-folders.v1", JSON.stringify({
          version: 1,
          projects: {
            '["local","local","one"]': { folders: [{ id: "plan", name: "计划" }], assignments: {}, selected: null },
          },
        }));
        localStorage.setItem("codexhost.project-tools.v1", JSON.stringify({
          version: 1,
          bindings: [{
            target: { projectKind: "local", projectId: "one" },
            label: "项目一",
            intranetUrl: "http://127.0.0.1:1234/",
          }],
        }));
        document.body.innerHTML = '<header><div data-app-shell-titlebar-content="" data-codexhost-titlebar-project="项目一"><span>项目一</span></div></header><aside id="app-shell-sidebar"></aside>';
        const bind = (element, value) => {
          Object.defineProperty(element, "__reactFiber$fixture", { enumerable: true, configurable: true, value });
        };
        const fiber = (props, parent = null) => ({ memoizedProps: props, return: parent, key: null });
        for (const projectId of ["one", "two"]) {
          const label = projectId === "one" ? "项目一" : "项目二";
          const section = document.createElement("section");
          section.setAttribute("role", "listitem");
          section.setAttribute("data-sidebar-project-kind", "local");
          section.setAttribute("data-sidebar-project-container-id", "project:" + projectId);
          bind(section, fiber({ project: { projectKind: "local", projectId, label, path: "/repo/" + projectId } }));
          const header = document.createElement("button");
          header.setAttribute("data-app-action-sidebar-project-row", "");
          header.setAttribute("aria-expanded", "true");
          header.innerHTML = '<span data-app-action-sidebar-project-label>' + label + '</span>';
          section.append(header);
          document.querySelector("#app-shell-sidebar").append(section);
        }
        // 该 Host 连接明确没有这三类 RPC：每次调用都被拒绝为 -32601。
        const calls = [];
        const unavailable = (method) => {
          calls.push(method);
          return Promise.reject(new RendererMethodUnavailableError(method, { code: -32601 }));
        };
        const client = {
          getThreadFolders: () => unavailable("codexhost/settings/thread-folders/get"),
          setThreadFolders: () => unavailable("codexhost/settings/thread-folders/set"),
          getProjectTools: () => unavailable("codexhost/settings/project-tools/get"),
          setProjectTools: () => unavailable("codexhost/settings/project-tools/set"),
          runProjectScript: () => unavailable("codexhost/project/tools/run-script"),
        };
        const folders = installThreadFolders({ getLocale: () => "zh-CN", getClient: () => client });
        const tools = installProjectTools({ getLocale: () => "zh-CN", getClient: () => client });
        folders.refresh();
        globalThis.unsupportedFixture = { folders, tools, calls, dispose: () => { tools.dispose(); folders.dispose(); } };
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".svg": "dataurl", ".png": "dataurl", ".css": "text" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Unsupported-host fixture bundle is unavailable");

test("capability-absent Host renders no error surfaces and keeps local mirrors usable", async ({
  page,
}) => {
  await page.route("https://unsupported.test/", (route) =>
    route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }),
  );
  await page.goto("https://unsupported.test/");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupUnsupportedHost")());

  const projectOne = page.locator('[data-sidebar-project-container-id="project:one"]');
  // 本地镜像照常投影：文件夹树还在，说明降级不是「功能消失」。
  await expect(projectOne.locator("[data-codexhost-thread-folders]")).toContainText("计划");
  // 本地镜像里的内网地址同样照常投影成按钮。
  await expect(projectOne.locator("[data-codexhost-project-tool-url]")).toHaveCount(1);

  // 关键断言：能力缺失不得渲染成任何用户可见错误。
  await expect(page.locator('[role="alert"]').filter({ hasText: "unsupported" })).toHaveCount(0);
  await expect(page.locator('[role="alert"]').filter({ hasText: "读写失败" })).toHaveCount(0);
  await expect(page.locator("[data-codexhost-project-tool-toast]")).toHaveCount(0);
  await expect(page.locator("[data-codexhost-project-tabs-error]")).toHaveCount(0);

  // 侧栏反复变化只允许一次探测：能力缺失不会自愈，重试只会重复刷同一句错误。
  for (let index = 0; index < 5; index += 1) {
    await page.evaluate(() => {
      const aside = document.querySelector("#app-shell-sidebar");
      if (!aside) throw new Error("sidebar fixture is missing");
      const filler = document.createElement("div");
      aside.append(filler);
      filler.remove();
    });
    await page.waitForTimeout(120);
  }
  const counts = await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "unsupportedFixture") as { calls: string[] };
    const tally: Record<string, number> = {};
    for (const method of fixture.calls) tally[method] = (tally[method] ?? 0) + 1;
    return { tally, total: fixture.calls.length };
  });
  expect(counts.tally["codexhost/settings/thread-folders/get"]).toBe(1);
  expect(counts.tally["codexhost/settings/project-tools/get"]).toBe(1);

  await expect(page.locator('[role="alert"]').filter({ hasText: "unsupported" })).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "unsupportedFixture").dispose());
  expect(errors).toEqual([]);
});
