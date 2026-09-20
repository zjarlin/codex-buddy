import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installBuddyControl } from "./packages/renderer-extension/src/buddy/control.ts";
      const snapshot = {
        settings: { enabled: true, privateMode: false, bypass: true, role: "auto", plannerModel: null, executorModel: null },
        models: [
          { id: "gpt-planner", tier: "夯", eligible: true },
          { id: "deepseek-flash", tier: "垃", eligible: true },
          { id: "q3-4b", tier: "垃", eligible: true }
        ],
        decisions: []
      };
      globalThis.buddyWrites = [];
      globalThis.buddyContextEnabled = true;
      globalThis.buddyStatusPending = false;
      const client = {
        buddyStatus: async () => {
          if (globalThis.buddyStatusPending) {
            await new Promise((resolve) => { globalThis.resolveBuddyStatus = resolve; });
          }
          return structuredClone(snapshot);
        },
        buddyConfigure: async (value) => {
          globalThis.buddyWrites.push(value);
          snapshot.settings = structuredClone(value);
          return structuredClone(snapshot);
        },
        buddyModels: async () => structuredClone(snapshot)
      };
      const anchor = document.createElement("div");
      document.body.replaceChildren(anchor);
      globalThis.buddyControl = installBuddyControl(
        () => globalThis.buddyContextEnabled ? { anchor, threadId: "fixture", client } : null,
        () => "zh-CN"
      );
      globalThis.setBuddyDecision = async (decision) => {
        snapshot.decisions = [decision];
        await globalThis.buddyControl.refresh();
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const browserBundle = outputFiles[0]?.text;
if (!browserBundle) throw new Error("Buddy router panel bundle was not generated");

test("shows all task models without clipping and explains a fixed executor", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  const involvedModels = [
    "deepseek-flash",
    "gpt-planner",
    "worker-model-with-a-long-provider-prefix",
    "replacement-mini",
  ];
  const decision = {
    threadId: "fixture",
    turnId: "turn",
    phase: "retrying",
    role: "executor",
    difficulty: "advanced",
    score: 85,
    reason: "正在自动续接",
    plannerModel: "gpt-planner",
    executorModel: "replacement-mini",
    acceptedModel: "replacement-mini",
    involvedModels,
    plan: null,
    command: null,
    exitCode: null,
    updatedAt: "fixture",
  };
  await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), decision);
  const summary = page.locator("[data-buddy-router] summary");
  for (const model of involvedModels) {
    await expect(summary).toContainText(model);
    expect((await summary.innerText()).split(model)).toHaveLength(2);
  }
  expect(
    await summary
      .locator("span")
      .evaluate(
        (element) =>
          element.scrollHeight <= element.clientHeight &&
          element.scrollWidth <= element.clientWidth,
      ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await summary.click();
  await expect(page.getByText("本次任务模型", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "垃 · 执行模型", exact: true })
    .selectOption("deepseek-flash");
  await expect(
    page.getByText("指定后由单个模型执行，不使用子代理或自动换模", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "buddyWrites").at(-1).executorModel),
  ).toBe("deepseek-flash");
  await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), {
    ...decision,
    phase: "completed",
  });
  for (const model of involvedModels) await expect(summary).toContainText(model);
  await page.getByText("本次任务模型", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/buddy-task-models.png", fullPage: true });
  await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), {
    ...decision,
    plannerModel: null,
    executorModel: "deepseek-flash",
    acceptedModel: "deepseek-flash",
    involvedModels: [],
  });
  await expect(summary).toContainText("deepseek-flash");
  await expect(summary).not.toContainText("gpt-planner");
  await expect(summary).not.toContainText("replacement-mini");
});

test("removes Auto Router while a status request is pending and ignores its late response", async ({
  page,
}) => {
  await page.setContent("<!doctype html><body></body>");
  await page.clock.install();
  await page.addScriptTag({ content: browserBundle });
  const router = page.locator("[data-buddy-router]");
  await expect(router).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(globalThis, "buddyStatusPending", true);
    void Reflect.get(globalThis, "buddyControl").refresh();
  });
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(globalThis, "resolveBuddyStatus")))
    .toBe("function");
  await page.evaluate(() => {
    Reflect.set(globalThis, "buddyContextEnabled", false);
    Reflect.get(globalThis, "buddyControl").refreshContext();
  });
  await expect(router).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "resolveBuddyStatus")());
  await page.clock.runFor(1_200);
  await expect(router).toHaveCount(0);
});

test("Auto Router switches reveal only meaningful configuration", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.locator("[data-buddy-router] summary").click();

  const enabled = page.getByRole("switch", { name: /自动路由/ });
  const privateMode = page.getByRole("switch", { name: /隐私/ });
  await expect(enabled).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("路由策略", { exact: true })).toBeVisible();
  await expect(page.getByText("模型偏好", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "执行角色" })).toBeVisible();

  await enabled.click();
  await expect(enabled).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("路由策略", { exact: true })).toHaveCount(0);
  await expect(page.getByText("模型偏好", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "执行角色" })).toHaveCount(0);

  await enabled.click();
  await expect(page.getByText("路由策略", { exact: true })).toBeVisible();
  await privateMode.click();
  await expect(privateMode).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("路由策略", { exact: true })).toHaveCount(0);
  await expect(page.getByText("模型偏好", { exact: true })).toHaveCount(0);
  await expect(page.getByText("隐私 · 自动选择离线模型", { exact: true })).toBeVisible();

  expect(await page.evaluate(() => Reflect.get(globalThis, "buddyWrites"))).toEqual([
    expect.objectContaining({ enabled: false }),
    expect.objectContaining({ enabled: true }),
    expect.objectContaining({ privateMode: true }),
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/buddy-router-panel.png" });
});
