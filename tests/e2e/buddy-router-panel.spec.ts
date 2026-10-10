import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installBuddyControl } from './packages/renderer-extension/src/buddy/control.ts';
      import { createDefaultRendererSettingsPages } from './packages/renderer-extension/src/settings/pages.ts';
      import { createRendererSettingsPageRegistry } from './packages/renderer-extension/src/settings/core.ts';
      import { rendererSettingsMessages } from './packages/renderer-extension/src/settings/localization.ts';
      import { mountRendererSettingsShell } from './packages/renderer-extension/src/settings/shell.ts';
      import { RendererMethodUnavailableError } from './packages/renderer-extension/src/renderer-request-sender.ts';
      const snapshot = {
        settings: {enabled:true,privateMode:false,bypass:true,jev:true,role:'auto',systemOneModel:'typesafe/jev',executorModel:null},
        models: [{id:'gpt-6',tier:'夯',eligible:true},{id:'deepseek-flash',tier:'垃',eligible:true}],
        decisions: [], jevKeyConfigured:false, jevBaseUrl:null,
      };
      const calls = {writes:[],keys:[],continuations:[],status:0,interrupted:0,cancels:[]};
      let threads = [{threadId:'stalled',turnId:'interrupted-turn',title:'网络中断的会话',status:'interrupted',owner:'codex'}];
      const client = {
        buddyStatus: async()=>{
          calls.status++;
          if(globalThis.unsupported) throw new RendererMethodUnavailableError('codexhost/buddy/status',null);
          if(globalThis.statusFailure) throw new Error('连接失败');
          return structuredClone(snapshot);
        },
        buddyConfigure: async(value)=>{
          if(globalThis.saveFailure) throw new Error('保存失败');
          calls.writes.push(value); snapshot.settings=value; return structuredClone(snapshot);
        },
        buddyJevKey: async(value)=>{
          if(globalThis.saveFailure) throw new Error('保存失败');
          calls.keys.push(value);
          if(value.apiKey!==undefined) snapshot.jevKeyConfigured=Boolean(value.apiKey);
          if(value.baseURL!==undefined) snapshot.jevBaseUrl=value.baseURL;
          return structuredClone(snapshot);
        },
        buddyModels:async()=>structuredClone(snapshot),
        buddyCancel:async(id)=>{calls.cancels.push(id);snapshot.decisions=[];return structuredClone(snapshot);},
        buddyInterrupted:async()=>{calls.interrupted++;return {threads:structuredClone(threads),runningThreadIds:[],unreadable:0};},
        buddyContinue:async(...args)=>{
          calls.continuations.push(args);
          if(globalThis.continueFailure) throw new Error('网络不可用');
          threads=[];
        },
      };
      globalThis.fixture={snapshot,calls,client};
      const favorite=document.createElement('div');
      favorite.dataset.codexhostModelShortcuts=''; favorite.textContent='收藏模型';
      const anchor=document.createElement('div'); anchor.textContent='输入消息';
      const open=document.createElement('button');open.textContent='设置';
      document.body.append(open,favorite,anchor);
      const messages=rendererSettingsMessages('zh-CN');
      const registry=createRendererSettingsPageRegistry(createDefaultRendererSettingsPages(messages,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,()=>globalThis.fixture.client));
      const shell=mountRendererSettingsShell(registry,document,messages);
      open.addEventListener('click',()=>shell.openSettings(open,'routing'));
      globalThis.fixture.control=installBuddyControl(()=>({anchor,threadId:'work',client:globalThis.fixture.client}),()=> 'zh-CN');
      globalThis.fixture.control.setModelShortcutsView({models:[{id:'gpt-6',label:'GPT-6'}],supportsCustomModel:true},'codex');
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  write: false,
});
const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Routing settings fixture bundle missing");

