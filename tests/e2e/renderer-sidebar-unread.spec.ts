import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { PendingConfirmationsModel, PENDING_CONFIRMATIONS_STORAGE_KEY } from './packages/renderer-extension/src/pending-confirmations-state.ts';
      import { installRendererSidebarUnread } from './packages/renderer-extension/src/renderer-sidebar-unread.ts';
      const remote = 'remote-ssh-discovered:a';
      const remoteB = 'remote-ssh-discovered:b';
      let focusOverride = null;
      let hiddenOverride = false;
      const hasFocus = document.hasFocus.bind(document);
      Object.defineProperty(document, 'hasFocus', {value: () => focusOverride ?? hasFocus()});
      Object.defineProperty(document, 'hidden', {get: () => hiddenOverride});

      // 待确认队列是蓝点的唯一来源；测试直接驱动队列，等价于渲染进程收到 turn/completed。
      let model;
      const stores = new Map();
      const storage = {
        getItem(key) { return stores.has(key) ? stores.get(key) : null; },
        setItem(key, value) { stores.set(key, value); },
      };
      const upsert = (hostId, threadId, turnId, status = 'completed') => model.upsert({
        hostId, threadId, title: threadId, turnId, status,
        items: [{ type: 'agentMessage', text: status === 'completed' ? 'done' : '' }],
        error: status === 'failed' ? { message: 'boom' } : undefined,
      });

      const mount = (host, label, threadId = 'same-id') => {
        const row = document.createElement('div');
        const attrs = {
          'data-app-action-sidebar-thread-row':'',
          'data-app-action-sidebar-thread-host-id':host,
          'data-app-action-sidebar-thread-id':host + ':' + threadId,
        };
        for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
        row.setAttribute('data-app-action-sidebar-thread-active', 'false');
        row.setAttribute('role','button'); row.setAttribute('aria-label',label); row.tabIndex=0;
        row.innerHTML='<div class="w-4 shrink-0"><span data-original-status></span></div><div data-thread-title-trigger><span data-thread-title>'+label+'</span></div>';
        row.__reactFiber$fixture = {memoizedProps:{conversationId:host === remote ? threadId : host + ':' + threadId, dataAttributes:attrs, statusState:{type:'idle',unread:false}}};
        row.onclick = () => {
          for (const other of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
            other.setAttribute('data-app-action-sidebar-thread-active', String(other === row));
          }
        };
        document.querySelector('aside').append(row);
        return row;
      };
      let row = mount(remote, 'SSH A');
      mount(remoteB, 'SSH B');
      mount('local', 'Local');
      model = new PendingConfirmationsModel(storage);
      const control = installRendererSidebarUnread({getLocale:()=> 'zh-CN', pendingConfirmations: model});
      const action = (label, handler) => {
        const button = document.createElement('button'); button.textContent=label;
        button.onclick=handler; document.querySelector('nav').append(button);
      };
      action('Complete A', () => upsert(remote, 'same-id', 'first'));
      action('Complete all', () => { upsert(remote, 'same-id', 'first'); upsert(remoteB, 'same-id', 'first'); });
      action('Complete next', () => upsert(remote, 'same-id', 'next'));
      action('Fail next', () => upsert(remote, 'same-id', 'next', 'failed'));
      action('Start next', () => model.startTurn(remote, 'same-id', 'next'));
      action('Collapse A', () => row.remove());
      action('Expand A', () => { row=mount(remote, 'SSH A'); });
      action('Replace A', () => { row.remove(); row=mount(remote, 'SSH A'); });
      action('Remove slot', () => row.querySelector('.w-4').remove());
      action('Native unread', () => {
        row.__reactFiber$fixture.memoizedProps.statusState={type:'idle',unread:true};
        row.setAttribute('aria-describedby', 'unread-a');
        const described = document.createElement('span');
        described.id = 'unread-a'; described.hidden = true; described.textContent = 'unread';
        row.append(described);
      });
      action('Native read', () => {
        row.__reactFiber$fixture.memoizedProps.statusState={type:'idle',unread:false};
        row.removeAttribute('aria-describedby');
        row.querySelector('#unread-a')?.remove();
      });
      action('Simulate blur', () => { focusOverride=false; window.dispatchEvent(new Event('blur')); });
      action('Simulate focus', () => { focusOverride=true; window.dispatchEvent(new Event('focus')); });
      action('Simulate hidden', () => {hiddenOverride=true; document.dispatchEvent(new Event('visibilitychange'));});
      action('Simulate visible', () => {hiddenOverride=false; document.dispatchEvent(new Event('visibilitychange'));});
      action('Confirm A', () => {
        for (const entry of model.pending()) {
          if (entry.hostId === remote && entry.threadId === 'same-id') model.confirm(entry);
        }
      });
      action('Dispose', () => control.dispose());
      globalThis.sidebarUnread = { model, control, upsert, pending: () => model.pending().map((entry) => [entry.hostId, entry.threadId]), state: () => [...stores.entries()] };
    `,
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Sidebar unread fixture missing");
const remoteSelector = '[data-app-action-sidebar-thread-host-id="remote-ssh-discovered:a"]';
const remoteBSelector = '[data-app-action-sidebar-thread-host-id="remote-ssh-discovered:b"]';
const dotSelector = "[data-codexhost-sidebar-unread]";

test.beforeEach(async ({ page }) => {
  const time = new Date("2026-09-29T12:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.setViewportSize({ width: 760, height: 420 });
  await page.setContent(`<style>
    body{font:14px system-ui;margin:20px;background:light-dark(#fff,#191b20);color:light-dark(#222,#eee)}
    aside{width:280px;border:1px solid #8884;border-radius:8px;padding:8px}
    aside>[role=button]{display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer}
    aside>[data-app-action-sidebar-thread-active=true]{background:#8882;border-radius:6px}
    .w-4{display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
    nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:28px;max-width:660px}
    button{padding:5px 9px;color:inherit;background:#8881;border:1px solid #8886;border-radius:5px}
  </style><aside></aside><nav></nav>`);
  await page.addScriptTag({ content: bundle });
  await page.bringToFront();
});

for (const theme of ["light", "dark"] as const) {
  test(`one blue dot per pending confirmation, cleared only when read (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addStyleTag({ content: `:root{color-scheme:${theme}}` });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const row = page.locator(remoteSelector);
    await expect(page.locator(dotSelector)).toHaveCount(0);
    await page.getByRole("button", { name: "Complete A", exact: true }).click();
    await expect(row.getByRole("img", { name: "有新结果待确认" })).toBeVisible();
    await expect(page.locator(dotSelector)).toHaveCount(1);
    expect(
      await row
        .locator(dotSelector)
        .evaluate((dot) => getComputedStyle(dot, "::after").backgroundColor),
    ).toBe("rgb(59, 130, 246)");
    await page.screenshot({ path: `test-results/sidebar-unread-${theme}.png` });
    await row.click();
    await page.clock.runFor(2_999);
    await expect(page.locator(dotSelector)).toHaveCount(1);
    await page.clock.runFor(1);
    await expect(page.locator(dotSelector)).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, "sidebarUnread").pending())).toEqual(
      [],
    );
    expect(errors).toEqual([]);
  });
}

