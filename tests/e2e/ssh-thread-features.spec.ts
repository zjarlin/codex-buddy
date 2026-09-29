import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { installRendererThreadActions } from './packages/renderer-extension/src/renderer-thread-actions.ts';
      import { installSidebarContinuation } from './packages/renderer-extension/src/buddy/continuation.ts';
      import { installBuddyControl } from './packages/renderer-extension/src/buddy/control.ts';
      globalThis.calls = [];
      let active = 'local';
      let finishConfigure;
      const clients = Object.fromEntries(['local', 'remote-ssh-discovered:okm252'].map(hostId => {
        const snapshot = { settings: { enabled: true, planning: true, privateMode: false, bypass: true, role: 'auto', plannerModel: null, executorModel: null }, models: [], decisions: [] };
        let recovered = false;
        const client = {
          threadOpenTarget: async threadId => {
            globalThis.calls.push({hostId, method:'target',threadId});
            return {workspace:'/remote/project',codexPath:'/remote/bin/codex',codexHome:'/root/.codex'};
          },
          listThreadTerminals: async () => ({terminals:[{id:'apple-terminal',name:'Terminal',installed:true,default:true}]}),
          openThreadTerminal: async params => { globalThis.calls.push({hostId,method:'terminal',params}); return {}; },
          openThreadWorkspace: async params => { globalThis.calls.push({hostId,method:'workspace',params}); return {}; },
          buddyStatus: async () => structuredClone(snapshot),
          buddyConfigure: async settings => {
            if(hostId === 'local') await new Promise(resolve => { finishConfigure = resolve; });
            snapshot.settings = settings;
            return structuredClone(snapshot);
          },
          buddyInterrupted: async () => ({threads:recovered?[]:[{threadId:'same-id',turnId:'failed',title:hostId,status:'interrupted',owner:'codex'}],runningThreadIds:[],unreadable:0}),
          buddyContinue: async (threadId,turnId) => { globalThis.calls.push({hostId,method:'continue',threadId,turnId}); recovered=true; },
        };
        return [hostId,client];
      }));
      for(const row of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
        row.__reactFiber$fixture={memoizedProps:{conversationId:'same-id',dataAttributes:Object.fromEntries(row.getAttributeNames().map(name=>[name,row.getAttribute(name)]))}};
      }
      installRendererThreadActions({getClient:hostId=>clients[hostId],getLocale:()=> 'zh-CN'});
      installSidebarContinuation({getClient:hostId=>clients[hostId],getLocale:()=> 'zh-CN'});
      const control = installBuddyControl(()=>({anchor:document.querySelector('#composer'),threadId:'same-id',client:clients[active]}),()=> 'zh-CN');
      document.querySelector('#switch-host').addEventListener('click',()=> {active='remote-ssh-discovered:okm252';void control.refresh();});
      document.querySelector('#finish').addEventListener('click',()=>finishConfigure?.());
    `,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("SSH fixture bundle missing");

test.beforeEach(async ({ page }) => {
  await page.setContent(`<body style="background:#191b20;color:#eee;color-scheme:dark;font:14px system-ui;padding:24px">
    <button id="switch-host">Switch to SSH</button><button id="finish">Complete local request</button>
    ${["local", "remote-ssh-discovered:okm252"]
      .map(
        (host) => `<div
      data-app-action-sidebar-thread-row data-app-action-sidebar-thread-host-id="${host}"
      data-app-action-sidebar-thread-id="${host}:same-id" data-app-action-sidebar-thread-active="false"
      role="button" style="display:flex;align-items:center;gap:8px;padding:16px;width:340px">
      <div class="w-4 shrink-0" style="width:16px;height:16px;position:relative"><span>!</span></div>
      <div data-thread-title-trigger><span data-thread-title>${host}</span></div></div>`,
      )
      .join("")}
    <div id="composer"></div></body>`);
  await page.addScriptTag({ content: bundle });
});

test("SSH terminal and workspace use the local desktop and remote thread metadata", async ({
  page,
}) => {
  const row = page.locator(
    '[data-app-action-sidebar-thread-host-id="remote-ssh-discovered:okm252"]',
  );
  await row.hover();
  await row.locator("[data-codexhost-thread-actions-trigger]").click();
  await page.screenshot({ path: "test-results/ssh-thread-actions-before.png" });
  await page.getByRole("menuitem", { name: "从终端打开" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await row.hover();
  await row.locator("[data-codexhost-thread-actions-trigger]").click();
  await page.getByRole("menuitem", { name: /VS Code/ }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const calls = await page.evaluate(() => Reflect.get(globalThis, "calls"));
  expect(calls.filter((call: { method: string }) => call.method === "target")).toHaveLength(2);
  for (const method of ["terminal", "workspace"]) {
    expect(calls.find((call: { method: string }) => call.method === method)).toMatchObject({
      hostId: "local",
      method,
      params: {
        threadId: "same-id",
        remote: {
          hostId: "remote-ssh-discovered:okm252",
          workspace: "/remote/project",
          codexHome: "/root/.codex",
          codexPath: "/remote/bin/codex",
        },
      },
    });
  }
  await page.screenshot({ path: "test-results/ssh-thread-actions-after.png" });
});

test("interrupted SSH thread resumes only on its owning Host", async ({ page }) => {
  const remote = page.locator(
    '[data-app-action-sidebar-thread-host-id="remote-ssh-discovered:okm252"]',
  );
  const local = page.locator('[data-app-action-sidebar-thread-host-id="local"]');
  await expect(remote.locator("[data-buddy-resume]")).toBeVisible();
  await page.screenshot({ path: "test-results/ssh-recovery-before.png" });
  await remote.locator("[data-buddy-resume]").click();
  await expect(remote.locator("[data-buddy-resume]")).toHaveCount(0);
  await expect(local.locator("[data-buddy-resume]")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "calls"))).toEqual([
    {
      hostId: "remote-ssh-discovered:okm252",
      method: "continue",
      threadId: "same-id",
      turnId: "failed",
    },
  ]);
  await page.screenshot({ path: "test-results/ssh-recovery-after.png" });
});

test("late local settings cannot overwrite the selected SSH Host", async ({ page }) => {
  await page.locator("[data-buddy-router] summary").click();
  const toggle = page.getByRole("switch", { name: /Auto Router/ });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await page.getByRole("button", { name: "Switch to SSH" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/ssh-settings-before.png" });
  await page.getByRole("button", { name: "Complete local request" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/ssh-settings-after.png" });
});
