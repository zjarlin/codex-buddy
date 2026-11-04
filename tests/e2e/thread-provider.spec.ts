import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hostThreadIdSchema, type ProviderRoutingParams } from "@codexhost/shared-contracts";
import { ProviderRouting } from "../../packages/host-runtime/src/provider-routing/routing.js";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { mountThreadProviderControl } from './packages/renderer-extension/src/settings/providers/thread-control.ts';
      const control = mountThreadProviderControl(document);
      document.body.append(control.root);
      const clients = new Map();
      globalThis.setContext = (hostId, threadId) => {
        if (!clients.has(hostId)) clients.set(hostId, {providerRouting: params => globalThis.providerRequest(hostId, params)});
        control.update({hostId, threadId, client: clients.get(hostId)}, 'zh-CN');
      };
      globalThis.setContext('remote', 'remote:thread-a');
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Missing thread provider bundle");

test("switches the captured remote thread, persists the selection, and closes on context change", async ({
  page,
}) => {
  const home = await mkdtemp(path.join(tmpdir(), "thread-provider-ui-"));
  const routing = new ProviderRouting(home);
  const calls: { host: string; params: ProviderRoutingParams }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await writeFile(
      path.join(home, "config.toml"),
      '[model_providers.company]\nname = "主网关"\nbase_url = "https://primary.invalid/v1"\n',
    );
    await routing.start();
    await routing.configure({
      action: "save",
      provider: {
        id: "backup",
        name: "备用网关",
        baseUrl: "https://backup.invalid/v1",
        model: "",
        enabled: false,
      },
      apiKey: "fixture-secret",
    });
    await page.exposeFunction("providerRequest", (host: string, params: ProviderRoutingParams) => {
      calls.push({ host, params });
      if (host !== "remote") throw new Error("Unexpected Host");
      return routing.configure(params, {
        threadId: hostThreadIdSchema.parse("thread-a"),
        primaryProviderId: "company",
      });
    });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.setContent(
      '<html style="color-scheme: dark"><body style="background:#202020;color:white;font:14px system-ui"></body></html>',
    );
    await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: "会话供应商", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "会话供应商", exact: true });
    await expect(dialog.getByLabel("会话供应商")).toBeEnabled();
    await dialog.getByLabel("会话供应商").selectOption("backup");
    await dialog.getByRole("button", { name: "切换供应商" }).click();
    await expect(dialog.getByRole("status")).toHaveText("已保存，从此会话的下一次模型请求生效。");
    expect(calls.at(-1)).toEqual({
      host: "remote",
      params: { action: "select", threadId: "thread-a", providerId: "backup" },
    });
    expect((await routing.store.read()).threadProviders).toEqual({ "thread-a": "backup" });
    expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      "rgb(255, 255, 255)",
    );
    await page.screenshot({ path: "/tmp/codexhost-thread-provider.png" });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "会话供应商", exact: true }).click();
    await expect(dialog.getByLabel("会话供应商")).toHaveValue("backup");
    await dialog.getByLabel("会话供应商").selectOption("");
    await dialog.getByRole("button", { name: "切换供应商" }).click();
    await expect(dialog.getByRole("status")).toContainText("已保存");
    expect((await routing.store.read()).threadProviders).toEqual({});
    await page.evaluate(() =>
      (globalThis as unknown as { setContext(host: string, thread: string): void }).setContext(
        "local",
        "thread-b",
      ),
    );
    await expect(dialog).toHaveCount(0);
    expect(calls.every((call) => call.host === "remote")).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await routing.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("shows a concise native SSH capability error without claiming a saved switch", async ({
  page,
}) => {
  await page.exposeFunction("providerRequest", () => {
    throw new Error(
      "Invalid request: unknown variant `codexhost/providers/routing`, expected one of `initialize`, `thread/start`",
    );
  });
  await page.setContent('<html style="color-scheme: dark"><body></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "会话供应商", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("此连接未接入支持多供应商的 CodexBuddy Host");
  await expect(page.getByRole("button", { name: "切换供应商" })).toBeDisabled();
  await expect(page.getByRole("dialog")).not.toContainText("unknown variant");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("keeps the previous selection when saving fails", async ({ page }) => {
  await page.exposeFunction("providerRequest", (_host: string, params: ProviderRoutingParams) => {
    if (params.action === "select") throw new Error("Connection lost");
    return {
      enabled: true,
      ready: true,
      providers: [{ id: "backup", name: "备用网关", keyConfigured: true }],
      primaryProviders: [{ id: "company", name: "主网关" }],
      lastRoute: null,
      thread: {
        threadId: "thread-a",
        primaryProviderId: "company",
        providerId: null,
        covered: true,
      },
    };
  });
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "会话供应商", exact: true }).click();
  await page.getByRole("combobox").selectOption("backup");
  await page.getByRole("button", { name: "切换供应商" }).click();
  await expect(page.getByRole("alert")).toHaveText("Connection lost");
  await expect(page.getByRole("combobox")).toHaveValue("");
});
