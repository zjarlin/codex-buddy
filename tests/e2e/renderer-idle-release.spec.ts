import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { createAppearanceSettingsPage } from "./packages/renderer-extension/src/settings/appearance-page.ts";
      import { createRendererSettingsPageRegistry } from "./packages/renderer-extension/src/settings/core.ts";
      import { rendererSettingsMessages } from "./packages/renderer-extension/src/settings/localization.ts";
      import { mountRendererSettingsShell } from "./packages/renderer-extension/src/settings/shell.ts";
      import { createRendererModelClient } from "./packages/renderer-extension/src/renderer-model-client.ts";
      import { installIdleReleasePreferenceSync } from "./packages/renderer-extension/src/renderer-idle-release-preference.ts";
      import { installThreadAutoArchivePreferenceSync } from "./packages/renderer-extension/src/renderer-thread-auto-archive-preference.ts";
      globalThis.setupIdleRelease = (unsupported = false) => {
        const calls = [];
        const client = createRendererModelClient([{sendRequest: async (method, params) => {
          calls.push({method, params});
          if (unsupported) throw {code:-32601};
          return params;
        }}]);
        const sync = installIdleReleasePreferenceSync(window);
        const archiveSync = installThreadAutoArchivePreferenceSync(window);
        sync.connect(client);
        archiveSync.connect(client);
        const messages = rendererSettingsMessages("zh-CN");
        const registry = createRendererSettingsPageRegistry([createAppearanceSettingsPage(messages)]);
        const shell = mountRendererSettingsShell(registry, document, messages);
        shell.openSettings(undefined, "appearance");
        globalThis.idleFixture = {calls, client, dispose: () => {shell.dispose(); sync.dispose(); archiveSync.dispose();}};
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    sourcefile: "idle-release-e2e-entry.ts",
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
if (!bundle) throw new Error("Missing settings fixture bundle");
async function setup(page: Page, unsupported = false) {
  await page.route("http://localhost/idle-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.goto("http://localhost/idle-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((value) => Reflect.get(globalThis, "setupIdleRelease")(value), unsupported);
}

test("General groups appearance and idle release controls without dialogs or long text", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole("button", { name: "通用", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "换行显示思考文本" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "资源管理" }).getByText("已加载会话", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "已加载会话", exact: true })).toHaveCount(0);
  const enabled = page.getByRole("switch", { name: "自动释放空闲会话" });
  const minutes = page.getByRole("spinbutton", { name: "空闲超时" });
  const archiveEnabled = page.getByRole("switch", { name: "长期不用自动归档" });
  const archiveDays = page.getByRole("spinbutton", { name: "未使用时长" });
  await expect(enabled).not.toBeChecked();
  await expect(archiveEnabled).not.toBeChecked();
  // The timeout has no effect while release is off, so it is not shown.
  await expect(minutes).toBeHidden();
  await expect(archiveDays).toBeHidden();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeHidden();
  await page.getByRole("button", { name: "自动释放空闲会话说明" }).hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("后台进程可能仍在运行并占用内存");
  await expect(tooltip).toContainText("聊天记录不会删除");

  // Enabling applies immediately; Playwright would auto-dismiss any unexpected dialog.
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(minutes).toBeVisible();
  await expect(minutes).toHaveValue("30");
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(globalThis, "idleFixture").calls.at(-1)?.params.enabled),
    )
    .toBe(true);

  await expect(minutes).toHaveAttribute("min", "5");
  await expect(minutes).toHaveAttribute("max", "1440");
  await expect(minutes).toHaveAttribute("step", "1");
  await minutes.fill("4");
  await minutes.press("Tab");
  await expect(minutes).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("请输入 5～1440 之间的整数。")).toBeVisible();
  await minutes.fill("5");
  await minutes.press("Tab");
  await expect(minutes).toHaveAttribute("aria-invalid", "false");
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(globalThis, "idleFixture").calls.at(-1)?.params.timeoutMinutes,
      ),
    )
    .toBe(5);
  await minutes.focus();
  await minutes.press("ArrowUp");
  await minutes.press("Tab");
  await expect(minutes).toHaveValue("6");
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(globalThis, "idleFixture").calls.at(-1)?.params.timeoutMinutes,
      ),
    )
    .toBe(6);
  // Successful sync is silent; the scope badge is no longer shown.
  await expect(page.getByText("同步中…")).toBeHidden();
  await expect(page.getByText("仅本地 Host", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("codexhost.idle-release.v1") ?? "null"),
    ),
  ).toEqual({ enabled: true, timeoutMinutes: 6 });

  // Turning release off hides the timeout but keeps the saved value; an invalid draft is dropped.
  await minutes.fill("4");
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect(minutes).toBeHidden();
  await enabled.click();
  await expect(minutes).toHaveValue("6");
  await expect(minutes).toHaveAttribute("aria-invalid", "false");
  await archiveEnabled.click();
  await expect(archiveEnabled).toBeChecked();
  await expect(archiveDays).toBeVisible();
  await expect(archiveDays).toHaveValue("30");
  await expect(archiveDays).toHaveAttribute("min", "1");
  await expect(archiveDays).toHaveAttribute("max", "3650");
  await archiveDays.fill("0");
  await archiveDays.press("Tab");
  await expect(archiveDays).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("请输入 1～3650 之间的整数。")).toBeVisible();
  await archiveDays.fill("60");
  await archiveDays.press("Tab");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("codexhost.thread-auto-archive.v1") ?? "null"),
    ),
  ).toEqual({ enabled: true, inactiveDays: 60 });
  expect(
    await page.evaluate(
      () => typeof Reflect.get(globalThis, "idleFixture").client.setThreadAutoArchiveSettings,
    ),
  ).toBe("function");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = Reflect.get(globalThis, "idleFixture").calls;
        return calls
          .filter(
            (call: { method?: string }) =>
              call.method === "codexhost/settings/thread-auto-archive/set",
          )
          .at(-1)?.params.inactiveDays;
      }),
    )
    .toBe(60);
  await enabled.click();
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupIdleRelease")());
  await expect(enabled).not.toBeChecked();
  await expect(minutes).toBeHidden();
  await enabled.click();
  await expect(minutes).toHaveValue("6");
  await expect(archiveEnabled).toBeChecked();
  await expect(archiveDays).toHaveValue("60");
});

