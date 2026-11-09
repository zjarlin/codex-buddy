import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { InterruptedConversations } from "../../packages/host-runtime/src/buddy/continuation.js";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const bundle = await build({
  stdin: {
    contents: `
    import { installSidebarContinuation } from './packages/renderer-extension/src/buddy/continuation.ts';
    import { createInterruptedQueue } from './packages/renderer-extension/src/buddy/interrupted-queue.ts';
    import { createRoutingSettingsPage } from './packages/renderer-extension/src/settings/routing-page.ts';
    import { createRendererSettingsPageRegistry } from './packages/renderer-extension/src/settings/core.ts';
    import { rendererSettingsMessages } from './packages/renderer-extension/src/settings/localization.ts';
    import { mountRendererSettingsShell } from './packages/renderer-extension/src/settings/shell.ts';
    import { RendererMethodUnavailableError } from './packages/renderer-extension/src/renderer-request-sender.ts';
    globalThis.mountRecovery = () => {
      const snapshot = { settings: { enabled:true,privateMode:false,bypass:true,role:'auto',executorModel:null }, models:[], decisions:[{
        threadId:'work',turnId:'failed',phase:'retrying',role:'executor',difficulty:'simple',score:15,
        reason:'失败 3/9 次，8 秒后自动续接并切换模型。',executorModel:'cheap-a',acceptedModel:'cheap-a',plan:null,command:null,exitCode:null,updatedAt:'fixture'
      }] };
      const client = {
      requestThreadProjection:async(method,{threadId})=>({thread:{id:threadId,name:'网络中断的会话',modelProvider:globalThis.owner==='external'?'codexhost':'openai',cliVersion:'fixture'}}), buddyStatus:async()=>snapshot, buddyCancel:async()=>{ snapshot.decisions[0].phase='cancelled'; snapshot.decisions[0].reason='已取消自动续接。'; return snapshot; } };
      const anchor=document.createElement('div'); document.body.replaceChildren(anchor);
      const messages=rendererSettingsMessages('zh-CN');
      const shell=mountRendererSettingsShell(createRendererSettingsPageRegistry([createRoutingSettingsPage(messages,()=>client)]),document,messages);
      shell.openSettings();
    };
    globalThis.calls = [];
    globalThis.opened = 0;
    globalThis.fail ??= true;
    globalThis.discoveryFail ??= false;
    globalThis.running ??= false;
    globalThis.privateMode ??= false;
    globalThis.enabled ??= true;
    globalThis.owner ??= "codex";
    globalThis.threadStatus ??= "failed";
    globalThis.activeHost ??= 'local';
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
      },
      readThreadTurnState: async () => ({
        running: globalThis.running,
        status: globalThis.running ? null : globalThis.threadStatus,
        turnId: globalThis.turnId ?? 'failed'
      })
    };
    if (globalThis.recoveryMode === 'missing') delete client.buddyInterrupted;
    globalThis.sidebarClient = client;
    let notify;
    const manager={addNotificationCallback:(_methods,callback)=>{notify=callback;return ()=>{};}};
    const getClient=host=>host===globalThis.activeHost?globalThis.sidebarClient:null;
    const hosts=()=>globalThis.hostIds ?? ['local'];
    // 测试用的按 Host 记账：真实实现里同一个 Host 始终返回同一个客户端。
    // 包装后的客户端按 Host 固定复用，否则队列会把它当成连接重绑。
    const hostClients=new Map();
    const anyClient=host=>{
      if(!hosts().includes(host)) return null;
      if(!globalThis.recordHostScans) return globalThis.sidebarClient;
      if(!hostClients.has(host)) hostClients.set(host,{...globalThis.sidebarClient,buddyInterrupted:async(...args)=>{
        globalThis.scannedHosts.push(host);
        return globalThis.sidebarClient.buddyInterrupted(...args);
      }});
      return hostClients.get(host);
    };
    const queue=createInterruptedQueue({storage:{getItem:()=>null,setItem:()=>{}},getHostIds:hosts,getManager:()=>manager,getClient:anyClient});
    queue.refresh();
    globalThis.emitTurn=(status,turnId)=>{
      globalThis.turnId=turnId;
      globalThis.running=status==='active';
      globalThis.threadStatus=status;
      notify({method:status==='active'?'turn/started':'turn/completed',params:{threadId:'thread',turn:{id:turnId,status}}});
    };
    globalThis.archiveThread=()=>notify({method:'thread/archived',params:{threadId:'thread'}});
    const initial=globalThis.interrupted?.threads[0];
    globalThis.emitTurn(initial?.status??globalThis.threadStatus,initial?.turnId??'failed');
    globalThis.queue = queue;
    globalThis.sidebar = installSidebarContinuation({queue,getClient:anyClient,getLocale:()=> 'zh-CN'});

  `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
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

test("routing settings expose a working cancel control for waiting recovery", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    '<body style="background:#191b20;color:#e5e7ec;font:14px system-ui"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(() => Reflect.get(globalThis, "mountRecovery")());
  await expect(page.getByRole("button", { name: "最近中断会话" })).toHaveCount(0);
  await expect(
    page.getByText("失败 3/9 次，8 秒后自动续接并切换模型。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消自动续接" }).click();
  await expect(
    page.getByText("失败 3/9 次，8 秒后自动续接并切换模型。", { exact: true }),
  ).toHaveCount(0);
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

test("queue events clear running and archived rows and survive row replacement", async ({
  page,
}) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => Reflect.get(globalThis, "emitTurn")("active", "next"));
  await expect(resume).toHaveCount(0);
  await expect(page.locator("[data-native-status]")).toBeVisible();
  await page.evaluate(() => Reflect.get(globalThis, "emitTurn")("cancelled", "next"));
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => {
    Reflect.get(globalThis, "row").remove();
    Reflect.set(globalThis, "row", Reflect.get(globalThis, "mountSidebar")());
  });
  await expect(resume).toHaveCount(1);
  await page.evaluate(() => Reflect.get(globalThis, "archiveThread")());
  await expect(resume).toHaveCount(0);
  await expect(page.locator("[data-buddy-sidebar-state]")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "sidebar").dispose());
  await expect(page.locator("[data-buddy-sidebar-recovery]")).toHaveCount(0);
});

