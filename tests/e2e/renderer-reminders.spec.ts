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
      import { ThreadRemindersModel, THREAD_REMINDERS_STORAGE_KEY } from "./packages/renderer-extension/src/thread-reminders-state.ts";
      import { installRendererReminders } from "./packages/renderer-extension/src/renderer-reminders.ts";
      import { installRendererThreadActions } from "./packages/renderer-extension/src/renderer-thread-actions.ts";

      const HOUR = 60 * 60 * 1000;
      const START = Date.parse("2026-10-27T09:00:00+08:00");

      globalThis.setupReminders = (keepStorage = false) => {
        if (!keepStorage) localStorage.clear();
        document.documentElement.lang = "zh-CN";
        document.body.innerHTML = '<aside id="app-shell-sidebar"><section data-sidebar-project-container-id="project:one"><button data-app-action-sidebar-project-row data-app-action-sidebar-project-label="clouddev"></button></section></aside>';
        const section = document.querySelector('[data-sidebar-project-container-id="project:one"]');
        const bind = (element, value) => {
          if (Object.hasOwn(element, "__reactFiber$fixture")) delete element.__reactFiber$fixture;
          Object.defineProperty(element, "__reactFiber$fixture", { enumerable: true, configurable: true, value });
        };
        const row = document.createElement("button");
        const dataAttributes = {
          "data-app-action-sidebar-thread-row": "",
          "data-app-action-sidebar-thread-host-id": "local",
          "data-app-action-sidebar-thread-id": "local:thread-a",
        };
        for (const [name, value] of Object.entries(dataAttributes)) row.setAttribute(name, value);
        bind(row, {
          memoizedProps: { conversationId: "thread-a", dataAttributes, statusState: { type: "idle", unread: false } },
          return: null,
          key: null,
        });
        row.innerHTML = '<span data-thread-title-trigger><span data-thread-title>clouddev 迁 macmini 做了嘛</span></span>';
        section.append(row);

        const clock = { now: START };
        const opened = [];
        const model = new ThreadRemindersModel(window.localStorage, () => clock.now);
        const control = installRendererReminders({
          getLocale: () => "zh-CN",
          now: () => clock.now,
          model,
          openThread: async (threadId, options) => {
            opened.push([threadId, options.hostId, options.project ?? null]);
          },
        });
        const actions = installRendererThreadActions({
          // 行操作入口（三点菜单）只在 Host 提供终端或图形应用入口时挂载。
          getClient: () => ({
            archiveCompletedThreads: async () => ({ archived: 0, skipped: 0, failed: 0 }),
            openThreadWorkspace: async () => ({ workspace: "/tmp/one", application: "vscode" }),
          }),
          getLocale: () => "zh-CN",
          threadReminders: control,
        });
        control.refresh();
        actions.refresh();
        globalThis.reminders = {
          control,
          actions,
          clock,
          opened,
          row,
          state() {
            return JSON.parse(localStorage.getItem(THREAD_REMINDERS_STORAGE_KEY) || "null");
          },
          tick(ms) {
            clock.now += ms;
            control.refresh();
          },
          dispose() {
            actions.dispose();
            control.dispose();
          },
        };
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  write: false,
});

// 容器内的 esbuild + 注入大包在本机较慢，单个用例给足时间避免构建阶段被判超时。
test.setTimeout(90_000);

const SIDEBAR_ROW =
  '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-id="local:thread-a"]';

const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Thread reminder fixture bundle is unavailable");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.route("https://reminders.test/", (route) =>
    route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" }),
  );
  await page.goto("https://reminders.test/");
  await page.addScriptTag({ content: bundle });
});

test("creates a one-time reminder from the row menu and fires the shared card", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => Reflect.get(globalThis, "setupReminders")());

  await page.locator(SIDEBAR_ROW).hover();
  await page.locator("[data-codexhost-thread-actions-trigger]").click();
  const entry = page.getByRole("menuitem", { name: "提醒…", exact: true });
  await expect(entry).toBeVisible();
  await entry.click();

  const dialog = page.locator("[data-codexhost-reminder-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("到点后在本窗口弹出提醒卡片");
  await dialog.locator("textarea").fill("clouddev 迁 macmini 做了嘛");
  await dialog.getByRole("button", { name: "保存提醒", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const saved = await page.evaluate(() => Reflect.get(globalThis, "reminders").state());
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({
    hostId: "local",
    threadId: "thread-a",
    title: "clouddev 迁 macmini 做了嘛",
    project: "clouddev",
    message: "clouddev 迁 macmini 做了嘛",
    schedule: { kind: "once" },
    enabled: true,
  });
  await expect(page.locator("[data-codexhost-reminder]")).toBeHidden();

  await page.evaluate(() => Reflect.get(globalThis, "reminders").tick(31 * 60 * 60_000));
  const card = page.locator("[data-codexhost-reminder]");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-codexhost-reminder-panel]")).toBeVisible();
  await expect(card).toContainText("local › clouddev");
  await expect(card).toContainText("clouddev 迁 macmini 做了嘛");
  await expect(card).toContainText("一次性提醒");
  await expect(card.getByRole("button", { name: "打开会话", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "稍后 10 分钟", exact: true })).toBeVisible();

  // 关闭按钮等同“知道了”：一次性提醒被停用，不再出现。
  await card.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(card).toBeHidden();
  const dismissed = await page.evaluate(() => Reflect.get(globalThis, "reminders").state());
  expect(dismissed.entries[0]).toMatchObject({ enabled: false });
  expect(errors).toEqual([]);
});

