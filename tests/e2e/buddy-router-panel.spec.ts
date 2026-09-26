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
        settings: { enabled: true, planning: true, privateMode: false, bypass: true, jev: true, role: "auto", plannerModel: null, executorModel: null },
        models: [
          { id: "gpt-planner", tier: "夯", eligible: true },
          { id: "deepseek-flash", tier: "垃", eligible: true },
          { id: "q3-4b", tier: "垃", eligible: true }
        ],
        modelRefresh: { returned: 31, synchronized: 3, eligible: 3 },
        decisions: [],
        jevKeyConfigured: false,
        jevBaseUrl: null
      };
      globalThis.buddyWrites = [];
      globalThis.buddyAnswers = [];
      globalThis.buddyAnswerFailure = false;
      globalThis.buddyThreadId = "fixture";
      globalThis.buddyContextEnabled = true;
      globalThis.buddyStatusPending = false;
      globalThis.buddyInterrupted = [
        { threadId: "stalled", turnId: "interrupted-turn", title: "网络中断的会话", status: "interrupted" }
      ];
      globalThis.buddyContinueCalls = [];
      globalThis.buddyContinueFailure = true;
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
        buddyAnswer: async (value) => {
          if (globalThis.buddyAnswerFailure) throw new Error("连接失败，请重试");
          globalThis.buddyAnswers.push(value);
          snapshot.decisions[0].phase = "planning";
          snapshot.decisions[0].pendingInput = null;
          return structuredClone(snapshot);
        },
        buddyCancel: async () => {
          snapshot.decisions[0].phase = "cancelled";
          snapshot.decisions[0].pendingInput = null;
          return structuredClone(snapshot);
        },
        buddyInterrupted: async () => ({ threads: structuredClone(globalThis.buddyInterrupted), unreadable: 0 }),
        buddyContinue: async (threadId, turnId) => {
          globalThis.buddyContinueCalls.push([threadId, turnId]);
          if (globalThis.buddyContinueFailure) throw new Error("网络不可用");
          globalThis.buddyInterrupted = [];
        },
        buddyModels: async () => structuredClone(snapshot),
        buddyJevKey: async (config) => {
          globalThis.buddyKeyWrites = globalThis.buddyKeyWrites || [];
          globalThis.buddyKeyWrites.push(config);
          if (config.apiKey !== undefined) snapshot.jevKeyConfigured = Boolean(config.apiKey);
          if (config.baseURL !== undefined) snapshot.jevBaseUrl = config.baseURL;
          return structuredClone(snapshot);
        }
      };
      const anchor = document.createElement("div");
      document.body.replaceChildren(anchor);
      globalThis.buddyControl = installBuddyControl(
        () => globalThis.buddyContextEnabled ? { anchor, threadId: globalThis.buddyThreadId, client } : null,
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

test("lists recently interrupted conversations and resumes them from the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.locator("[data-buddy-router] summary").click();
  await page.getByRole("tab", { name: "中断会话" }).click();
  const group = page.locator("[data-buddy-router] .buddy-interrupted");
  await expect(page.locator("[data-buddy-router]")).toContainText("最近中断会话");
  await expect(group).toContainText("网络中断的会话");
  await expect(group).toContainText("已中断");
  await group.getByRole("button", { name: "恢复" }).click();
  await expect(group).toContainText("恢复失败: 网络不可用");
  expect(await page.evaluate(() => Reflect.get(globalThis, "buddyContinueCalls"))).toEqual([
    ["stalled", "interrupted-turn"],
  ]);
  await page.evaluate(() => Reflect.set(globalThis, "buddyContinueFailure", false));
  await group.getByRole("button", { name: "恢复" }).click();
  await expect(group).toContainText("暂无最近中断会话。");
  expect(await page.evaluate(() => Reflect.get(globalThis, "buddyContinueCalls"))).toEqual([
    ["stalled", "interrupted-turn"],
    ["stalled", "interrupted-turn"],
  ]);
  await page.getByRole("tab", { name: "路由" }).click();
  await page.getByRole("switch", { name: /Auto Router/ }).click();
  await page.getByRole("tab", { name: "中断会话" }).click();
  await expect(group).toHaveCount(0);
  await page.getByRole("tab", { name: "路由" }).click();
  await page.getByRole("switch", { name: /隐私/ }).click();
  await page.getByRole("tab", { name: "中断会话" }).click();
  await expect(group).toHaveCount(0);
});

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
  await page.getByRole("tab", { name: "任务详情" }).click();
  await expect(page.getByText("本次任务模型", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "路由" }).click();
  await page
    .getByRole("combobox", { name: "垃 · 执行模型", exact: true })
    .selectOption("deepseek-flash");
  await page.getByRole("tab", { name: "路由" }).click();
  await expect(page.getByRole("combobox", { name: "垃 · 执行模型" }).locator("..")).toHaveAttribute(
    "title",
    "指定后由单个模型执行，不使用子代理或自动换模",
  );
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "buddyWrites").at(-1).executorModel),
  ).toBe("deepseek-flash");
  await page.getByRole("tab", { name: "任务详情" }).click();
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