for (const width of [390, 1200]) {
  for (const theme of ["light", "dark"] as const) {
    test(`routing lives in settings with no composer panel at ${width}px ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: theme });
      await page.setContent(
        `<html style="color-scheme:${theme};background:${theme === "dark" ? "#202020" : "#fff"};color:${theme === "dark" ? "#ececec" : "#0d0d0d"}"><body style="font:14px system-ui"></body></html>`,
      );
      await page.addScriptTag({ content: bundle });
      await expect(page.locator("[data-buddy-router]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "恢复", exact: true })).toBeVisible();
      expect(
        await page
          .locator("[data-buddy-recovery]")
          .evaluate((element) =>
            element.nextElementSibling?.hasAttribute("data-codexhost-model-shortcuts"),
          ),
      ).toBe(true);
      await page.screenshot({ path: `test-results/buddy-composer-${width}-${theme}.png` });
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await expect(page.locator(".settings-brand__name")).toHaveText("Codex Buddy");
      await expect(page.getByRole("switch", { name: "自动路由", exact: true })).toBeChecked();
      await expect(page.getByText("自动规划", { exact: true })).toHaveCount(0);
      await expect(page.getByText("夯 · 规划模型", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("执行模型", { exact: true })).toBeVisible();
      await page.getByLabel("执行模型", { exact: true }).selectOption("gpt-6");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await expect(page.locator(".settings-routing-status")).toHaveText("已保存");
      expect(
        await page.evaluate(() => Reflect.get(globalThis, "fixture").calls.writes[0]),
      ).toMatchObject({ executorModel: "gpt-6" });
      await expect(page.getByRole("switch", { name: "隐私模式", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("执行模型", { exact: true })).toBeEnabled();
      await expect(page.getByLabel("JEV API Key", { exact: true })).toBeEnabled();
      await page.screenshot({ path: `test-results/buddy-routing-${width}-${theme}.png` });
      expect(
        await page
          .locator(".settings-routing-form")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("saves and clears secrets through the current Host without displaying the stored key", async ({
  page,
}) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const key = page.getByLabel("JEV API Key", { exact: true });
  const url = page.getByLabel("JEV 网关地址", { exact: true });
  await expect(key).toHaveAttribute("type", "password");
  await key.fill("fixture-secret");
  await url.fill("https://gateway.example/v1");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(page.getByText("密钥已配置", { exact: true })).toBeVisible();
  await expect(key).toHaveValue("");
  expect(await page.locator(".settings-routing-form").innerText()).not.toContain("fixture-secret");
  await page.getByRole("button", { name: "清除连接", exact: true }).click();
  await expect(page.getByText("密钥未配置", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "fixture").calls.keys)).toEqual([
    { apiKey: "fixture-secret", baseURL: "https://gateway.example/v1" },
    { apiKey: null, baseURL: null },
  ]);
  await page.screenshot({ path: "test-results/buddy-routing-secret.png" });
});

test("retains typed configuration after failure and prevents writes after switching Hosts", async ({
  page,
}) => {
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const key = page.getByLabel("JEV API Key", { exact: true });
  await key.fill("unsaved-fixture");
  await page.evaluate(() => Reflect.set(globalThis, "saveFailure", true));
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(page.locator(".settings-routing-status")).toHaveText("保存失败");
  await expect(key).toHaveValue("unsaved-fixture");
  await page.evaluate(() => {
    Reflect.get(globalThis, "fixture").client = {};
  });
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator(".settings-routing-status")).toHaveText("当前连接不支持路由设置。");
  expect(await page.evaluate(() => Reflect.get(globalThis, "fixture").calls.writes)).toEqual([]);
  await page.screenshot({ path: "test-results/buddy-routing-host-changed.png" });
});

test("recovery stays independent of unavailable routing and does not poll in the background", async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.evaluate(() => Reflect.set(globalThis, "unsupported", true));
  await page.addScriptTag({ content: bundle });
  const resume = page.getByRole("button", { name: "恢复", exact: true });
  await expect(resume).toBeVisible();
  const before = await page.evaluate(() => Reflect.get(globalThis, "fixture").calls);
  await page.clock.runFor(10_000);
  expect(await page.evaluate(() => Reflect.get(globalThis, "fixture").calls)).toEqual(before);
  await page.evaluate(() => Reflect.set(globalThis, "continueFailure", true));
  await resume.click();
  await expect(page.getByText("恢复失败: 网络不可用", { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.set(globalThis, "continueFailure", false));
  await resume.click();
  await expect(resume).toHaveCount(0);
  await page.screenshot({ path: "test-results/buddy-recovery-independent.png" });
});
