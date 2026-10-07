import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const { outputFiles } = await build({
  stdin: {
    contents: `import { installRendererSettingsLifecycle } from "./packages/renderer-extension/src/renderer-settings-lifecycle.ts";
      const request = async (name) => (await fetch("/fixture/" + name)).json();
      const client = {
        checkUpdate: () => request("check"),
        readUpdateStatus: () => request("status"),
        startUpdate: () => request("start"),
        restartUpdate: () => request("restart"),
      };
      installRendererSettingsLifecycle(window, { getUpdateClient: () => client });`,
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
const fixtureFile = outputFiles[0];
if (!fixtureFile) throw new Error("Update notification fixture bundle missing");
const bundle = fixtureFile.text;

async function fixture(
  page: Page,
  options: { failOnce?: boolean; windows?: boolean; current?: boolean } = {},
) {
  const calls = { starts: 0, restarts: 0, status: 0 };
  let phase: string | null = null;
  let downloaded = 0;
  const status = () =>
    phase
      ? {
          version: "0.10.48",
          installation: options.windows ? "windows-installer" : "macos-dmg",
          phase,
          updatedAt: 1,
          error: phase === "failed" ? "镜像下载失败，请重试。" : null,
          ...(phase === "downloading"
            ? { downloadedBytes: downloaded, totalBytes: 100 * 1024 * 1024 }
            : {}),
        }
      : null;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/update-notification", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      :root { color-scheme: light dark; font: 14px system-ui; }
      * { box-sizing: border-box; }
      body { margin: 0; color: light-dark(#171717,#ececec); background: light-dark(#ffffff,#202020); }
      nav { position: fixed; inset: 0 auto 0 0; width: 52px; background: light-dark(#f4f4f4,#171717); border-right: 1px solid light-dark(#dedede,#333); display:flex; flex-direction:column; justify-content:space-between; }
      nav > div { display:flex; flex-direction:column; align-items:center; gap:8px; padding-top:64px; }
      nav button { width:36px; height:36px; border:0; background:transparent; color:inherit; font-size:18px; }
      main { margin-left:52px; padding:24px; }
      h1 { font-size:20px; margin:0 0 28px; }
      h2 { font-size:16px; margin:0 0 12px; }
      p { font-size:13px; color:light-dark(#676767,#aaa); }
    </style></head><body>
      <nav data-app-navigation-rail><div><button data-sidebar-destination="builtin:home" aria-label="主页">H</button><button aria-label="更多">...</button></div><div></div></nav>
      <main><h1>Codex Buddy</h1><h2>codex-host</h2><p>应用更新</p></main>
    </body></html>`,
    }),
  );
  await page.route("http://localhost/fixture/*", async (route) => {
    const name = route.request().url().split("/").at(-1);
    let result: unknown;
    if (name === "check")
      result = {
        currentVersion: "0.10.43",
        installation: options.windows ? "windows-installer" : "macos-dmg",
        latestVersion: options.current ? "0.10.43" : "0.10.48",
        updateAvailable: !options.current,
        installationAvailable: true,
        releaseNotes: "应用内更新提示",
        releaseNotesUrl: null,
        status: status(),
        error: null,
      };
    else {
      if (name === "start") {
        calls.starts++;
        downloaded = 0;
        phase = "downloading";
      }
      if (name === "restart") {
        calls.restarts++;
        phase = "waiting-for-exit";
      }
      if (name === "status") {
        calls.status++;
        if (phase === "downloading") {
          downloaded += 20 * 1024 * 1024;
          if (options.failOnce && calls.starts === 1 && downloaded >= 40 * 1024 * 1024)
            phase = "failed";
          else if (downloaded >= 100 * 1024 * 1024) phase = "ready-to-restart";
        }
      }
      result = {
        currentVersion: "0.10.43",
        installation: options.windows ? "windows-installer" : "macos-dmg",
        status: status(),
      };
    }
    await route.fulfill({ json: result });
  });
  await page.goto("http://localhost/update-notification");
  await page.addScriptTag({ content: bundle });
  return { calls, errors };
}

test.use({ locale: "zh-CN" });

for (const { width, height, scheme } of [
  { width: 1200, height: 820, scheme: "light" as const },
  { width: 380, height: 760, scheme: "dark" as const },
]) {
  test(`blue update icon downloads and waits for restart at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme });
    const { calls, errors } = await fixture(page);
    const trigger = page.locator("[data-codexhost-update-trigger] button");
    const popup = page.locator("[data-codexhost-update-notification]");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-label", "下载更新");
    await expect(popup).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("blue-update-icon.png") });
    await trigger.click();
    await expect(popup.getByRole("progressbar")).toBeVisible();
    await expect(popup).toContainText("20%");
    expect(calls.starts).toBe(1);
    expect(calls.restarts).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("downloading-progress.png") });
    const bounds = await popup.boundingBox();
    if (!bounds) throw new Error("Update popup has no visible bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await trigger.click();
    expect(calls.starts).toBe(1);
    await popup.getByRole("button", { name: "稍后" }).click();
    await expect(popup).toBeHidden();
    await expect(popup.getByRole("button", { name: "重启更新" })).toBeVisible();
    expect(calls.restarts).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("ready-to-restart.png") });
    const pollsAtReady = calls.status;
    await popup.getByRole("button", { name: "稍后" }).click();
    await expect(popup).toBeHidden();
    await page.waitForTimeout(1_500);
    expect(calls.status).toBe(pollsAtReady);
    await trigger.click();
    await popup.getByRole("button", { name: "重启更新" }).click();
    await expect(popup).toContainText("正在等待应用退出");
    expect(calls.restarts).toBe(1);
    expect(calls.starts).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("restart-confirmed.png") });
    expect(errors).toEqual([]);
  });
}