for (const mode of ["unsupported", "missing", "failed"]) {
  test(`queue recovery does not depend on router status or discovery: ${mode}`, async ({
    page,
  }) => {
    await page.setContent("<body></body>");
    await page.evaluate((value) => {
      Reflect.set(globalThis, "statusMode", value);
      Reflect.set(globalThis, "recoveryMode", value);
    }, mode);
    await page.addScriptTag({ content: browserBundle });
    const resume = page.locator("[data-buddy-resume]");
    await expect(resume).toHaveCount(1);
    expect(await page.evaluate(() => Reflect.get(globalThis, "statusCalls"))).toBe(0);
    const discovered = await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"));
    await resume.click();
    await expect(resume).toBeDisabled();
    await page.evaluate(() => {
      Reflect.set(globalThis, "fail", false);
      Reflect.get(globalThis, "finishResume")();
    });
    await expect(resume).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
      ["thread", "failed"],
    ]);
    // 恢复操作本身不触发补录/发现；自动发现失败时更不能挡住恢复。
    expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(discovered);
  });
}

test("background discovery is rate limited instead of scanning on every refresh", async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(1);
  // 启动即做一次全量发现，用于补上客户端闪退期间漏掉的终态通知。
  await page.clock.runFor(5_000);
  const started = await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"));
  expect(started).toBe(1);
  // 聚焦和重绘不触发全量发现，也不逐行读取。
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    Reflect.get(globalThis, "sidebar").refresh();
  });
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(1);
  expect(await page.evaluate(() => Reflect.get(globalThis, "statusCalls"))).toBe(0);
  // 同一个 Host 在队列的限流窗口内不会被重复扫描。
  await page.clock.runFor(30_000);
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(1);
  // 跨过 120 秒窗口后，下一轮发现再扫一次。
  await page.clock.runFor(100_000);
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBe(2);
});

test("background polling finds a row that stopped without a terminal event", async ({ page }) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  // 未打开的行：客户端仍显示转圈，但 Host 已经停下，且不会再收到终态通知。
  await page.evaluate(() => {
    document.body.replaceChildren();
    const row = document.createElement("div");
    const attrs = {
      "data-app-action-sidebar-thread-row": "",
      "data-app-action-sidebar-thread-host-id": "local",
      "data-app-action-sidebar-thread-id": "local:unopened",
      "data-app-action-sidebar-thread-active": "false",
    };
    for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
    row.innerHTML =
      '<div class="w-4 shrink-0"><span role="status" aria-label="处理中" data-native-status>!</span></div><div data-thread-title-trigger><span data-thread-title>未打开的中断会话</span></div>';
    Object.defineProperty(row, "__reactFiber$fixture", {
      value: {
        memoizedProps: {
          conversationId: "local:unopened",
          dataAttributes: attrs,
          statusState: { type: "loading", unread: false, unreadCount: 0 },
        },
        return: null,
      },
    });
    document.body.append(row);
    // 后台核对需要读取标题与归属，才能在侧栏补出恢复按钮。
    Reflect.set(globalThis, "sidebarClient", {
      ...Reflect.get(globalThis, "sidebarClient"),
      requestThreadProjection: async (method: string, params: { threadId: string }) => ({
        thread: {
          id: params.threadId,
          name: "未打开的中断会话",
          modelProvider: "openai",
          cliVersion: "fixture",
          status: { type: "idle" },
        },
      }),
    });
    Reflect.set(globalThis, "running", true);
    Reflect.set(globalThis, "turnId", "unopened-turn");
    Reflect.get(globalThis, "sidebar").refresh();
  });
  const row = page.locator("[data-app-action-sidebar-thread-row]");
  // 首次核对时会话仍在运行，队列不会记录它；界面继续显示原生转圈。
  await page.clock.runFor(1_000);
  expect(await row.getAttribute("data-buddy-sidebar-state")).toBeNull();
  // 会话在后台停下，但没有 turn/completed：只有轮询能发现。
  await page.evaluate(() => {
    Reflect.set(globalThis, "running", false);
    Reflect.set(globalThis, "threadStatus", "failed");
  });
  // 转圈行的核对间隔是 60 秒：多跑一轮确保跨过限流边界。
  await page.clock.runFor(95_000);
  await expect(row).toHaveAttribute("data-buddy-sidebar-state", "failed");
  await expect(row.locator("[data-buddy-resume]")).toHaveCount(1);
});

