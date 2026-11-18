import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const localThread = "019ccb31-9520-7120-bc17-556e9a92d860";
const remoteThread = "019ccb31-9520-7120-bc17-556e9a92d861";
const remoteHost = "ssh:252";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererBindingProbe } from "./packages/renderer-extension/src/renderer-binding-probe.ts";

      installRendererBindingProbe({ enabledAgents: ["codex"], defaultAgent: "codex" });

      globalThis.selections = [];
      const modelMenu = (trigger) => {
        const props = {
          model: "gpt-a",
          reasoningEffort: "high",
          modelOptions: [
            { model: { model: "gpt-a", displayName: "GPT Alpha" } },
            { model: { model: "deepseek-b", displayName: "DeepSeek Beta" } },
          ],
          onSelectModel: (id) => {
            globalThis.selections.push({ trigger: trigger.dataset.thread, model: id });
            props.model = id;
            trigger.textContent = id;
          },
          onSelectReasoningEffort: () => {},
        };
        const fiber = { memoizedProps: props, return: null };
        const root = { child: fiber, stateNode: { current: null } };
        fiber.return = root;
        root.stateNode.current = root;
        Reflect.set(trigger, "__reactFiber$fixture", fiber);
      };

      // 每个 Composer 都带自己的 Host 身份；文档级路由在两个 Host 之间无法
      // 唯一确定，但每个 Composer 的归属是确定的。
      const routes = {
        "${localThread}": "local",
        "${remoteThread}": "${remoteHost}",
      };
      globalThis.hostOverrides = {};
      const hostIdFor = (composer) => {
        const portal = composer?.querySelector?.("[data-above-composer-conversation-id]");
        const threadId = portal?.getAttribute("data-above-composer-conversation-id");
        return globalThis.hostOverrides[threadId] ?? routes[threadId] ?? null;
      };
      window.__codexhostHostRoutingV1 = {
        knownHostIds: () => ["local", "${remoteHost}"],
        hostIdForComposer: hostIdFor,
        forHost: () => null,
        forComposer: () => null,
      };
      globalThis.selections = [];
      for (const trigger of document.querySelectorAll(".model-trigger")) modelMenu(trigger);

      const unavailable = async () => {
        throw new Error("unused fixture capability");
      };
      const clients = {};
      for (const hostId of ["local", "${remoteHost}", "ssh:other"]) {
        clients[hostId] = {
          currentHostId: () => hostId,
          clientForHost: (requested) => (requested === hostId ? clients[hostId] : null),
          // 固定模型选择会先关闭自动路由，再调用原生菜单回调。测试借此
          // 在真实请求进行中改变 Composer 归属。
          buddyStatus: async () => {
            if (globalThis.deferStatus) {
              await new Promise((resolve) => Reflect.set(globalThis, "finishStatus", resolve));
            }
            return { settings: { enabled: true } };
          },
          buddyConfigure: async (settings) => ({ settings: { ...settings, enabled: false } }),
          // 归属是已持久化的事实：这两个 Composer 都由 Codex 拥有。
          inspectThread: async () => ({ owner: "codex", locked: true }),
          listThreadOwnership: async ({ threadIds }) => ({
            threads: threadIds.map((threadId) => ({ threadId, owner: "codex" })),
          }),
          inspectThreadCommands: async () => ({ commands: [] }),
          inspectThreadUsage: async () => ({ usage: null, accountCredits: null }),
          inspectHarness: unavailable,
          forkThread: unavailable,
          selectThreadModel: unavailable,
          selectThreadThinking: unavailable,
          selectThreadPermissionMode: unavailable,
          checkUpdate: unavailable,
          startUpdate: unavailable,
          readUpdateStatus: unavailable,
        };
      }
      const modelControl = {
        currentHostId: (composer) => hostIdFor(composer),
        clientForHost: (hostId) => clients[hostId] ?? null,
      };
      const binding = window.__codexhostRendererBindingProbeV1;
      binding.setAdapter(
        { state: "ready", reason: "fixture", modelUpdates: 0, hook: "request-bridge" },
        undefined,
        undefined,
        modelControl,
      );
    `,
    resolveDir: repositoryRoot,
    sourcefile: "renderer-model-shortcut-host-scope-e2e-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  write: false,
});
const bundle = outputFiles[0]?.text;
if (typeof bundle !== "string") throw new Error("Shortcut Host scope bundle was not generated");

const composer = (threadId: string) => `
  <section data-app-shell-main-surface="default">
    <div data-codex-composer-root style="margin:12px 0;padding:10px;border:1px solid #444">
      <div data-above-composer-portal data-above-composer-conversation-id="${threadId}"></div>
      <div data-codex-composer contenteditable="true" role="textbox" aria-label="Message">draft</div>
      <button class="model-trigger" aria-haspopup="menu" data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" data-thread="${threadId}">gpt-a</button>
      <button type="submit">Send</button>
    </div>
  </section>`;

test("favorite chips select while another Host's Composer is also mounted", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://shortcut-scope.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body>${composer(localThread)}${composer(remoteThread)}</body>`,
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("codexhost.model-favorites.v1:codex", '["deepseek-b"]'),
  );
  await page.goto("http://shortcut-scope.test/");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => new Promise<void>((resolve) => queueMicrotask(resolve)));

  const chip = page.locator('[data-model-shortcut="deepseek-b"]').first();
  await expect(chip).toBeEnabled();
  await chip.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "selections")))
    .toEqual([{ trigger: localThread, model: "deepseek-b" }]);
  // 旧实现会在这里报 "The active conversation changed; select the Model again"。
  await expect(
    page.locator("[data-codexhost-model-shortcuts] [role=status]:visible"),
  ).toContainText("Selected deepseek-b");
  expect(errors).toEqual([]);
});

test("a selection is discarded when its Composer moves to another Host mid-flight", async ({
  page,
}) => {
  await page.route("http://shortcut-scope.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body>${composer(localThread)}</body>`,
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("codexhost.model-favorites.v1:codex", '["deepseek-b"]'),
  );
  await page.goto("http://shortcut-scope.test/");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => new Promise<void>((resolve) => queueMicrotask(resolve)));

  const chip = page.locator('[data-model-shortcut="deepseek-b"]').first();
  await expect(chip).toBeEnabled();
  await page.evaluate(() => Reflect.set(globalThis, "deferStatus", true));
  await chip.click();
  // 选择进行中，这个 Composer 换到了另一个 Host；旧目标不能再被应用。
  await page.evaluate((threadId) => {
    Reflect.set(globalThis, "hostOverrides", { [threadId]: "ssh:other" });
    Reflect.get(globalThis, "finishStatus")();
  }, localThread);
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "selections"))).toEqual([]);
});