test("failed downloads can be retried without restarting", async ({ page }, testInfo) => {
  const { calls, errors } = await fixture(page, { failOnce: true });
  const popup = page.locator("[data-codexhost-update-notification]");
  await page.locator("[data-codexhost-update-trigger] button").click();
  await expect(popup).toContainText("镜像下载失败");
  await page.screenshot({ path: testInfo.outputPath("download-failed.png") });
  await popup.getByRole("button", { name: "重试" }).click();
  await expect(popup.getByRole("button", { name: "重启更新" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("retry-ready.png") });
  expect(calls.starts).toBe(2);
  expect(calls.restarts).toBe(0);
  expect(errors).toEqual([]);
});

test("settings and notification share the ready state and restart action", async ({
  page,
}, testInfo) => {
  const { calls, errors } = await fixture(page);
  const popup = page.locator("[data-codexhost-update-notification]");
  await page.locator("[data-codexhost-update-trigger] button").click();
  await popup.getByRole("button", { name: "稍后" }).click();
  await page.locator("[data-codexhost-settings-trigger] button").click();
  await page.locator(".settings-nav").getByRole("button", { name: "更新", exact: true }).click();
  const panel = page.locator(".settings-update-panel");
  await expect(panel).toHaveAttribute("data-update-state", "ready-to-restart");
  await expect(panel.getByRole("button", { name: "重启更新" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-ready.png") });
  expect(calls.starts).toBe(1);
  expect(calls.restarts).toBe(0);
  await panel.getByRole("button", { name: "重启更新" }).click();
  await expect(panel).toHaveAttribute("data-update-state", "waiting-for-exit");
  expect(calls.restarts).toBe(1);
  expect(errors).toEqual([]);
});

test("Windows update icon uses the existing manual installer page", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Win32" }));
  const { calls, errors } = await fixture(page, { windows: true });
  await page.locator("[data-codexhost-update-trigger] button").click();
  await expect(page.locator(".settings-update-panel")).toContainText("Windows 暂不支持自动更新");
  await page.screenshot({ path: testInfo.outputPath("windows-manual-update.png") });
  expect(calls.starts).toBe(0);
  expect(calls.restarts).toBe(0);
  expect(errors).toEqual([]);
});

test("current installations do not show the blue icon", async ({ page }, testInfo) => {
  await fixture(page, { current: true });
  await expect(page.locator("[data-codexhost-update-trigger] button")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("current-no-update.png") });
});
