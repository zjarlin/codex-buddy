import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { installRendererSidebarUnread } from './packages/renderer-extension/src/renderer-sidebar-unread.ts';
      const remote = 'remote-ssh-discovered:a';
      const callbacks = new Map();
      const retired = [];
      globalThis.subscriptions = [];
      const manager = host => ({addNotificationCallback(methods, callback) {
        globalThis.subscriptions.push(host);
        callbacks.set(host, callback);
        return () => {retired.push(callback); callbacks.delete(host);};
      }});
      const managers = new Map([remote, 'remote-ssh-discovered:b', 'local'].map(host => [host, manager(host)]));
      const notify = (method, id = 'first', status = 'completed') => {
        for (const callback of callbacks.values()) callback({method, params:{threadId:'same-id', turn:{id,status}}});
      };
      const mount = (host, label) => {
        const row = document.createElement('div');
        const attrs = {
          'data-app-action-sidebar-thread-row':'',
          'data-app-action-sidebar-thread-host-id':host,
          'data-app-action-sidebar-thread-id':host + ':same-id',
        };
        for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
        row.setAttribute('data-app-action-sidebar-thread-active', 'false');
        row.setAttribute('role','button'); row.setAttribute('aria-label',label); row.tabIndex=0;
        row.innerHTML='<div class="w-4 shrink-0"><span data-original-status></span></div><div data-thread-title-trigger><span data-thread-title>'+label+'</span></div>';
        row.__reactFiber$fixture = {memoizedProps:{conversationId:host === remote ? 'same-id' : host + ':same-id', dataAttributes:attrs, statusState:{type:'idle',unread:false}}};
        row.onclick = () => {
          for (const other of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
            other.setAttribute('data-app-action-sidebar-thread-active', String(other === row));
          }
        };
        document.querySelector('aside').append(row);
        return row;
      };
      let row = mount(remote, 'SSH A');
      mount('remote-ssh-discovered:b', 'SSH B');
      mount('local', 'Local');
      const control = installRendererSidebarUnread({getManager:host => managers.get(host) ?? null, getLocale:()=> 'zh-CN'});
      const action = (label, handler) => {
        const button = document.createElement('button'); button.textContent=label;
        button.onclick=handler; document.querySelector('nav').append(button);
      };
      action('Complete first', () => callbacks.get(remote)?.({method:'turn/completed',params:{threadId:'same-id',turn:{id:'first',status:'completed'}}}));
      action('Complete all', () => notify('turn/completed'));
      action('Start next', () => notify('turn/started', 'next', 'inProgress'));
      action('Complete next', () => notify('turn/completed', 'next'));
      action('Fail next', () => notify('turn/completed', 'next', 'failed'));
      action('Interrupt next', () => notify('turn/completed', 'next', 'interrupted'));
      action('Collapse A', () => row.remove());
      action('Expand A', () => { row=mount(remote, 'SSH A'); });
      action('Replace A', () => { row.remove(); row=mount(remote, 'SSH A'); });
      action('Remove slot', () => row.querySelector('.w-4').remove());
      action('Native unread', () => {
        row.__reactFiber$fixture.memoizedProps.statusState.unread=true;
        row.querySelector('[data-original-status]').innerHTML='<span class="native-unread" aria-label="Native unread"></span>';
      });
      action('Native read', () => {
        row.__reactFiber$fixture.memoizedProps.statusState.unread=false;
        row.querySelector('[data-original-status]').replaceChildren();
      });
      action('Reconnect', () => {managers.set(remote, manager(remote)); control.refresh();});
      action('Old notification', () => retired.forEach(callback => callback({method:'turn/completed',params:{threadId:'same-id',turn:{id:'stale',status:'completed'}}})));
      action('Dispose', () => control.dispose());
    `,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Sidebar unread fixture missing");
const remoteSelector = '[data-app-action-sidebar-thread-host-id="remote-ssh-discovered:a"]';
const dotSelector = "[data-codexhost-sidebar-unread]";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 420 });
  await page.setContent(`<style>
    body{font:14px system-ui;margin:20px;background:light-dark(#fff,#191b20);color:light-dark(#222,#eee)}
    aside{width:280px;border:1px solid #8884;border-radius:8px;padding:8px}
    aside>[role=button]{display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer}
    aside>[data-app-action-sidebar-thread-active=true]{background:#8882;border-radius:6px}
    .w-4{display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
    .native-unread{display:block;width:8px;height:8px;border-radius:50%;background:#3b82f6}
    nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:28px;max-width:660px}
    button{padding:5px 9px;color:inherit;background:#8881;border:1px solid #8886;border-radius:5px}
  </style><aside></aside><nav></nav>`);
  await page.addScriptTag({ content: bundle });
  await page.bringToFront();
});

for (const theme of ["light", "dark"] as const) {
  test(`first SSH completion shows a blue dot until read (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addStyleTag({ content: `:root{color-scheme:${theme}}` });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const row = page.locator(remoteSelector);
    await expect(page.locator(dotSelector)).toHaveCount(0);
    await page.getByRole("button", { name: "Complete first", exact: true }).click();
    await expect(row.getByRole("img", { name: "新回复，尚未阅读" })).toBeVisible();
    await expect(page.locator(dotSelector)).toHaveCount(1);
    expect(
      await row
        .locator(dotSelector)
        .evaluate((dot) => getComputedStyle(dot, "::after").backgroundColor),
    ).toBe("rgb(59, 130, 246)");
    await page.screenshot({ path: `test-results/sidebar-unread-${theme}.png` });
    await row.click();
    await expect(page.locator(dotSelector)).toHaveCount(0);
    await page.getByRole("button", { name: "Local", exact: true }).click();
    await page.getByRole("button", { name: "Complete first", exact: true }).click();
    await expect(page.locator(dotSelector)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("viewed replies and unsuccessful turns do not acquire an unread dot", async ({ page }) => {
  await page.getByRole("button", { name: "SSH A", exact: true }).click();
  await page.getByRole("button", { name: "Complete first", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Start next", exact: true }).click();
  await page.getByRole("button", { name: "Fail next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
});

test("Hosts stay isolated and restarting a turn clears its prior blue dot", async ({ page }) => {
  await page.getByRole("button", { name: "Complete all", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(2);
  await page.getByRole("button", { name: "SSH A", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "SSH B", exact: true }).locator(dotSelector),
  ).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "subscriptions"))).not.toContain(
    "local",
  );
  await page.getByRole("button", { name: "Start next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Complete first", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Complete next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(2);
});

test("first completion survives a collapsed project, row replacement and a missing native slot", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Collapse A", exact: true }).click();
  await page.getByRole("button", { name: "Complete first", exact: true }).click();
  await page.getByRole("button", { name: "Expand A", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toBeVisible();
  await page.getByRole("button", { name: "Replace A", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toBeVisible();
  await page.getByRole("button", { name: "Remove slot", exact: true }).click();
  await expect(page.locator(remoteSelector).locator(dotSelector)).toBeVisible();
  await expect(page.locator(dotSelector)).toHaveCount(1);
});

test("native unread state takes over without a duplicate dot or stale read state", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Complete first", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
  await page.getByRole("button", { name: "Native unread", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await expect(page.getByLabel("Native unread", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Native read", exact: true }).click();
  await page.getByRole("button", { name: "Complete first", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
});

test("reconnecting keeps unread replies and ignores retired notifications; disposal restores the slot", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Complete first", exact: true }).click();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(1);
  await page.getByRole("button", { name: "SSH A", exact: true }).click();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.getByRole("button", { name: "Old notification", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Start next", exact: true }).click();
  await page.getByRole("button", { name: "Complete next", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(2);
  await page.getByRole("button", { name: "Dispose", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
  await expect(page.locator("[data-codexhost-sidebar-unread-slot]")).toHaveCount(0);
  await page.getByRole("button", { name: "Old notification", exact: true }).click();
  await expect(page.locator(dotSelector)).toHaveCount(0);
});