test("dot count always equals the pending queue size", async ({ page }) => {
  await page.getByRole("button", { name: "Complete all", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(2);
  expect(await page.evaluate(() => Reflect.get(globalThis, "sidebarUnread").pending())).toEqual([
    ["remote-ssh-discovered:a", "same-id"],
    ["remote-ssh-discovered:b", "same-id"],
  ]);
  await page.getByRole("button", { name: "Confirm A", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
  await expect(page.locator(remoteBSelector).locator(dotSelector)).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "sidebarUnread").pending())).toEqual([
    ["remote-ssh-discovered:b", "same-id"],
  ]);
});

test("a new turn on the same thread clears the previous dot", async ({ page }) => {
  await page.getByRole("button", { name: "Complete A", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
  await page.getByRole("button", { name: "Start next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Complete next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
});

test("failed turns also get a dot because they also raise a completion card", async ({ page }) => {
  await page.getByRole("button", { name: "Start next", exact: true }).click();
  await page.getByRole("button", { name: "Fail next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
  expect(await page.evaluate(() => Reflect.get(globalThis, "sidebarUnread").pending())).toEqual([
    ["remote-ssh-discovered:a", "same-id"],
  ]);
});

test("official unread dot avoids duplicates while the supplement stays pending", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Complete A", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
  await page.getByRole("button", { name: "Native unread", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "sidebarUnread").pending())).toEqual([
    ["remote-ssh-discovered:a", "same-id"],
  ]);
  await page.getByRole("button", { name: "Native read", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
});

test("collapsed project, row replacement and a missing native slot keep the dot", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Collapse A", exact: true }).click();
  await page.getByRole("button", { name: "Complete A", exact: true }).click();
  await page.getByRole("button", { name: "Expand A", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toBeVisible();
  await page.getByRole("button", { name: "Replace A", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toBeVisible();
  await page.getByRole("button", { name: "Remove slot", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toBeVisible();
  await expect(page.locator(dotSelector)).toHaveCount(1);
});

test("brief visits retain the reminder and never accumulate reading time", async ({ page }) => {
  const row = page.getByRole("button", { name: "SSH A", exact: true });
  await page.getByRole("button", { name: "Complete A", exact: true }).click();
  for (let visit = 0; visit < 2; visit++) {
    await row.click();
    await page.clock.runFor(2_000);
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await page.clock.runFor(5_000);
    await expect(row.locator(dotSelector)).toBeVisible();
  }
  await page.screenshot({ path: "test-results/sidebar-unread-brief-visit.png" });
  await row.click();
  await page.clock.runFor(2_999);
  await expect(row.locator(dotSelector)).toBeVisible();
  await page.clock.runFor(1);
  await expect(row.locator(dotSelector)).toHaveCount(0);
  await page.screenshot({ path: "test-results/sidebar-unread-read.png" });
});

for (const [leave, returnToWindow] of [
  ["Simulate blur", "Simulate focus"],
  ["Simulate hidden", "Simulate visible"],
] as const) {
  test(`${leave} resets the continuous foreground reading time`, async ({ page }) => {
    await page.getByRole("button", { name: "Complete A", exact: true }).click();
    await page.getByRole("button", { name: "SSH A", exact: true }).click();
    await page.clock.runFor(2_000);
    await page.getByRole("button", { name: leave, exact: true }).click();
    await page.clock.runFor(10_000);
    await expect(page.locator(dotSelector)).toBeVisible();
    await page.getByRole("button", { name: returnToWindow, exact: true }).click();
    await page.clock.runFor(2_999);
    await expect(page.locator(dotSelector)).toBeVisible();
    await page.clock.runFor(1);
    await expect(page.locator(dotSelector)).toHaveCount(0);
  });
}

test("a new completion receives a full reading interval", async ({ page }) => {
  await page.getByRole("button", { name: "Complete A", exact: true }).click();
  await page.getByRole("button", { name: "SSH A", exact: true }).click();
  await page.clock.runFor(2_000);
  await page.getByRole("button", { name: "Start next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Complete next", exact: true }).click();
  const dot = page.locator(remoteSelector).locator(dotSelector);
  await page.clock.runFor(2_999);
  await expect(dot).toBeVisible();
  await page.clock.runFor(1);
  await expect(dot).toHaveCount(0);
});

test("disposal removes dots and restores the native slot", async ({ page }) => {
  await page.getByRole("button", { name: "Complete A", exact: true }).click();
  await page.getByRole("button", { name: "Complete all", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(2);
  await page.getByRole("button", { name: "SSH A", exact: true }).click();
  await page.clock.runFor(1_000);
  await page.getByRole("button", { name: "Dispose", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await expect(page.locator("[data-codexhost-sidebar-unread-slot]")).toHaveCount(0);
});
