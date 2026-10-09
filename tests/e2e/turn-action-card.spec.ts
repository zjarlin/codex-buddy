import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
import { installTurnActionCards } from './packages/renderer-extension/src/turn-action-card/index.ts';
import { installAutoRouteCards } from './packages/renderer-extension/src/auto-route-card/index.ts';
const config = globalThis.fixtureConfig;
let hostId = 'ssh:one'; let latest = 'turn-1'; let privateMode = false; let receipt = null;
let resolveLate = null; let failed = false;
globalThis.executions = [];
const actions = [
 { actionId: 'git.commit', version: '1', label: '提交代码', description: '仅提交，不推送', kind: 'prompt', argumentMode: 'none', enabled: !config.conflict },
 { actionId: 'git.commit_push', version: '1', label: '提交并推送', description: '提交并推送', kind: 'workflow', argumentMode: 'none', enabled: true },
 { actionId: 'pi.review', version: '1', label: 'Review', description: '审查', kind: 'prompt', argumentMode: 'text', enabled: true },
];
const client = {
 inspectTurnActions: async ({ threadId, sourceTurnId }) => {
   const result = { threadId, latestTurnId: latest, sourceTurnId: sourceTurnId || latest,
     busy: Boolean(config.busy), private: privateMode, actions: actions.map(a => ({ ...a, enabled: a.enabled && !config.busy })), invocations: receipt ? [receipt] : [],
     recommendation: { session_id: threadId, run_id: sourceTurnId || latest, context_id: 'a'.repeat(64),
       state: config.state || 'completed', source: config.source || 'laya', model: config.source === 'none' ? undefined : 'laya', updated_at: 1,
       features: { git_changes: 4, git_conflicts: config.conflict ? 3 : 0, git_ahead: 1, git_behind: 0 },
       actions: config.source === 'none' ? [] : [{ action_id: 'git.commit', version: '1', confidence: .92, reason: '可提交当前改动' }] } };
   if (config.late && hostId === 'ssh:one') return new Promise(resolve => { resolveLate = () => resolve(result); });
   if (hostId !== 'ssh:one') return { ...result, private: true };
   return result;
 },
 executeTurnAction: async (input) => {
   globalThis.executions.push(input);
   if (config.failOnce && !failed) { failed = true; throw new Error('连接中断'); }
   receipt = { threadId: input.threadId, sourceTurnId: input.sourceTurnId, invocationId: input.invocationId,
     actionId: input.actionId, version: input.version, state: 'running', executionTurnId: 'execution', updatedAt: 2 };
   return receipt;
 },
 readAutoModelRoutes: async () => ({ supported: true, routes: [{ request_id: '019ccb31-9520-7120-bc17-556e9a92d861',
 session_id: config.threadId, turn_id: 'turn-1', requested_model: 'auto', selected_model: 'first', resolved_model: 'actual-model',
 attempted_models: ['first', 'actual-model'], state: 'completed', started_at: 1, updated_at: 2 }] }),
};
const getContext = () => ({ threadId: config.threadId, hostId, root: document.querySelector('main'), composer: document.querySelector('#composer'), client, selectedModel: 'auto' });
const cards = installTurnActionCards({ getContext });
const auto = installAutoRouteCards({ getContext, getLocale: () => 'zh-CN' });
document.querySelector('#next').onclick = () => { latest = 'turn-2'; };
document.querySelector('#private').onclick = () => { privateMode = true; };
document.querySelector('#switch').onclick = () => { hostId = 'ssh:two'; };
document.querySelector('#late').onclick = () => resolveLate?.();
document.querySelector('#dispose').onclick = () => { cards.dispose(); auto.dispose(); };
`,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2024",
  write: false,
});
const source = outputFiles[0]?.text;
if (!source) throw new Error("Missing card bundle");
async function setup(page: Page, config: Record<string, unknown> = {}) {
  await page.route("https://turn-actions.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto("https://turn-actions.test/");
  await page.setContent(`<html style="color-scheme:${config.dark ? "dark" : "light"}"><head><style>
