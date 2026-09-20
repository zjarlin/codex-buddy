import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const bundle = await build({
  stdin: {
    contents: `
    import { interruptedControl } from './packages/renderer-extension/src/buddy/continuation.ts';
    import { installBuddyControl } from './packages/renderer-extension/src/buddy/control.ts';
    globalThis.mountRecovery = () => {
      const snapshot = { settings: { enabled:true,privateMode:false,bypass:true,role:'auto',plannerModel:null,executorModel:null }, models:[], decisions:[{
        threadId:'work',turnId:'failed',phase:'retrying',role:'executor',difficulty:'simple',score:15,
        reason:'失败 3/9 次，8 秒后自动续接并切换模型。',plannerModel:null,executorModel:'cheap-a',acceptedModel:'cheap-a',plan:null,command:null,exitCode:null,updatedAt:'fixture'
      }] };
      const client = { buddyStatus:async()=>snapshot, buddyCancel:async()=>{ snapshot.decisions[0].phase='cancelled'; snapshot.decisions[0].reason='已取消自动续接。'; return snapshot; } };
      const anchor=document.createElement('div'); document.body.replaceChildren(anchor);
      installBuddyControl(()=>({anchor,threadId:'work',client}),()=> 'zh-CN');
    };
    globalThis.calls = [];
    let fail = true;
    const client = {
      buddyInterrupted: async () => ({threads:[{threadId:'thread',turnId:'failed',title:'网络中断的会话 long title '.repeat(8),status:'failed'}],unreadable:1}),
      buddyContinue: async (...args) => { globalThis.calls.push(args); if(fail) { fail=false; throw new Error('网络不可用'); } }
    };
    document.body.append(interruptedControl(client,true));
  `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const browserBundle = bundle.outputFiles[0]?.text;
if (!browserBundle) throw new Error("Continuation test bundle missing");

test("recovery waiting state exposes a working cancel control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(() => Reflect.get(globalThis, "mountRecovery")());
  await page.locator("[data-buddy-router] summary").click();
  await expect(page.getByText("等待自动续接 · cheap-a", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消自动续接" }).click();
  await expect(page.getByText("已取消自动续接。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消自动续接" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/buddy-recovery-cancel.png" });
});

for (const width of [390, 1200]) {
  test(`interrupted conversation retry and duplicate guard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.setContent(
      '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
    );
    await page.addScriptTag({ content: browserBundle });
    await page.getByRole("button", { name: "最近中断会话" }).click();
    await expect(page.getByRole("status")).toHaveText("1 个会话历史不可读");
    const resume = page.getByRole("button", { name: "一键继续" });
    await resume.click();
    await expect(page.getByRole("status")).toHaveText("网络不可用");
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect(page.getByRole("button", { name: "已续接" })).toBeDisabled();
    expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
      ["thread", "failed"],
      ["thread", "failed"],
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/buddy-continuation-${width}.png` });
  });
}
