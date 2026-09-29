import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const threadId = "019ccb31-9520-7120-bc17-556e9a92d860";
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { installRendererBindingProbe } from './packages/renderer-extension/src/renderer-binding-probe.ts';
      import { createRendererModelClient } from './packages/renderer-extension/src/renderer-model-client.ts';
      const threadId = '${threadId}';
      const hostId = 'ssh:252';
      window.__codexhostHostRoutingV1 = { forComposer: () => ({ hostId, policy: { state: 'ready', hostId, select: async () => {}, clear: async () => {} } }) };
      const unused = async () => { throw new Error('unused fixture capability'); };
      globalThis.routeReads = [];
      const routeClient = createRendererModelClient([{ sendRequest: async (method) => {
        throw { code: -32600, message: 'Invalid request: unknown variant ' + String.fromCharCode(96) + method + String.fromCharCode(96) };
      } }]);
      const trigger = document.querySelector('#native-model');
      const props = { model: 'auto', modelOptions: [{model: {model: 'auto', displayName: 'Auto'}}], onSelectModel: () => {} };
      const fiber = { memoizedProps: props };
      const root = { child: fiber, stateNode: {} };
      root.stateNode.current = root;
      fiber.return = root;
      trigger.__reactFiber$fixture = fiber;
      const client = {
        currentHostId: () => hostId,
        clientForHost: (requested) => requested === hostId ? client : null,
        inspectThread: async () => ({ owner: 'codex', locked: true }),
        listThreadOwnership: async ({ threadIds }) => ({ threads: threadIds.map(threadId => ({ threadId, owner: 'codex' })) }),
        inspectThreadCommands: async () => ({ commands: [] }),
        inspectThreadUsage: async () => ({ threadId, usage: null, accountCredits: null }),
        inspectHarness: unused, forkThread: unused,
        selectThreadModel: unused, selectThreadThinking: unused, selectThreadPermissionMode: unused,
        checkUpdate: unused, startUpdate: unused, readUpdateStatus: unused,
        readAutoModelRoutes: async (id, runId) => {
          globalThis.routeReads.push({ hostId, threadId: id, ...(runId ? { runId } : {}) });
          if (globalThis.unsupportedHost) return routeClient.readAutoModelRoutes(id);
          return { supported: true, routes: [{
            request_id: '019ccb31-9520-7120-bc17-556e9a92d861', session_id: threadId,
            turn_id: 'turn-1', requested_model: 'auto', selected_model: 'first', resolved_model: 'gpt-5.6',
            attempted_models: ['first', 'gpt-5.6'], state: 'completed', started_at: 1, updated_at: 2,
          }] };
        },
      };
      const binding = installRendererBindingProbe({ enabledAgents: ['codex'], defaultAgent: 'codex' });
      binding.setAdapter({ state: 'ready', reason: 'fixture', modelUpdates: 0, hook: 'request-bridge' }, undefined, undefined, client);
    `,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2024",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  write: false,
});
const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Auto route binding fixture did not build");

for (const unsupportedHost of [false, true])
  test(`native Composer binding ${unsupportedHost ? "explains missing SSH route support" : "mounts the SSH route card without Buddy planning"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://auto-route.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body><main data-app-shell-main-surface="default" style="max-width:720px;margin:30px auto">
      <div data-turn-key="history-content:turn:turn-1"><div data-content-search-turn-key="turn-1" style="display:contents">
        <div data-response-annotation-conversation="${threadId}" style="display:flex;flex-direction:column"><p>Native reply</p></div>
      </div></div>
      <div data-codex-composer-root style="border:1px solid #ccc;padding:12px;margin-top:40px">
        <div data-above-composer-portal data-above-composer-conversation-id="${threadId}"></div>
        <div data-codex-composer contenteditable="true" role="textbox" aria-label="Message">Next message</div>
        <button id="native-model" aria-haspopup="menu" data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning">Auto</button>
        <button type="submit">Send</button>
      </div></main></body>`,
      }),
    );
    await page.goto("http://auto-route.test/");
    await page.evaluate(
      (value) => Reflect.set(globalThis, "unsupportedHost", value),
      unsupportedHost,
    );
    await page.addScriptTag({ content: bundle });
    const card = page.getByRole("complementary", { name: "Auto routed" });
    if (unsupportedHost) {
      const status = page.getByRole("status", { name: "Auto routing" });
      await expect(status).toBeVisible();
      await expect(status).toContainText("This connection does not provide Auto routing records");
      await expect(card).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath("ssh-auto-unsupported.png") });
    } else {
      await expect(card).toBeVisible();
      await expect(card).toContainText("gpt-5.6");
      await page.screenshot({ path: test.info().outputPath("ssh-auto-turn-card.png") });
    }
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, "routeReads")))
      .toEqual([
        { hostId: "ssh:252", threadId },
        ...(unsupportedHost ? [] : [{ hostId: "ssh:252", threadId, runId: "turn-1" }]),
      ]);
    await expect(page.getByRole("textbox")).toHaveText("Next message");
    expect(errors).toEqual([]);
  });
