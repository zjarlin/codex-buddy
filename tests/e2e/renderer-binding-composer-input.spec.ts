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
      binding.setAdapter(
        { state: "ready", reason: "ready", modelUpdates: 0, hook: "model-state" },
        undefined,
        () => false,
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
  await page.addScriptTag({ content: browserBundle });
  await expect(page.locator("[data-codexhost-agent-control]")).toHaveCount(1);
}

const unboundEditing = {
  digit: { accepted: true, prevented: false },
  digitBeforeInput: { accepted: true, prevented: false },
  backspace: { accepted: true, prevented: false },
  enter: { accepted: false, prevented: true },
};

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