test("speech announcement defaults on, persists locally, and syncs across windows", async ({
  page,
  context,
}) => {
  await setup(page);
  const speech = page.getByRole("switch", { name: "会话完成语音播报" });
  await expect(speech).toBeChecked();
  await expect(page.getByText("会话结束时用网关曼波配音朗读结果摘要")).toBeVisible();
  // No Host setting is involved: the switch is purely a local preference.
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "idleFixture").calls.at(-1).method))
    .toBe("codexhost/settings/thread-auto-archive/set");

  await speech.uncheck();
  expect(await page.evaluate(() => localStorage.getItem("codexhost.speech-announcement.v1"))).toBe(
    "false",
  );
  const other = await context.newPage();
  await setup(other);
  await expect(other.getByRole("switch", { name: "会话完成语音播报" })).not.toBeChecked();

  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupIdleRelease")());
  await expect(speech).not.toBeChecked();
  await speech.check();
  expect(await page.evaluate(() => localStorage.getItem("codexhost.speech-announcement.v1"))).toBe(
    "true",
  );
  await other.close();
});

test("another window's change updates both the UI and the Host without stale cached settings", async ({
  page,
  context,
}) => {
  await setup(page);
  const other = await context.newPage();
  await setup(other);
  const enabled = page.getByRole("switch", { name: "自动释放空闲会话" });
  await enabled.check();
  const otherEnabled = other.getByRole("switch", { name: "自动释放空闲会话" });
  await expect(otherEnabled).toBeChecked();
  await otherEnabled.uncheck();
  await expect(enabled).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(globalThis, "idleFixture").calls.at(-1).params.enabled),
    )
    .toBe(false);
  await other.close();
});

test("unsupported Host is visible rather than reported as applied", async ({ page }) => {
  await setup(page, true);
  await expect(
    page.getByRole("status").filter({ hasText: "当前 Host 不支持" }).first(),
  ).toBeVisible();
});
