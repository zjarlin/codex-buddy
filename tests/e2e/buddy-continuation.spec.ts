import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const bundle = await build({
  stdin: {
    contents: `
    import { installSidebarContinuation } from './packages/renderer-extension/src/buddy/continuation.ts';
    import { installBuddyControl } from './packages/renderer-extension/src/buddy/control.ts';
    globalThis.mountRecovery = () => {
      const snapshot = { settings: { enabled:true,planning:true,privateMode:false,bypass:true,role:'auto',plannerModel:null,executorModel:null }, models:[], decisions:[{
        threadId:'work',turnId:'failed',phase:'retrying',role:'executor',difficulty:'simple',score:15,
        reason:'失败 3/9 次，8 秒后自动续接并切换模型。',plannerModel:null,executorModel:'cheap-a',acceptedModel:'cheap-a',plan:null,command:null,exitCode:null,updatedAt:'fixture'
      }] };
      const client = { buddyStatus:async()=>snapshot, buddyCancel:async()=>{ snapshot.decisions[0].phase='cancelled'; snapshot.decisions[0].reason='已取消自动续接。'; return snapshot; } };
      const anchor=document.createElement('div'); document.body.replaceChildren(anchor);
      installBuddyControl(()=>({anchor,threadId:'work',client}),()=> 'zh-CN');
    };
    globalThis.calls = [];
    globalThis.opened = 0;
    globalThis.fail = true;
    globalThis.privateMode = false;
    globalThis.enabled = true;
    globalThis.owner = "codex";
    globalThis.activeHost = 'local';
    globalThis.mountSidebar = () => {
      const row = document.createElement('div');
      const attrs = {
        'data-app-action-sidebar-thread-row':'',
        'data-app-action-sidebar-thread-host-id':'local',
        'data-app-action-sidebar-thread-id':'local:thread',
        'data-app-action-sidebar-thread-active':'false'
      };
      for (const [key,value] of Object.entries(attrs)) row.setAttribute(key,value);
      row.setAttribute('role','button');
      row.tabIndex=0;
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:8px;width:260px';
      row.innerHTML='<div class="w-4 shrink-0" style="width:16px;height:16px;flex:none"><span data-native-status>!</span></div><div data-thread-title-trigger><span data-thread-title>网络中断的会话</span></div>';
      row.__reactFiber$fixture = {memoizedProps:{conversationId:'thread',dataAttributes:attrs}};
      row.addEventListener('click',()=>globalThis.opened++);
      row.addEventListener('keydown',()=>globalThis.opened++);
      document.body.append(row);
      return row;
    };
    globalThis.row = globalThis.mountSidebar();
    const client = {
      buddyStatus: async () => ({settings:{enabled:globalThis.enabled,privateMode:globalThis.privateMode}}),
      listThreadOwnership:async()=>({threads:[{threadId:'thread',owner:globalThis.owner}]}),
      buddyInterrupted: async () => ({threads:[{threadId:'thread',turnId:'failed',title:'网络中断的会话',status:'failed'}],unreadable:0}),
      buddyContinue: async (...args) => {
        globalThis.calls.push(args);
        await new Promise(resolve=>globalThis.finishResume=resolve);
        if(globalThis.fail) { globalThis.fail=false; throw new Error('网络不可用'); }
      }
    };
    globalThis.sidebar = installSidebarContinuation({getClient:host=>host===globalThis.activeHost?client:null,getLocale:()=> 'zh-CN'});

  `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  loader: { ".png": "dataurl", ".svg": "dataurl" },
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
  await expect(page.getByRole("button", { name: "最近中断会话" })).toHaveCount(0);
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
    const resume = page.locator("[data-buddy-resume]");
    await expect(resume).toHaveAccessibleName("会话已中断，点击恢复");
    await expect(page.locator("[data-native-status]")).toBeHidden();
    await page.screenshot({ path: `test-results/buddy-continuation-ready-${width}.png` });
    await resume.click();
    await expect(resume).toBeDisabled();
    await page.evaluate(() => Reflect.get(globalThis, "finishResume")());
    await expect(page.getByRole("alert")).toContainText("网络不可用");
    await expect(resume).toBeEnabled();
    await resume.focus();
    await page.keyboard.press("Enter");
    await expect(resume).toBeDisabled();
    await page.evaluate(() => Reflect.get(globalThis, "finishResume")());
    await expect(resume).toHaveCount(0);
    await expect(page.locator("[data-native-status]")).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(globalThis, "opened"))).toBe(0);
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

test("sidebar recovery follows privacy, running state, row replacement and disposal", async ({
  page,
}) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  await page.evaluate(() =>
    Reflect.get(globalThis, "row").setAttribute("data-app-action-sidebar-thread-active", "true"),
  );
  await expect(resume).toHaveCount(0);
  await page.evaluate(() =>
    Reflect.get(globalThis, "row").setAttribute("data-app-action-sidebar-thread-active", "false"),
  );
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.get(globalThis, "row").remove();
    Reflect.set(globalThis, "row", Reflect.get(globalThis, "mountSidebar")());
  });
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.set(globalThis, "privateMode", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(globalThis, "privateMode", false);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => Reflect.get(globalThis, "sidebar").dispose());
  await expect(resume).toHaveCount(0);
  await expect(page.locator("[data-native-status]")).toBeVisible();
  await expect(page.locator("[data-buddy-sidebar-recovery]")).toHaveCount(0);
});

test("sidebar recovery matches native thread ids inside host-prefixed rows", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(() => {
    document.body.replaceChildren();
    const row = document.createElement("div");
    const attrs = {
      "data-app-action-sidebar-thread-row": "",
      "data-app-action-sidebar-thread-host-id": "local",
      "data-app-action-sidebar-thread-id": "local:thread",
      "data-app-action-sidebar-thread-active": "false",
    };
    for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
    row.innerHTML =
      '<div class="w-4 shrink-0"><span data-native-status>!</span></div><div data-thread-title-trigger><span data-thread-title>网络中断的会话</span></div>';
    Object.defineProperty(row, "__reactFiber$fixture", {
      value: {
        memoizedProps: {
          conversationId: "local:thread",
          dataAttributes: attrs,
        },
      },
    });
    document.body.append(row);
    Reflect.set(globalThis, "row", row);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  await expect(page.locator("[data-buddy-sidebar-recovery]")).toHaveCount(1);
});

test("host changes ignore an in-flight continuation response", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await resume.click();
  await expect(resume).toBeDisabled();
  await page.evaluate(() => {
    Reflect.set(globalThis, "activeHost", "remote");
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "finishResume")());
  await expect(page.locator("[data-buddy-recovery-error]")).toBeEmpty();
});

test("external Harness and disabled routing do not expose recovery", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.set(globalThis, "owner", "external");
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(globalThis, "owner", "codex");
    Reflect.set(globalThis, "enabled", false);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(globalThis, "enabled", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(1);
  await page.locator("[data-thread-title]").click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "opened"))).toBe(1);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
});