body{font:14px/1.6 system-ui;background:${config.dark ? "#191a1c" : "#fff"};color:${config.dark ? "#eee" : "#252525"};margin:0}main{max-width:760px;margin:30px auto;padding:20px}nav{display:flex;gap:8px;margin-top:25px}#composer{border:1px solid #8886;padding:15px;border-radius:8px;margin-top:20px}
</style></head><body><main><p>检查改动并准备提交</p>
<section data-content-search-turn-key="turn-1"><div data-response-annotation-conversation="${threadId}">已完成检查，发现四项改动。</div></section>
<section data-content-search-turn-key="turn-2"><div data-response-annotation-conversation="${threadId}">后续回复</div></section>
<div id="composer" contenteditable="true">保留用户草稿</div><nav><button id="next">下一轮</button><button id="private">隐私</button><button id="switch">切换 Host</button><button id="late">迟到响应</button><button id="dispose">卸载</button></nav></main></body></html>`);
  await page.evaluate(
    (fixture) => {
      Object.assign(globalThis, { fixtureConfig: fixture });
    },
    { ...config, threadId },
  );
  if (!source) throw new Error("Missing card bundle");
  await page.addScriptTag({ content: source });
}
const current = (page: Page) => page.locator('[data-codexhost-turn-actions="turn-1"]');
test("binds judgment and buttons to the turn alongside the actual model, starts once and keeps the draft", async ({
  page,
}) => {
  await setup(page);
  await expect(current(page).getByText("System One", { exact: true })).toBeVisible();
  await expect(page.locator('[data-codexhost-auto-route="turn-1"]')).toContainText("actual-model");
  await expect(current(page).getByRole("button", { name: /提交代码/ })).toContainText("92%");
  await current(page)
    .getByRole("button", { name: /提交代码/ })
    .click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "executions").length))
    .toBe(1);
  const invocation = await page.evaluate(() => Reflect.get(globalThis, "executions")[0]);
  expect(invocation).toMatchObject({ sourceTurnId: "turn-1", actionId: "git.commit" });
  await expect(current(page).getByRole("button", { name: /提交代码/ })).toBeDisabled();
  await expect(page.locator("#composer")).toHaveText("保留用户草稿");
});
test("keeps historical buttons read-only and hides all action cards in privacy mode", async ({
  page,
}) => {
  await setup(page);
  await expect(current(page)).toBeVisible();
  await page.getByRole("button", { name: "下一轮", exact: true }).click();
  await expect(current(page)).toContainText("历史推荐");
  await expect(current(page).getByRole("button", { name: /提交代码/ })).toBeDisabled();
  await page.getByRole("button", { name: "隐私", exact: true }).click();
  await expect(page.locator("[data-codexhost-turn-actions]")).toHaveCount(0);
});
test("does not claim a completed System One judgment when no candidates were judged", async ({
  page,
}) => {
  await setup(page, { source: "none", state: "completed" });
  await expect(current(page).getByText("无需判断", { exact: true })).toBeVisible();
  await expect(current(page).getByText("判断完成", { exact: true })).toHaveCount(0);
  await expect(current(page).getByText("System One", { exact: true })).toHaveCount(0);
  await expect(current(page).getByRole("button", { name: "提交代码", exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/turn-actions-no-judgment.png" });
});

for (const state of ["failed", "timed_out"]) {
  test(`keeps Auto and registered actions visible when judgment is ${state}`, async ({ page }) => {
    await setup(page, { state });
    await expect(current(page)).toContainText(state === "failed" ? "判断失败" : "判断超时");
    await expect(current(page).getByRole("button", { name: /提交代码/ })).toBeEnabled();
    await expect(page.locator('[data-codexhost-auto-route="turn-1"]')).toContainText(
      "actual-model",
    );
  });
}
test("ignores a late response after switching Host", async ({ page }) => {
  await setup(page, { late: true });
  await page.getByRole("button", { name: "切换 Host", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "迟到响应", exact: true }).click();
  await expect(page.locator("[data-codexhost-turn-actions]")).toHaveCount(0);
});
test("collects native text arguments without overwriting the draft", async ({ page }) => {
  await setup(page);
  await current(page).getByRole("button", { name: "Review", exact: true }).click();
  await current(page).getByRole("textbox", { name: "Review 参数" }).fill("only staged changes");
  await current(page).getByRole("button", { name: "运行", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "executions")[0]?.argumentText))
    .toBe("only staged changes");
  await expect(page.locator("#composer")).toHaveText("保留用户草稿");
});
for (const dark of [false, true]) {
  test(`shows conflicts and disabled commit in ${dark ? "dark" : "light"} theme`, async ({
    page,
  }) => {
    await setup(page, { dark, conflict: true });
    await expect(current(page)).toContainText("3 个冲突文件");
    await expect(current(page).getByRole("button", { name: /提交代码/ })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath("turn-actions.png"), fullPage: true });
    await page.getByRole("button", { name: "卸载", exact: true }).click();
    await expect(page.locator("[data-codexhost-turn-actions]")).toHaveCount(0);
  });
}
