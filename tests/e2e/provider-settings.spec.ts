import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type RequestListener } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderRoutingParams } from "@codexhost/shared-contracts";
import { ProviderRouting } from "../../packages/host-runtime/src/provider-routing/routing.js";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { createProvidersSettingsPage } from './packages/renderer-extension/src/settings/providers/page.ts';
      import { createRendererSettingsPageRegistry } from './packages/renderer-extension/src/settings/core.ts';
      import { rendererSettingsMessages } from './packages/renderer-extension/src/settings/localization.ts';
      import { mountRendererSettingsShell } from './packages/renderer-extension/src/settings/shell.ts';
      const clientForHost = host => ({providerRouting: params => globalThis.providerRequest(host, params)});
      const source = {currentHostId: () => globalThis.selectedHost, knownHostIds: () => ['local', 'remote'], clientForHost};
      const messages = rendererSettingsMessages('zh-CN');
      const registry = createRendererSettingsPageRegistry([createProvidersSettingsPage(messages, () => source)]);
      mountRendererSettingsShell(registry, document, messages).openSettings(undefined, 'providers');
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
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Provider settings fixture bundle missing");

for (const selected of ["local", "remote"] as const) {
  test(`configures ${selected} Host and hot-repairs a failed fallback through the UI`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const cleanup: (() => Promise<unknown>)[] = [];
    const serve = async (handler: RequestListener) => {
      const server = createServer(handler);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      cleanup.push(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture listener");
      return `http://127.0.0.1:${address.port}/v1`;
    };
    try {
      const primary = await serve((_request, response) =>
        response.writeHead(503).end("primary unavailable"),
      );
      const failedBackup = await serve((_request, response) =>
        response.writeHead(502).end("backup unavailable"),
      );
      const received: {
        authorization: string | undefined;
        input: unknown;
        model: unknown;
        cookie: string | undefined;
      }[] = [];
      const healthyBackup = await serve(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        received.push({
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
          input: body.input,
          model: body.model,
        });
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ output_text: "hi from backup" }));
      });
      const hosts = new Map<string, ProviderRouting>();
      for (const id of ["local", "remote"]) {
        const home = await mkdtemp(path.join(tmpdir(), "provider-ui-"));
        cleanup.push(() => rm(home, { recursive: true, force: true }));
        await writeFile(
          path.join(home, "config.toml"),
          `[model_providers.company]\nname = "${id} gateway"\nbase_url = "${primary}"\nwire_api = "responses"\n`,
        );
        const routing = new ProviderRouting(home);
        await routing.start();
        cleanup.push(() => routing.close());
        hosts.set(id, routing);
      }
      await page.exposeFunction(
        "providerRequest",
        (host: string, params: ProviderRoutingParams) => {
          const routing = hosts.get(host);
          if (!routing) throw new Error("Unknown fixture Host");
          return routing.configure(params);
        },
      );
      await page.setViewportSize({ width: selected === "local" ? 1200 : 390, height: 1000 });
      await page.route("https://providers.example.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<html><body style="font:14px system-ui"></body></html>',
        }),
      );
      await page.goto("https://providers.example.test/");
      await page.evaluate((host) => Reflect.set(globalThis, "selectedHost", host), selected);
      await page.addScriptTag({ content: bundle });
      await expect(page.getByText(`${selected} gateway · 已接入`, { exact: true })).toBeVisible();
      await page.getByLabel("自动故障接续", { exact: true }).check();
      await expect(page.getByRole("status")).toContainText("自动接续尚未就绪");
      await page.getByRole("button", { name: "添加供应商", exact: true }).click();
      await page.getByLabel("供应商名称", { exact: true }).fill("备用测试");
      await page.getByLabel("API Base URL", { exact: true }).fill(failedBackup);
      await page.getByLabel("API Key", { exact: true }).fill("old-fixture-key");
      await page.getByLabel("备用模型（可选）", { exact: true }).fill("backup-model");
      await page.getByRole("button", { name: "保存供应商", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("自动接续已开启");
      await expect(page.getByRole("button", { name: "添加供应商", exact: true })).toBeFocused();
      const routing = hosts.get(selected);
      if (!routing) throw new Error("Selected routing missing");
      const args = routing.arguments(["app-server"]);
      const override = args.find((arg) => arg.startsWith("model_providers.company.base_url="));
      if (!override) throw new Error("Managed route missing");
      const endpoint: string = JSON.parse(override.slice(override.indexOf("=") + 1));
      const input = [
        { role: "user", content: "hi" },
        { type: "function_call_output", call_id: "already-finished", output: "keep history" },
      ];
      const request = () =>
        fetch(endpoint + "/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer primary-fixture-key",
            Cookie: "primary=private",
          },
          body: JSON.stringify({ model: "original-model", input }),
        });
      const failed = await request();
      expect(failed.status).toBe(502);
      expect(await failed.text()).toBe("backup unavailable");
      await page.getByRole("button", { name: "刷新状态", exact: true }).click();
      await expect(page.getByText(/最近故障: HTTP 错误 \(502\)/)).toBeVisible();
      await page.getByRole("button", { name: "编辑: 备用测试", exact: true }).click();
      await page.getByLabel("API Base URL", { exact: true }).fill(healthyBackup);
      await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute("required", "");
      await expect(
        page.getByText("地址已更改，请输入新地址的 API Key；原密钥不会发送到新地址。", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByLabel("API Key", { exact: true }).fill("new-fixture-key");
      await page.getByRole("button", { name: "保存供应商", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("自动接续已开启");
      const recovered = await request();
      expect(await recovered.json()).toEqual({ output_text: "hi from backup" });
      expect(received).toEqual([
        {
          authorization: "Bearer new-fixture-key",
          cookie: undefined,
          model: "backup-model",
          input,
        },
      ]);
      expect(routing.arguments(["app-server"])).toEqual(args);
      await page.getByRole("button", { name: "刷新状态", exact: true }).click();
      await expect(page.getByText(/最近成功请求: 备用测试/)).toBeVisible();
      await expect(page.getByText(/最近故障: HTTP 错误 \(503\)/)).toBeVisible();
      expect(
        await page
          .getByText("1. 备用测试", { exact: true })
          .evaluate((element) => element.parentElement?.getBoundingClientRect().width ?? 0),
      ).toBeGreaterThan(200);
      await page.screenshot({ path: `test-results/providers-${selected}.png` });
      const snapshot = await routing.configure({ action: "read" });
      expect(JSON.stringify(snapshot)).not.toContain("fixture-key");
      const other = selected === "local" ? "remote" : "local";
      await page.getByLabel("执行 Host", { exact: true }).selectOption(other);
      await expect(page.getByText("尚未配置备用供应商", { exact: true })).toBeVisible();
      await expect(page.getByLabel("自动故障接续", { exact: true })).not.toBeChecked();
      expect((await hosts.get(other)?.configure({ action: "read" }))?.providers).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      for (const dispose of cleanup.reverse()) await dispose();
    }
  });
}