test("Auto Router separates routing controls from automatic planning", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.locator("[data-buddy-router] summary").click();

  const enabled = page.getByRole("switch", { name: /Auto Router/ });
  const planning = page.getByRole("switch", { name: /自动规划/ });
  const privateMode = page.getByRole("switch", { name: /隐私/ });
  const bypass = page.getByRole("switch", { name: /旁路优先/ });
  const systemOne = page.getByRole("switch", { name: /JEV 判断/ });
  const role = page.getByRole("combobox", { name: "执行角色" });
  const planner = page.getByRole("combobox", { name: "夯 · 规划模型" });
  const executor = page.getByRole("combobox", { name: "垃 · 执行模型" });
  await expect(enabled).toHaveAttribute("aria-checked", "true");
  await expect(planning).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("隐私模式", { exact: true })).toBeHidden();
  await expect(page.getByText("路由策略", { exact: true })).toBeHidden();
  await expect(page.getByText("规划与执行模型", { exact: true })).toBeHidden();
  await expect(role).toBeVisible();
  await expect(role).toBeEnabled();
  await expect(planner).toBeEnabled();
  await expect(executor).toBeEnabled();
  await expect(bypass).toBeEnabled();
  await expect(systemOne).toBeEnabled();

  await planning.click();
  await expect(planning).toHaveAttribute("aria-checked", "false");
  await expect(bypass).toBeEnabled();
  await expect(systemOne).toBeEnabled();
  await expect(role).toBeEnabled();
  await expect(planner).toBeDisabled();
  await expect(executor).toBeEnabled();

  await enabled.click();
  await expect(enabled).toHaveAttribute("aria-checked", "false");
  await expect(bypass).toBeDisabled();
  await expect(systemOne).toBeDisabled();
  await expect(role).toBeDisabled();
  await expect(planner).toBeDisabled();
  await expect(executor).toBeDisabled();
  await expect(
    page.getByText("Auto Router 已关闭，使用当前选定模型直接执行。", { exact: true }),
  ).toBeVisible();

  await enabled.click();
  await expect(role).toBeEnabled();
  await expect(planning).toHaveAttribute("aria-checked", "false");
  await privateMode.click();
  await expect(privateMode).toHaveAttribute("aria-checked", "true");
  await expect(role).toBeDisabled();
  await expect(planner).toBeDisabled();
  await expect(executor).toBeDisabled();
  await expect(page.getByText("隐私 · 自动选择离线模型", { exact: true })).toBeVisible();
  await expect(page.getByText("隐私模式已接管普通 Auto Router。", { exact: true })).toBeVisible();

  expect(await page.evaluate(() => Reflect.get(globalThis, "buddyWrites"))).toEqual([
    expect.objectContaining({ planning: false }),
    expect.objectContaining({ enabled: false }),
    expect.objectContaining({ enabled: true }),
    expect.objectContaining({ privateMode: true }),
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/buddy-router-panel.png" });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`keeps the cheap model bypass and measured score visible when collapsed (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(
      `<body style="color-scheme:${colorScheme};background:${colorScheme === "dark" ? "#191b20" : "#fff"};color:${colorScheme === "dark" ? "#e5e7ec" : "#16181d"};font:14px system-ui"></body>`,
    );
    await page.addScriptTag({ content: browserBundle });
    const decision = {
      threadId: "fixture",
      turnId: "turn",
      phase: "executing",
      role: "git",
      difficulty: "standard",
      score: 45,
      reason: "命中推送请求；旁路至垃模型，跳过夯规划。",
      plannerModel: null,
      executorModel: "deepseek-flash",
      acceptedModel: "deepseek-flash",
      involvedModels: ["deepseek-flash"],
      plan: null,
      command: null,
      exitCode: null,
      updatedAt: "fixture",
      modelBypass: {
        kind: "git-push",
        skills: ["gitlab", "gh", "prskill"],
        skillWarning: null,
        outcome: "pending",
        successRate: null,
        succeeded: 0,
        total: 0,
      },
      judgment: {
        source: "system-one",
        model: "typesafe/jev",
        decisions: {
          route: { status: "automatic", strength: 0.92, basis: "confidence-and-probability" },
          push: { status: "automatic", strength: 0.97, basis: "outcome-probability" },
        },
      },
    };
    await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), decision);
    const router = page.locator("[data-buddy-router]");
    const summary = router.locator("summary");
    await expect(router).toHaveAttribute("data-model-bypass", "");
    await expect(summary).toContainText("旁路 · 垃");
    await expect(summary).toContainText("跳过夯规划");
    await expect(summary).toContainText("旁路成功率 待统计");
    await expect(summary).not.toContainText("零推理请求");
    await expect(summary).not.toContainText("gpt-planner");
    for (const phase of ["completed", "failed", "cancelled"]) {
      await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), {
        ...decision,
        phase,
        modelBypass: {
          ...decision.modelBypass,
          outcome: phase,
          successRate: 75,
          succeeded: 3,
          total: 4,
        },
      });
      await expect(summary).toContainText("旁路 · 垃");
      await expect(summary).toContainText("75/100 (3/4)");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/buddy-push-bypass-${colorScheme}-collapsed.png` });
    await summary.click();
    await page.getByRole("tab", { name: "任务详情" }).click();
    await expect(page.getByText("gitlab · gh · prskill", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("term")
        .filter({ hasText: "JEV 判断" })
        .locator("..")
        .getByText(/typesafe\/jev/),
    ).toBeVisible();
    await expect(page.getByText("75/100 (3/4)", { exact: true })).toHaveAttribute(
      "title",
      /回合完成不等于 Git 推送业务成功/,
    );
    await page.screenshot({ path: `test-results/buddy-push-bypass-${colorScheme}-expanded.png` });
    await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), {
      ...decision,
      modelBypass: {
        ...decision.modelBypass,
        skills: [],
        skillWarning: "未发现可用 GitHub CLI（gh）skill",
      },
    });
    await expect(page.getByText("未发现可用 GitHub CLI（gh）skill", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "路由" }).click();
    await page.getByRole("switch", { name: /Auto Router/ }).click();
    await expect(router).not.toHaveAttribute("data-model-bypass");
    await expect(summary).toContainText("Auto Router");
    await expect(summary).not.toContainText("旁路成功率");
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`planner confirmation opens automatically, preserves input and resumes (${colorScheme})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.setContent(
      `<body style="color-scheme:${colorScheme};background:${colorScheme === "dark" ? "#191b20" : "#fff"};color:${colorScheme === "dark" ? "#e5e7ec" : "#16181d"};font:14px system-ui"></body>`,
    );
    await page.addScriptTag({ content: browserBundle });
    const decision = {
      threadId: "fixture",
      turnId: null,
      phase: "waiting-input",
      role: "executor",
      difficulty: "advanced",
      score: 85,
      reason: "复杂任务需要先规划",
      plannerModel: "gpt-planner",
      executorModel: "deepseek-flash",
      acceptedModel: null,
      involvedModels: [],
      plan: null,
      command: null,
      exitCode: null,
      updatedAt: "fixture",
      pendingInput: {
        requestId: "question-1",
        questions: [
          {
            id: "scope",
            header: "修改范围",
            question: "这次修改包含哪些模块？",
            options: [
              { label: "仅当前模块", description: "保持现有公共接口" },
              { label: "包含调用方", description: "同步调整依赖模块" },
            ],
          },
          { id: "detail", header: "补充信息", question: "需要保留哪些行为？", options: null },
        ],
      },
    };
    await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), decision);
    const form = page.getByRole("form", { name: "规划需要你的确认" });
    await expect(form).toBeVisible();
    await expect(page.locator("[data-buddy-router] summary")).toContainText("等待你的确认");
    await form.getByRole("button", { name: "确认并继续" }).click();
    await expect(form.getByRole("alert")).toHaveText("请回答所有问题后再继续。");
    await form.getByRole("radio", { name: /仅当前模块/ }).check();
    const custom = form.getByRole("textbox", { name: /需要保留哪些行为/ });
    await custom.fill("保留现有接口和用户数据");
    await page.evaluate(
      (value) => Reflect.get(globalThis, "setBuddyDecision")({ ...value, updatedAt: "refreshed" }),
      decision,
    );
    await expect(custom).toHaveValue("保留现有接口和用户数据");
    await expect(form.getByRole("radio", { name: /仅当前模块/ })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/buddy-planner-confirmation-${colorScheme}.png`,
      fullPage: true,
    });
    await page.evaluate(() => Reflect.set(globalThis, "buddyAnswerFailure", true));
    await form.getByRole("button", { name: "确认并继续" }).click();
    await expect(form.getByRole("alert")).toHaveText("连接失败，请重试");
    await page.evaluate(() => Reflect.get(globalThis, "buddyControl").refresh());
    await expect(form.getByRole("alert")).toHaveText("连接失败，请重试");
    await expect(custom).toHaveValue("保留现有接口和用户数据");
    await page.evaluate(() => Reflect.set(globalThis, "buddyAnswerFailure", false));
    await form.getByRole("button", { name: "确认并继续" }).click();
    await expect(form).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, "buddyAnswers"))).toEqual([
      {
        threadId: "fixture",
        requestId: "question-1",
        answers: {
          scope: { answers: ["仅当前模块"] },
          detail: { answers: ["保留现有接口和用户数据"] },
        },
      },
    ]);
    await expect(page.locator("summary")).toContainText("夯正在规划");
    await page.evaluate((value) => Reflect.get(globalThis, "setBuddyDecision")(value), decision);
    await page.evaluate(() => {
      Reflect.set(globalThis, "buddyThreadId", "another-thread");
      Reflect.get(globalThis, "buddyControl").refreshContext();
    });
    await expect(form).toHaveCount(0);
    await page.evaluate(() => {
      Reflect.set(globalThis, "buddyThreadId", "fixture");
      return Reflect.get(globalThis, "buddyControl").refresh();
    });
    await form.getByRole("button", { name: "取消规划" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator("summary")).toContainText("已取消");
    expect(errors).toEqual([]);
  });
}

test("saves and clears the JEV API key without ever showing the stored value", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.locator("[data-buddy-router] summary").click();

  const keyInput = page.getByLabel("JEV API Key", { exact: true });
  const urlInput = page.getByLabel("JEV 网关地址", { exact: true });
  await expect(keyInput).toHaveAttribute("type", "password");
  await expect(page.getByText("未配置", { exact: true })).toBeVisible();
  await keyInput.fill("sk-e2e-secret");
  await urlInput.fill("https://sub2api.example/v1");
  await page.getByRole("button", { name: "保存密钥", exact: true }).click();
  await expect(page.getByText("已配置", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "buddyKeyWrites"))).toEqual([
    { apiKey: "sk-e2e-secret", baseURL: "https://sub2api.example/v1" },
  ]);
  // 明文只提交给 Host，输入框与界面都不保留密钥。
  await expect(keyInput).toHaveValue("");
  expect(await page.locator("[data-buddy-router]").innerText()).not.toContain("sk-e2e-secret");
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("未配置", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "buddyKeyWrites"))).toEqual([
    { apiKey: "sk-e2e-secret", baseURL: "https://sub2api.example/v1" },
    { apiKey: null, baseURL: null },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/buddy-jev-key.png" });
});
