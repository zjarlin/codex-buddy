import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { InterruptedConversations } from "../../packages/host-runtime/src/buddy/continuation.js";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const bundle = await build({
  stdin: {
    contents: `
    import { installSidebarContinuation } from './packages/renderer-extension/src/buddy/continuation.ts';
    import { installBuddyControl } from './packages/renderer-extension/src/buddy/control.ts';
    import { RendererMethodUnavailableError } from './packages/renderer-extension/src/renderer-request-sender.ts';
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
    globalThis.discoveryFail = false;
    globalThis.running = false;
    globalThis.privateMode = false;
    globalThis.enabled = true;
    globalThis.owner = "codex";
    globalThis.threadStatus = "failed";
    globalThis.activeHost = 'local';
    globalThis.statusCalls = 0;
    globalThis.interruptedCalls = 0;
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
      ...(globalThis.statusMode === 'missing' ? {} : {buddyStatus: async () => {
        globalThis.statusCalls++;
        if (globalThis.statusMode === 'unsupported') throw new RendererMethodUnavailableError('codexhost/buddy/status', null);
        if (globalThis.statusMode === 'failed') throw new Error('状态读取失败');
        return {settings:{enabled:globalThis.enabled,privateMode:globalThis.privateMode}};
      }}),
      buddyInterrupted: async () => {
        globalThis.interruptedCalls++;
        if (globalThis.recoveryMode === 'unsupported') throw new RendererMethodUnavailableError('codexhost/buddy/interrupted', null);
        if (globalThis.discoveryFail) throw new Error('列表读取失败');
        if (globalThis.interrupted) return globalThis.interrupted;
        return {threads:[{threadId:'thread',turnId:'failed',title:'网络中断的会话',status:globalThis.threadStatus,owner:globalThis.owner}],runningThreadIds:globalThis.running?['thread']:[],unreadable:0};
      },
      buddyContinue: async (...args) => {
        globalThis.calls.push(args);
        if (globalThis.continueMode === 'unsupported') throw new RendererMethodUnavailableError('codexhost/buddy/continue', null);
        await new Promise(resolve=>globalThis.finishResume=resolve);
        if(globalThis.fail) { globalThis.fail=false; throw new Error('网络不可用'); }
      }
    };
    if (globalThis.recoveryMode === 'missing') delete client.buddyInterrupted;
    globalThis.sidebarClient = client;
    globalThis.sidebar = installSidebarContinuation({getClient:host=>host===globalThis.activeHost?globalThis.sidebarClient:null,getLocale:()=> 'zh-CN'});

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

for (const theme of ["light", "dark"] as const) {
  test(`unfinished native turn renders amber in the selected sidebar row (${theme})`, async ({
    page,
  }) => {
    const service = new InterruptedConversations(
      async (method) =>
        method === "thread/list"
          ? { result: { data: [{ id: "thread" }] } }
          : {
              result: {
                thread: {
                  status: { type: "idle" },
                  turns: [{ id: "unfinished", status: "inProgress" }],
                },
              },
            },
      () => false,
      async () => true,
    );
    const interrupted = await service.list();
    await page.setViewportSize({ width: 620, height: 240 });
    await page.setContent(
      `<body style="color-scheme:${theme};background:${theme === "dark" ? "#191b20" : "#fff"};color:${theme === "dark" ? "#e5e7ec" : "#222"};font:14px system-ui"></body>`,
    );
    await page.evaluate((state) => Reflect.set(globalThis, "interrupted", state), interrupted);
    await page.addScriptTag({ content: browserBundle });
    const row = page.locator("[data-app-action-sidebar-thread-row]");
    await row.evaluate((element) => {
      element.setAttribute("data-app-action-sidebar-thread-active", "true");
      element.style.backgroundColor = "#8882";
    });
    await expect(row).toHaveAttribute("data-buddy-sidebar-state", "interrupted");
    await expect(row).toHaveCSS("box-shadow", "rgb(217, 144, 0) 3px 0px 0px 0px inset");
    await expect(
      page.getByRole("button", { name: "会话已中断，点击恢复", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/buddy-unfinished-amber-${theme}.png` });
  });
}

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
    await expect(resume).toHaveAccessibleName("会话执行失败，点击恢复");
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
  await page.evaluate(() => {
    Reflect.set(globalThis, "running", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(globalThis, "running", false);
    Reflect.get(globalThis, "sidebar").refresh();
  });
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
  // 隐私模式只关闭续接动作，原生状态色仍保留。
  await expect(page.locator('[data-buddy-sidebar-state="failed"]')).toHaveCount(1);
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

test("sidebar recovery keeps the last successful state when discovery fails", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(1);
  await expect(
    page.locator("[data-app-action-sidebar-thread-row][data-buddy-sidebar-recoverable]"),
  ).toHaveCount(1);
  const recoverableStyle = await page
    .locator("[data-app-action-sidebar-thread-row]")
    .evaluate((row) => ({
      background: getComputedStyle(row).backgroundColor,
      boxShadow: getComputedStyle(row).boxShadow,
    }));
  expect(recoverableStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(recoverableStyle.boxShadow).not.toBe("none");
  await page.evaluate(() => {
    Reflect.set(globalThis, "discoveryFail", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(1);
  await expect(
    page.locator("[data-app-action-sidebar-thread-row][data-buddy-sidebar-recoverable]"),
  ).toHaveCount(1);
  await page.evaluate(() => {
    document
      .querySelector("[data-app-action-sidebar-thread-row]")
      ?.setAttribute("data-app-action-sidebar-thread-active", "true");
  });
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.set(globalThis, "discoveryFail", false);
    Reflect.set(globalThis, "running", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  // 进行中的会话只隐藏续接按钮，绿色状态条不再接管，转圈由原生状态槽负责。
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(0);
  await expect(
    page.locator("[data-app-action-sidebar-thread-row][data-buddy-sidebar-recoverable]"),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/buddy-continuation-state.png" });
});

for (const statusMode of ["unsupported", "missing"]) {
  test(`sidebar recovery works when router status is ${statusMode}`, async ({ page }) => {
    await page.setContent("<body></body>");
    await page.evaluate((mode) => Reflect.set(globalThis, "statusMode", mode), statusMode);
    await page.addScriptTag({ content: browserBundle });
    const resume = page.locator("[data-buddy-resume]");
    await expect(resume).toHaveCount(1);
    expect(await page.evaluate(() => Reflect.get(globalThis, "statusCalls"))).toBe(
      statusMode === "missing" ? 0 : 1,
    );
    expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(1);
    await resume.click();
    await expect(resume).toBeDisabled();
    expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
      ["thread", "failed"],
    ]);
    await page.evaluate(() => {
      Reflect.set(globalThis, "fail", false);
      Reflect.get(globalThis, "finishResume")();
    });
    await expect(resume).toHaveCount(0);
    await expect(page.locator("[data-buddy-recovery-error]")).toBeEmpty();
  });
}

test("sidebar discovery runs once per connection without background polling", async ({ page }) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(1);
  const discoveries = await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"));
  expect(discoveries).toBe(1);
  // 不再有定时轮询：长时间静置不产生新的中断列表读取。
  await page.clock.runFor(60_000);
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(discoveries);
  // 切换 Host 触发的 refresh() 仍会重新读取一次。
  await page.evaluate(() => Reflect.get(globalThis, "sidebar").refresh());
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "interruptedCalls")))
    .toBe(discoveries + 1);
});

test("sidebar recovery disables an existing resume action after a router status error", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  const discoveries = await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"));
  await page.evaluate(() => {
    Reflect.set(globalThis, "statusMode", "failed");
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(discoveries);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  await expect.poll(() => warnings.join("\n")).toContain("状态读取失败");
  await expect(page.locator("[data-buddy-sidebar-state]")).toHaveAttribute(
    "data-buddy-sidebar-state",
    "failed",
  );
  await page.evaluate(() => {
    Reflect.set(globalThis, "statusMode", null);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(1);
});

for (const recoveryMode of ["unsupported", "missing"]) {
  test(`sidebar keeps native status when recovery is ${recoveryMode}`, async ({ page }) => {
    await page.setContent("<body></body>");
    await page.evaluate((mode) => {
      Reflect.set(globalThis, "statusMode", "unsupported");
      Reflect.set(globalThis, "recoveryMode", mode);
    }, recoveryMode);
    await page.addScriptTag({ content: browserBundle });
    if (recoveryMode === "unsupported") {
      await expect
        .poll(() => page.evaluate(() => Reflect.get(globalThis, "interruptedCalls")))
        .toBe(1);
    }
    await expect(page.locator("[data-buddy-resume]")).toHaveCount(0);
    await expect(page.locator("[data-native-status]")).toBeVisible();
    await expect(page.locator("[data-buddy-sidebar-state]")).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
  });
}

test("sidebar remembers unavailable continuation until the connection is replaced", async ({
  page,
}) => {
  await page.setContent("<body></body>");
  await page.evaluate(() => Reflect.set(globalThis, "continueMode", "unsupported"));
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  await resume.click();
  await expect(resume).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("当前连接不支持会话恢复。");
  await expect(page.locator("[data-native-status]")).toBeVisible();
  const discoveries = await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"));
  await page.evaluate(() => Reflect.get(globalThis, "sidebar").refresh());
  await expect(resume).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(discoveries);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    ["thread", "failed"],
  ]);
  await page.evaluate(() => Reflect.get(globalThis, "row").remove());
  await expect(page.locator("[data-native-status]")).toHaveCount(0);
  await page.evaluate(() =>
    Reflect.set(globalThis, "row", Reflect.get(globalThis, "mountSidebar")()),
  );
  await expect(page.locator("[data-native-status]")).toBeVisible();
  await expect(resume).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(discoveries);
  await page.evaluate(() => {
    Reflect.set(globalThis, "continueMode", null);
    Reflect.set(globalThis, "fail", false);
    Reflect.set(globalThis, "sidebarClient", { ...Reflect.get(globalThis, "sidebarClient") });
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(1);
  await resume.click();
  await expect(resume).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "finishResume")());
  await expect(resume).toHaveCount(0);
  await expect(page.locator("[data-buddy-recovery-error]")).toBeEmpty();
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    ["thread", "failed"],
    ["thread", "failed"],
  ]);
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
  await resume.click();
  await expect(resume).toBeDisabled();
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    ["thread", "failed"],
  ]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "opened"))).toBe(0);
  await page.evaluate(() => {
    Reflect.set(globalThis, "fail", false);
    Reflect.get(globalThis, "finishResume")();
  });
  await expect(resume).toHaveCount(0);
});

test("sidebar state colors remain distinct in light and dark themes", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const row = page.locator("[data-app-action-sidebar-thread-row]");
  await expect(row).toHaveAttribute("data-buddy-sidebar-recoverable", "");
  const recoverable = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(row).toHaveAttribute("data-buddy-sidebar-state", "failed");
  await page.evaluate(() => {
    Reflect.set(globalThis, "threadStatus", "cancelled");
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(row).toHaveAttribute("data-buddy-sidebar-state", "cancelled");
  const cancelled = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(cancelled).not.toBe(recoverable);
  await page.evaluate(() => {
    Reflect.set(globalThis, "threadStatus", "interrupted");
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(row).toHaveAttribute("data-buddy-sidebar-state", "interrupted");
  const interrupted = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(interrupted).not.toBe(cancelled);
  await row.evaluate((element) =>
    element.setAttribute("data-app-action-sidebar-thread-active", "true"),
  );
  await page.evaluate(() => {
    Reflect.set(globalThis, "running", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  // 进行中的会话不再有绿色状态条，只清除可恢复标记，转圈由原生状态槽负责。
  await expect(row).not.toHaveAttribute("data-buddy-sidebar-recoverable", "");
  await page.screenshot({ path: "test-results/buddy-continuation-state-light.png" });
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.style.background = "#191b20";
    document.documentElement.style.color = "#e5e7ec";
  });
  await expect(row).toHaveCSS("color", "rgb(229, 231, 236)");
  await expect(row).not.toHaveAttribute("data-buddy-sidebar-recoverable", "");
  await page.screenshot({ path: "test-results/buddy-continuation-state-dark.png" });
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

test("fixed-model recovery remains available while external Harness recovery stays hidden", async ({
  page,
}) => {
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
  await expect(resume).toHaveCount(1);
  await resume.click();
  await expect(resume).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "finishResume")());
  await expect(page.locator("[data-buddy-recovery-error]")).toContainText("网络不可用");
  await page.evaluate(() => {
    Reflect.set(globalThis, "enabled", true);
    Reflect.get(globalThis, "sidebar").refresh();
  });
  await expect(resume).toHaveCount(1);
  await page.locator("[data-thread-title]").click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "opened"))).toBe(1);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    ["thread", "failed"],
  ]);
});
