import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererProjectDashboard } from "./packages/renderer-extension/src/renderer-project-dashboard.ts";
      globalThis.setupProjectDashboard = (options = {}) => {
        const main = '<main data-app-shell-main-surface="default">Conversation</main>';
        document.body.innerHTML = \`
          <style>body{margin:0}header{position:fixed;inset:0 0 auto 0;height:44px;display:flex;align-items:center}main{position:fixed;inset:44px 0 0 180px}</style>
          <header data-pip-obstacle="app-shell-header"><div data-app-shell-header-obstacle="true">actions</div></header>
          \${options.deferMain ? "" : main}
          <aside id="app-shell-sidebar"><button data-app-action-sidebar-thread-row data-app-action-sidebar-thread-host-id="local">row</button></aside>
        \`;
        const calls = [];
        const opened = [];
        const request = async (method, params) => {
          calls.push([method, params]);
          if (method === "thread/list") return { data: options.empty ? [] : [
            { id: "thread-a", cwd: "/repo/codex-host", name: "实现盯盘", updatedAt: 1700000000000, status: { type: options.idleOnly ? "idle" : "active" } },
            { id: "thread-b", cwd: "/repo/docs", name: "更新文档", updatedAt: 1699999999000, status: { type: "idle" } },
          ] };
          if (params.threadId === "thread-a") return { data: [{
            id: "turn-1", status: "completed", startedAt: 1700000000, completedAt: 1700000060, durationMs: 60000,
            items: [
              { id: "u", type: "userMessage", content: [{ type: "text", text: "实现项目看板" }] },
              { id: "f", type: "fileChange", changes: [{ path: "src/a.ts", kind: { type: "update" }, diff: "@@ -1 +1,2 @@\\n-old\\n+new\\n+more" }] },
              { id: "a", type: "agentMessage", text: "实现完成，测试通过。" },
            ],
          }] };
          return { data: [{ id: "turn-2", status: "completed", items: [
            { id: "u2", type: "userMessage", content: [{ type: "text", text: "更新文档" }] },
            { id: "a2", type: "agentMessage", text: "文档已更新。" },
          ] }] };
        };
        const control = installRendererProjectDashboard({
          getRequest: () => request,
          getHostIds: () => ["local"],
          onOpenThread: (threadId, hostId) => opened.push([threadId, hostId]),
        });
        globalThis.projectDashboard = { control, calls, opened };
        if (options.deferMain) {
          setTimeout(() => document.body.insertAdjacentHTML("beforeend", main), 0);
        }
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Project dashboard fixture bundle is unavailable");

test("project dashboard shows result-focused projects and opens the source Thread", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupProjectDashboard")());

  const trigger = page.locator("[data-codexhost-project-dashboard-trigger]");
  const root = page.locator("[data-codexhost-project-dashboard]");
  const surface = page.locator("[data-codexhost-project-dashboard-surface]");
  await expect(trigger).toBeAttached();
  await expect(root).toBeVisible();
  await expect(surface).toHaveAttribute("data-codexhost-project-dashboard-surface", "v1");
  await expect(root).toContainText("项目态势");
  await expect(root).toContainText("codex-host");
  await expect(root).toContainText("实现完成，测试通过。");
  await expect(root).toContainText("1 文件");
  await expect(root).toContainText("+2 -1");
  await expect(page.locator("[data-app-shell-main-surface]")).toContainText("Conversation");
  expect(await root.evaluate((element) => element.style.width)).toBe("920px");
  expect(await root.evaluate((element) => element.style.height)).toBe("716px");

  await page.getByRole("button", { name: "刷新" }).click();
  await expect(root).toBeVisible();
  await page.getByRole("button", { name: "切换到聊天" }).click();
  await expect(root).toBeHidden();

  await trigger.click();
  await expect(root).toBeVisible();
  await page.getByRole("button", { name: /实现项目看板/ }).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "projectDashboard").opened)).toEqual([
    ["thread-a", "local"],
  ]);
  await expect(root).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("project-dashboard.png") });

  await page.evaluate(() => Reflect.get(globalThis, "projectDashboard").control.dispose());
  await expect(trigger).toHaveCount(0);
  await expect(root).toHaveCount(0);
});

test("project dashboard remains visible for idle projects while the main workspace mounts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() =>
    Reflect.get(globalThis, "setupProjectDashboard")({ deferMain: true, idleOnly: true }),
  );

  const root = page.locator("[data-codexhost-project-dashboard]");
  await expect(root).toBeVisible();
  await expect(root).toContainText("codex-host");
  await expect(root).toContainText("0");
  await expect(root).toContainText("运行中的会话");

  const surface = page.locator("[data-codexhost-project-dashboard-surface]");
  await expect(surface).toHaveAttribute("data-codexhost-project-dashboard-surface", "v1");
  await expect(surface).toHaveAttribute("data-app-shell-main-surface", "default");
  expect(await root.evaluate((element) => element.style.width)).toBe("920px");
});
