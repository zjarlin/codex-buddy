import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererSidebarStatusFilter } from "./packages/renderer-extension/src/renderer-sidebar-status-filter.ts";
      globalThis.setupStatusFilter = () => {
        const activity = new Map([["running", true], ["idle", false], ["other", false]]);
        const calls = [];
        const client = {
          readThreadActivity: async (id) => {
            calls.push(id);
            if (!activity.has(id)) throw new Error("missing thread");
            return activity.get(id);
          },
        };
        const project = (id, title, threads) => {
          const container = document.createElement("section");
          container.dataset.sidebarProjectContainerId = "project:" + id;
          const heading = document.createElement("button");
          heading.dataset.appActionSidebarProjectRow = "";
          heading.textContent = title;
          container.append(heading);
          for (const [threadId, name] of threads) {
            const row = document.createElement("button");
            const attrs = {
              "data-app-action-sidebar-thread-row": "",
              "data-app-action-sidebar-thread-host-id": "local",
              "data-app-action-sidebar-thread-id": "local:" + threadId,
            };
            for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
            row.__reactFiber$fixture = { memoizedProps: { conversationId: threadId, dataAttributes: attrs } };
            row.textContent = name;
            container.append(row);
          }
          return container;
        };
        const sidebar = document.createElement("aside");
        sidebar.id = "app-shell-sidebar";
        sidebar.append(project("one", "项目一", [["running", "执行任务"], ["idle", "已完成"]]));
        sidebar.append(project("two", "项目二", [["other", "历史任务"]]));
        document.body.append(sidebar);
        const pending = new Set(["idle"]);
        const control = installRendererSidebarStatusFilter({
          getClient: () => client,
          getLocale: () => "zh-CN",
          hasPending: (_hostId, threadId) => pending.has(threadId),
        });
        globalThis.statusFilter = { activity, calls, control, pending };
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
if (!bundle) throw new Error("Sidebar filter fixture bundle is unavailable");

test("active view keeps the project tree and restores all conversations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.setContent(`
    <style>
      body{margin:0;background:#202124;color:#eee;font:13px system-ui}
      aside{box-sizing:border-box;width:260px;height:100vh;padding:12px;background:#2a2b2f}
      section{margin:6px 0 12px}section button{display:block;width:100%;padding:7px 8px;text-align:left;border:0;background:transparent;color:inherit;font:inherit}
      section>[data-app-action-sidebar-project-row]{font-weight:600}
      section>[data-app-action-sidebar-thread-row]{padding-left:24px}
    </style>
  `);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupStatusFilter")());
  const sidebar = page.locator("#app-shell-sidebar");
  const activeButton = sidebar.getByRole("button", { name: "进行中" });
  await expect(sidebar.getByText("执行任务")).toBeVisible();
  await expect(sidebar.getByText("已完成")).toBeVisible();
  await activeButton.click();
  await expect(activeButton).toHaveAttribute("aria-pressed", "true");
  await expect(sidebar.getByText("执行任务")).toBeVisible();
  await expect(sidebar.getByText("已完成")).toBeHidden();
  await expect(sidebar.getByText("历史任务")).toBeHidden();
  await expect(sidebar.getByRole("button", { name: "项目一" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "项目二" })).toBeVisible();
  await expect(sidebar.getByRole("status")).toHaveText("1 个进行中");
  await page.screenshot({ path: "test-results/sidebar-status-active-mobile.png" });

  await page.evaluate(() => {
    const state = Reflect.get(globalThis, "statusFilter");
    state.activity.set("running", false);
    state.control.refresh();
  });
  await expect(sidebar.getByText("执行任务")).toBeHidden();
  await expect(sidebar.getByRole("status")).toHaveText("没有进行中的会话");
  await expect(sidebar.getByRole("button", { name: "项目一" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "项目二" })).toBeVisible();
  await sidebar.getByRole("button", { name: "全部" }).click();
  await expect(sidebar.getByText("执行任务")).toBeVisible();
  await expect(sidebar.getByText("已完成")).toBeVisible();
  await expect(sidebar.getByText("历史任务")).toBeVisible();
  await sidebar.getByRole("button", { name: "待确认" }).click();
  await expect(sidebar.getByText("已完成")).toBeVisible();
  await expect(sidebar.getByText("执行任务")).toBeHidden();
  await expect(sidebar.getByText("历史任务")).toBeHidden();
  await expect(sidebar.getByRole("status")).toHaveText("1 个待确认");
  await page.evaluate(() => Reflect.get(globalThis, "statusFilter").pending.clear());
  await page.evaluate(() => Reflect.get(globalThis, "statusFilter").control.refresh());
  await expect(sidebar.getByText("已完成")).toBeHidden();
  await expect(sidebar.getByRole("status")).toHaveText("没有待确认的会话");
  await sidebar.getByRole("button", { name: "全部" }).click();
  await expect(sidebar.getByText("执行任务")).toBeVisible();
  await expect(sidebar.getByText("已完成")).toBeVisible();
  await expect(sidebar.getByText("历史任务")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => Reflect.get(globalThis, "statusFilter").control.dispose());
  await expect(sidebar.locator("[data-codexhost-sidebar-status-filter]")).toHaveCount(0);
});