test("snoozes an interval reminder without changing its period", async ({ page }) => {
  await page.evaluate(() => Reflect.get(globalThis, "setupReminders")());
  await page.evaluate(() => {
    const reminders = Reflect.get(globalThis, "reminders");
    reminders.state();
    localStorage.setItem(
      "codexhost.thread-reminders.v1",
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "reminder-interval",
            hostId: "local",
            threadId: "thread-a",
            title: "clouddev 迁 macmini 做了嘛",
            project: "clouddev",
            message: "**每小时**复查一次",
            schedule: {
              kind: "interval",
              everyMs: 60 * 60 * 1000,
              nextAt: reminders.clock.now + 60 * 60 * 1000,
            },
            enabled: true,
            createdAt: reminders.clock.now,
            firedAt: null,
          },
        ],
      }),
    );
  });
  // 另一个窗口写入后由 storage 事件同步；直接重新安装以避开事件差异。
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupReminders")(true));

  await page.evaluate(() => Reflect.get(globalThis, "reminders").tick(60 * 60_000));
  const card = page.locator("[data-codexhost-reminder]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("周期提醒");
  // 提醒正文按 Markdown 渲染，而不是原样显示星号。
  await expect(card.locator("strong")).toHaveText("每小时");

  const before = await page.evaluate(() => Reflect.get(globalThis, "reminders").state().entries[0]);
  await card.getByRole("button", { name: "稍后 10 分钟", exact: true }).click();
  await expect(card).toBeHidden();
  const snoozed = await page.evaluate(
    () => Reflect.get(globalThis, "reminders").state().entries[0],
  );
  expect(snoozed.schedule).toMatchObject({ everyMs: 60 * 60 * 1000 });
  expect(snoozed.schedule.nextAt).toBe(before.schedule.nextAt + 10 * 60_000);

  await page.evaluate(() => Reflect.get(globalThis, "reminders").tick(10 * 60_000));
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "打开会话", exact: true }).click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(globalThis, "reminders").opened)).toEqual([
    ["thread-a", "local", "clouddev"],
  ]);
  const fired = await page.evaluate(() => Reflect.get(globalThis, "reminders").state().entries[0]);
  // 触发一次后周期继续，下一次落在未来。
  expect(fired.enabled).toBe(true);
  expect(fired.schedule.nextAt).toBeGreaterThan(
    await page.evaluate(() => Reflect.get(globalThis, "reminders").clock.now),
  );
});

test("lists and deletes existing reminders of a conversation", async ({ page }) => {
  await page.evaluate(() => Reflect.get(globalThis, "setupReminders")());
  await page.locator(SIDEBAR_ROW).hover();
  await page.locator("[data-codexhost-thread-actions-trigger]").click();
  await page.getByRole("menuitem", { name: "提醒…", exact: true }).click();
  const dialog = page.locator("[data-codexhost-reminder-dialog]");
  await dialog.locator("textarea").fill("第一次提醒");
  await dialog.getByRole("button", { name: "保存提醒", exact: true }).click();

  await page.locator(SIDEBAR_ROW).hover();
  await page.locator("[data-codexhost-thread-actions-trigger]").click();
  await expect(page.getByRole("menuitem", { name: /^提醒：/u })).toBeVisible();
  await page.getByRole("menuitem", { name: /^提醒：/u }).click();
  const reopened = page.locator("[data-codexhost-reminder-dialog]");
  await expect(reopened.locator(".codexhost-reminder-list")).toContainText("第一次提醒");
  await reopened.getByRole("button", { name: "删除", exact: true }).click();
  await expect(reopened.locator(".codexhost-reminder-list")).toContainText("还没有提醒。");
  await reopened.getByRole("button", { name: "取消", exact: true }).click();
  await expect(reopened).toHaveCount(0);
  const state = await page.evaluate(() => Reflect.get(globalThis, "reminders").state());
  expect(state.entries).toEqual([]);
});

test("rotates between several due reminders from the queue counter", async ({ page }) => {
  await page.evaluate(() => Reflect.get(globalThis, "setupReminders")());
  await page.evaluate(() => {
    const clock = Reflect.get(globalThis, "reminders").clock;
    const entry = (id, message, offset) => ({
      id,
      hostId: "local",
      threadId: "thread-a",
      title: "clouddev 迁 macmini 做了嘛",
      project: "clouddev",
      message,
      schedule: { kind: "once", at: clock.now + offset },
      enabled: true,
      createdAt: clock.now,
      firedAt: null,
    });
    localStorage.setItem(
      "codexhost.thread-reminders.v1",
      JSON.stringify({
        version: 1,
        entries: [
          entry("reminder-1", "第一条提醒", 60_000),
          entry("reminder-2", "第二条提醒", 120_000),
        ],
      }),
    );
  });
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupReminders")(true));
  await page.evaluate(() => Reflect.get(globalThis, "reminders").tick(2 * 60_000));

  const card = page.locator("[data-codexhost-reminder]");
  await expect(card).toContainText("第一条提醒");
  const counter = card.locator("[data-codexhost-reminder-queue]");
  await expect(counter).toBeVisible();
  await expect(counter).toHaveText("还有 1 个提醒");

  await counter.click();
  await expect(card).toContainText("第二条提醒");
  // 处理当前这条后回落到剩下的一条。
  await card.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(card).toContainText("第一条提醒");
  await expect(counter).toBeHidden();
});