test("discovery rotates hosts instead of scanning all of them at once", async ({ page }) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  // 四个 Host：每轮最多压两个 Host 的全量核对，多轮之内转完一圈。
  await page.evaluate(() => {
    Reflect.set(globalThis, "scannedHosts", []);
    Reflect.set(globalThis, "hostIds", ["local", "two", "three", "four"]);
    Reflect.set(globalThis, "recordHostScans", true);
  });
  const scanned = () => page.evaluate(() => Reflect.get(globalThis, "scannedHosts"));
  const rounds: string[][] = [];
  for (let round = 0; round < 3; round += 1) {
    const before = (await scanned()).length;
    await page.clock.runFor(65_000);
    const all = await scanned();
    rounds.push(all.slice(before));
    // 单轮最多扫两个 Host，不会把全部 Host 同时压给 Host 端。
    expect(rounds[round]?.length).toBeLessThanOrEqual(2);
  }
  // 三轮之内每个 Host 都被扫到，且不会总停在前两个 Host 上。
  const flat = rounds.flat();
  expect([...new Set(flat)].sort()).toEqual(["four", "local", "three", "two"]);
  expect(rounds.at(-1)).not.toEqual(rounds[0]);
});

test("discovery queues a session the sidebar never rendered", async ({ page }) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  // 侧栏里没有任何其它会话的行：这条漏掉的会话既不在 DOM 里，也没有终态通知可用。
  await page.evaluate(() => {
    document.body.replaceChildren();
    Reflect.set(globalThis, "interrupted", {
      threads: [
        {
          threadId: "unrendered",
          turnId: "unrendered-turn",
          title: "未渲染的中断会话",
          status: "interrupted",
          owner: "codex",
        },
      ],
      runningThreadIds: [],
      unreadable: 0,
    });
  });
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "queue")
        .list("local")
        .map((entry: { threadId: string }) => entry.threadId),
    ),
  ).not.toContain("unrendered");
  // 跨过发现间隔后，轮询让 Host 全量扫描一次并把会话补进队列。
  await page.clock.runFor(130_000);
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "queue")
        .list("local")
        .map((entry: { threadId: string }) => entry.threadId),
    ),
  ).toContain("unrendered");
  expect(await page.evaluate(() => Reflect.get(globalThis, "interruptedCalls"))).toBeGreaterThan(0);
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
    Reflect.get(globalThis, "emitTurn")("active", "cancelled-turn");
    Reflect.get(globalThis, "emitTurn")("cancelled", "cancelled-turn");
  });
  await expect(row).toHaveAttribute("data-buddy-sidebar-state", "cancelled");
  const cancelled = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(cancelled).not.toBe(recoverable);
  await page.evaluate(() => {
    Reflect.get(globalThis, "emitTurn")("active", "interrupted-turn");
    Reflect.get(globalThis, "emitTurn")("interrupted", "interrupted-turn");
  });
  await expect(row).toHaveAttribute("data-buddy-sidebar-state", "interrupted");
  const interrupted = await row.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(interrupted).not.toBe(cancelled);
  await row.evaluate((element) =>
    element.setAttribute("data-app-action-sidebar-thread-active", "true"),
  );
  await page.evaluate(() => {
    Reflect.get(globalThis, "emitTurn")("active", "running-turn");
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

test("external Harness terminal events do not offer native recovery", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.evaluate(() => Reflect.set(globalThis, "owner", "external"));
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator("[data-buddy-resume]")).toHaveCount(0);
  await expect(page.locator("[data-buddy-sidebar-state]")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([]);
});

test("fixed-model recovery works with routing disabled", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.evaluate(() => Reflect.set(globalThis, "enabled", false));
  await page.addScriptTag({ content: browserBundle });
  const resume = page.locator("[data-buddy-resume]");
  await expect(resume).toHaveCount(1);
  await resume.click();
  await expect(resume).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "finishResume")());
  await expect(page.locator("[data-buddy-recovery-error]")).toContainText("网络不可用");
  await page.locator("[data-thread-title]").click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "opened"))).toBe(1);
});
