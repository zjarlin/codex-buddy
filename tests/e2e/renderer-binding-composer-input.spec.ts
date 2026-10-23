import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

await build({
  entryPoints: [path.join(repositoryRoot, "packages/shared-contracts/src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2024",
  outfile: path.join(repositoryRoot, "packages/shared-contracts/dist/index.js"),
});

// 没有 Host 路由策略时 Carrier 绑定失败；这是数字键/退格被整键吞掉的现场。
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererBindingProbe } from "./packages/renderer-extension/src/renderer-binding-probe.ts";
      const binding = installRendererBindingProbe({ enabledAgents: ["codex", "pi"], defaultAgent: "codex" });
      // 测试注入的 Host 客户端与 Carrier 结果是按调用时读取的，因此失败绑定与
      // 可用绑定可以共用同一份 bundle。
      const control = {
        clientForHost: (hostId) =>
          hostId === "local" ? (Reflect.get(globalThis, "__codexhostE2EHostClient") ?? null) : null,
        currentHostId: () => "local",
        subscribeThreadUsage: () => () => undefined,
      };
      binding.setAdapter(
        { state: "ready", reason: "ready", modelUpdates: 0, hook: "model-state" },
        undefined,
        () => Reflect.get(globalThis, "__codexhostE2EApplyAgent") === true,
        control,
      );
    `,
    resolveDir: repositoryRoot,
    sourcefile: "renderer-binding-composer-input-e2e-entry.ts",
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

const browserBundle: string = outputFiles[0]?.text ?? "";
if (!browserBundle) throw new Error("Composer input E2E bundle was not generated");

test.beforeEach(async ({ page }) => {
  await page.route("https://codexhost.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
  );
  await page.goto("https://codexhost.test/");
});

async function installComposer(page: Page): Promise<void> {
  await page.setContent(`
    <!doctype html>
    <body>
      <form data-codex-composer-root>
        <div data-codex-composer contenteditable="true" role="textbox">draft</div>
        <button type="submit" aria-label="Send">Send</button>
      </form>
    </body>
  `);
  await page.evaluate(() => {
    const client = {
      clientForHost: () => client,
      currentHostId: () => "local",
      inspectHarness: async (params: { harnessId: string }) =>
        params.harnessId === "pi"
          ? {
              status: "ready",
              catalog: {
                models: [{ ref: { id: "pi-test" }, label: "Pi" }],
                thinkingOptions: [],
              },
              capabilities: {
                configuration: {
                  selectModel: true,
                  selectThinkingOption: false,
                  selectPermissionMode: false,
                  permissionModeScope: "live",
                },
                history: { fork: false, rollbackLastTurn: false },
              },
            }
          : {
              status: "notInstalled",
              error: {
                code: "notInstalled",
                message: "Harness is not installed",
                retryable: false,
              },
            },
      inspectHarnessCommands: async () => ({ commands: [], source: "static" }),
      inspectThreadCommands: async () => ({ commands: [], source: "live" }),
      listCodexAccounts: async () => ({
        version: 2,
        currentAccountId: null,
        phase: "unavailable",
        revision: 0,
        accounts: [],
      }),
      modelAvailability: async () => ({ state: "unknown" }),
      subscribeThreadUsage: () => () => undefined,
      subscribeCodexAccounts: () => () => undefined,
    };
    Reflect.set(window, "__codexhostE2EHostClient", client);
    Reflect.set(window, "__codexhostE2EApplyAgent", false);
  });
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator("[data-codexhost-agent-control]")).toHaveCount(1);
}

const unboundEditing = {
  digit: { accepted: true, prevented: false },
  digitBeforeInput: { accepted: true, prevented: false },
  backspace: { accepted: true, prevented: false },
  enter: { accepted: false, prevented: true },
};

test("an Agent switch in progress still lets digits and Backspace edit the Composer", async ({
  page,
}) => {
  await installComposer(page);
  await page.evaluate(() => {
    let resolveClear: (() => void) | undefined;
    window.__codexhostHostRoutingV1 = {
      forComposer: () => ({
        hostId: "local",
        policy: {
          state: "ready",
          hostId: "local",
          select: async () => undefined,
          clear: () => new Promise<void>((resolve) => (resolveClear = resolve)),
        },
      }),
    } as unknown as NonNullable<typeof window.__codexhostHostRoutingV1>;
    Reflect.set(window, "__codexhostE2EApplyAgent", true);
    Reflect.set(window, "__releaseAgentSwitch", () => resolveClear?.());
  });
  await page.locator('[data-codexhost-agent-control] > button[aria-haspopup="menu"]').click();
  const menuId = await page
    .locator('[data-codexhost-agent-control] > button[aria-haspopup="menu"]')
    .getAttribute("aria-controls");
  if (!menuId) throw new Error("Agent menu id is unavailable");
  const pi = page.locator(`#${menuId} button[data-agent="pi"]`);
  await expect(pi).toBeEnabled();
  await pi.click();
  const trigger = page.locator('[data-codexhost-agent-control] > button[aria-haspopup="menu"]');
  await expect(trigger).toHaveAttribute("aria-busy", "true");

  const results = await page.locator('[role="textbox"]').evaluate((editor) => {
    const dispatch = (event: Event) => {
      const accepted = editor.dispatchEvent(event);
      return { accepted, prevented: event.defaultPrevented };
    };
    return {
      digit: dispatch(new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true })),
      digitBeforeInput: dispatch(
        new InputEvent("beforeinput", { inputType: "insertText", bubbles: true, cancelable: true }),
      ),
      backspace: dispatch(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
      ),
      enter: dispatch(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    };
  });
  expect(results).toEqual(unboundEditing);
  await page.evaluate(() => Reflect.get(window, "__releaseAgentSwitch")());
  await expect(trigger).toHaveAttribute("aria-busy", "false");
  expect(results).toEqual(unboundEditing);
});

test("an unbound Carrier still lets digits and Backspace edit the Composer", async ({ page }) => {
  await installComposer(page);
  const results = await page.locator('[role="textbox"]').evaluate((editor) => {
    const dispatch = (event: Event) => {
      const accepted = editor.dispatchEvent(event);
      return { accepted, prevented: event.defaultPrevented };
    };
    return {
      digit: dispatch(new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true })),
      digitBeforeInput: dispatch(
        new InputEvent("beforeinput", { inputType: "insertText", bubbles: true, cancelable: true }),
      ),
      backspace: dispatch(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
      ),
      // 提交仍被拦截：无法绑定 Carrier 时不能发送。
      enter: dispatch(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    };
  });
  expect(results).toEqual(unboundEditing);
});
