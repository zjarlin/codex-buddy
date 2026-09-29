import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { installRendererSidebarVisits } from './packages/renderer-extension/src/renderer-sidebar-visits.ts';
      import { installRendererSidebarUnread } from './packages/renderer-extension/src/renderer-sidebar-unread.ts';
      const hostA = 'remote-ssh-discovered:a';
      const hostB = 'remote-ssh-discovered:b';
      let activeHost = sessionStorage.getItem('selectedHost') ?? 'local';
      const callbacks = new Map();
      const managers = new Map([hostA, hostB].map(host => [host, {
        addNotificationCallback(_, callback) {callbacks.set(host, callback); return () => callbacks.delete(host);}
      }]));
      const select = host => {
        activeHost = host;
        sessionStorage.setItem('selectedHost', host);
        for (const row of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
          row.setAttribute('data-app-action-sidebar-thread-active', String(row.getAttribute('data-app-action-sidebar-thread-host-id') === host));
        }
      };
      const mount = (host, label, threadId = 'same-id') => {
        const row = document.createElement('div');
        const attrs = {
          'data-app-action-sidebar-thread-row':'',
          'data-app-action-sidebar-thread-host-id':host,
          'data-app-action-sidebar-thread-id':host + ':' + threadId,
        };
        for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
        row.setAttribute('data-app-action-sidebar-thread-active', String(host === activeHost));
        row.setAttribute('role', 'button'); row.setAttribute('aria-label', label); row.tabIndex=0;
        row.innerHTML='<div class="w-4 shrink-0"><span data-original-status></span></div><div data-thread-title-trigger><span data-thread-title>'+label+'</span></div><button aria-label="会话菜单">⋯</button>';
        row.__reactFiber$fixture = {memoizedProps:{conversationId:host === hostA ? threadId : host + ':' + threadId, dataAttributes:attrs, statusState:{type:'idle',unread:false}}};
        row.onclick=()=>select(host);
        row.onkeydown=event=>{if(event.target === row && ['Enter',' '].includes(event.key)){event.preventDefault();select(host);}};
        row.querySelector('button').onclick=event=>{event.stopPropagation();document.querySelector('output').textContent='会话菜单已打开';};
        document.querySelector('aside').append(row);
        return row;
      };
      let rowA = mount(hostA, '修复 SSH 会话状态提示');
      mount(hostB, '核对远程构建结果');
      mount('local', '整理本地工作区');
      const visits = installRendererSidebarVisits({getLocale:()=> 'zh-CN'});
      const unread = installRendererSidebarUnread({getManager:host=>managers.get(host) ?? null, getLocale:()=> 'zh-CN'});
      const action = (label, handler) => {
        const button=document.createElement('button'); button.textContent=label; button.onclick=handler;
        document.querySelector('nav').append(button);
      };
      action('新页面', ()=>select(''));
      action('折叠 A', ()=>rowA.remove());
      action('展开 A', ()=>{rowA=mount(hostA, '修复 SSH 会话状态提示');});
      action('重绘 A', ()=>{rowA.remove();rowA=mount(hostA, '修复 SSH 会话状态提示');});
      action('置顶 A', ()=>mount(hostA, '置顶的 SSH 会话'));
      action('创建草稿', ()=>mount(hostA, '新会话草稿', 'client-new-thread:pending'));
      action('完成 A', ()=>callbacks.get(hostA)?.({method:'turn/completed',params:{threadId:'same-id',turn:{id:'first',status:'completed'}}}));
      action('刷新控件', ()=>{visits.refresh();unread.refresh();});
      action('卸载', ()=>{visits.dispose();unread.dispose();});
    `,
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Sidebar visits fixture missing");
const badgeSelector = "[data-codexhost-sidebar-visits]";
const dotSelector = "[data-codexhost-sidebar-unread]";
const rowAName = "修复 SSH 会话状态提示";
const rowBName = "核对远程构建结果";
const localName = "整理本地工作区";
const storageKey = 'codexhost.sidebar-visits.v1:["remote-ssh-discovered:a","same-id"]';
const fixture = `<!doctype html><style>
  :root{color-scheme:light dark}
  body{margin:20px;background:light-dark(#fff,#191b20);color:light-dark(#222,#eee);font:13px system-ui}
  aside{box-sizing:border-box;width:280px;border:1px solid #8884;border-radius:8px;padding:8px}
  aside>[role=button]{display:flex;align-items:center;gap:6px;padding:8px;cursor:pointer;min-width:0;border-radius:6px}
  aside>[data-app-action-sidebar-thread-active=true]{background:#8882}
  [data-thread-title-trigger]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .w-4{display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
  aside button{border:0;padding:0 2px;background:transparent;color:inherit;cursor:pointer}
  nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:28px;max-width:600px}
  nav button{padding:5px 9px;color:inherit;background:#8881;border:1px solid #8886;border-radius:5px}
</style><aside></aside><nav></nav><output></output><script src="/fixture.js"></script>`;

test.beforeEach(async ({ page, context }) => {
  await page.setViewportSize({ width: 680, height: 380 });
  await context.route("https://codexhost.test/**", (route) =>
    route.fulfill(
      route.request().url().endsWith("/fixture.js")
        ? { contentType: "application/javascript", body: bundle }
        : { contentType: "text/html", body: fixture },
    ),
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`visits count actual navigation and coexist with unread dots (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    const time = new Date("2026-09-29T12:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://codexhost.test/");
    const row = page.getByRole("button", { name: rowAName, exact: true });
    const badge = row.locator(badgeSelector);
    await expect(badge).toHaveText("0");
    await row.getByRole("button", { name: "会话菜单", exact: true }).click();
    await expect(page.locator("output")).toHaveText("会话菜单已打开");
    await expect(badge).toHaveText("0");
    await page.getByRole("button", { name: "完成 A", exact: true }).click();
    await row.click();
    await expect(badge).toHaveText("1");
    await row.click();
    await page.getByRole("button", { name: "刷新控件", exact: true }).click();
    await expect(badge).toHaveText("1");
    await page.clock.runFor(1_000);
    await page.getByRole("button", { name: rowBName, exact: true }).click();
    await expect(row.locator(dotSelector)).toBeVisible();
    await row.press("Enter");
    await expect(badge).toHaveText("2");
    await page.clock.runFor(1_000);
    await page.getByRole("button", { name: localName, exact: true }).click();
    await expect(badge).toHaveAttribute("title", "查阅 2 次");
    await page.screenshot({ path: `test-results/sidebar-visits-${theme}.png` });
    await row.click();
    await page.clock.runFor(3_000);
    await expect(row.locator(dotSelector)).toHaveCount(0);
    await expect(badge).toHaveText("3");
    await page.getByRole("button", { name: "新页面", exact: true }).click();
    await row.click();
    await expect(badge).toHaveText("4");
    expect(errors).toEqual([]);
  });
}

test("counts persist across reloads with Host isolation and no restored-selection increment", async ({
  page,
}) => {
  await page.goto("https://codexhost.test/");
  const row = page.getByRole("button", { name: rowAName, exact: true });
  await row.click();
  await page.reload();
  await expect(row.locator(badgeSelector)).toHaveText("1");
  await expect(
    page.getByRole("button", { name: rowBName, exact: true }).locator(badgeSelector),
  ).toHaveText("0");
  await page.getByRole("button", { name: rowBName, exact: true }).click();
  await row.click();
  await expect(row.locator(badgeSelector)).toHaveText("2");
  await expect(
    page.getByRole("button", { name: rowBName, exact: true }).locator(badgeSelector),
  ).toHaveText("1");
});

test("collapse, redraw and duplicate sidebar rows preserve counts; drafts are excluded", async ({
  page,
}) => {
  await page.goto("https://codexhost.test/");
  const row = page.getByRole("button", { name: rowAName, exact: true });
  await row.click();
  await page.getByRole("button", { name: "折叠 A", exact: true }).click();
  await page.getByRole("button", { name: "展开 A", exact: true }).click();
  await expect(row.locator(badgeSelector)).toHaveText("1");
  await page.getByRole("button", { name: "重绘 A", exact: true }).click();
  await expect(row.locator(badgeSelector)).toHaveText("1");
  await page.getByRole("button", { name: "置顶 A", exact: true }).click();
  await page.getByRole("button", { name: localName, exact: true }).click();
  await page.getByRole("button", { name: "置顶的 SSH 会话", exact: true }).click();
  await expect(row.locator(badgeSelector)).toHaveText("2");
  await expect(
    page.getByRole("button", { name: "置顶的 SSH 会话", exact: true }).locator(badgeSelector),
  ).toHaveText("2");
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新会话草稿", exact: true }).locator(badgeSelector),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(page.locator(badgeSelector)).toHaveCount(0);
  await page.getByRole("button", { name: localName, exact: true }).click();
  await row.click();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe("2");
});

test("other windows receive saved counts without adding visits", async ({ page, context }) => {
  await page.goto("https://codexhost.test/");
  const other = await context.newPage();
  await other.goto("https://codexhost.test/");
  await page.getByRole("button", { name: rowAName, exact: true }).click();
  const otherRow = other.getByRole("button", { name: rowAName, exact: true });
  await expect(otherRow.locator(badgeSelector)).toHaveText("1");
  await otherRow.click();
  await expect(
    page.getByRole("button", { name: rowAName, exact: true }).locator(badgeSelector),
  ).toHaveText("2");
});

test("invalid stored counts restart at zero", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "-5"), storageKey);
  await page.goto("https://codexhost.test/");
  const row = page.getByRole("button", { name: rowAName, exact: true });
  await expect(row.locator(badgeSelector)).toHaveText("0");
  await row.click();
  await expect(row.locator(badgeSelector)).toHaveText("1");
});

test("unavailable storage retains in-window counts", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
  });
  await page.goto("https://codexhost.test/");
  const row = page.getByRole("button", { name: rowAName, exact: true });
  await row.click();
  await page.getByRole("button", { name: localName, exact: true }).click();
  await row.click();
  await expect(row.locator(badgeSelector)).toHaveText("2");
});
