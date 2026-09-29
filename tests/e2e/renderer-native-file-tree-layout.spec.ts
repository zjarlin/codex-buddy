import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// 结构与尺寸回调来自 Desktop 26.924.22138 的官方文件树侧栏；不模拟文件服务。
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installNativeFileTreeLayout } from "./packages/renderer-extension/src/renderer-native-file-tree-layout.ts";
      const content = document.querySelector("#content");
      const row = document.querySelector("#workspace");
      const calls = [];
      let pane, separator, resizeFiber;
      const mount = (type = "workspace") => {
        pane?.remove();
        pane = document.createElement("aside");
        pane.id = "native-tree";
        pane.className = "relative flex h-full shrink-0 border-l border-default";
        pane.style.cssText = "width:240px;max-width:60%";
        const handle = document.createElement("div");
        handle.className = "native-resizer";
        separator = document.createElement("div");
        separator.setAttribute("role", "separator");
        separator.setAttribute("aria-orientation", "vertical");
        handle.append(separator);
        const heading = document.createElement("h3");
        heading.textContent = type === "changed-files" ? "更改的文件" : "文件";
        const file = document.createElement("button");
        file.textContent = "src/app.ts";
        file.onclick = () => { content.textContent = "export const app = true;"; calls.push("open-file"); };
        pane.append(handle, heading, file);
        row.append(pane);
        let width = 240;
        const resize = {
          edge: "left", defaultSize: 240,
          getCurrentSize: () => width,
          setSize: (size) => {
            calls.push(size);
            if (size < 100) { pane.remove(); return; }
            width = Math.min(Math.max(size, 200), row.getBoundingClientRect().width * .6);
            pane.style.width = width + "px";
          }
        };
        const treeFiber = { memoizedProps: type === "workspace"
          ? { type, roots: ["/repo"], hostId: "ssh:server", onSelectFile: file.onclick }
          : { type }, return: null };
        const paneFiber = { stateNode: pane, return: treeFiber };
        resizeFiber = { memoizedProps: resize, return: paneFiber };
        separator.__reactFiber$fixture = { stateNode: separator, return: resizeFiber };
        separator.addEventListener("pointerdown", () => calls.push("original-left-drag"));
        separator.addEventListener("click", (event) => {
          if (event.detail === 2) resize.setSize(resize.defaultSize);
        });
      };
      const control = installNativeFileTreeLayout(document);
      mount();
      globalThis.treeFixture = {
        calls, mount,
        dispose: control.dispose,
        references: () => ({ pane, separator, parent: pane.parentElement }),
        replaceResize: () => {
          resizeFiber.memoizedProps = {
            ...resizeFiber.memoizedProps,
            setSize: (size) => { calls.push("current-binding"); pane.style.width = size + "px"; }
          };
        }
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  write: false,
});
const source = outputFiles[0]?.text ?? "";
if (!source) throw new Error("Missing native file tree layout test bundle");

async function setup(page: Page) {
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing:border-box; }
    body { margin:0; padding:24px; color:#202020; font:14px system-ui; }
    #workspace { display:flex; height:480px; width:100%; background:#fafafa; border:1px solid #ccc; }
    #content { flex:1; min-width:0; padding:24px; }
    #native-tree { position:relative; flex:none; border-left:1px solid #ccc; }
    #native-tree h3 { padding:0 16px; }
    #native-tree button { width:100%; text-align:left; padding:8px 16px; background:transparent; border:0; }
    .native-resizer { position:absolute; top:0; bottom:0; left:0; width:16px; translate:-50% 0; }
    .native-resizer [role=separator] { position:absolute; inset:0; cursor:col-resize; }
    #unrelated { display:flex; }
  </style></head><body>
    <h2>官方文件面板布局夹具</h2>
    <div id="workspace"><main id="content">选择文件</main></div>
    <div id="unrelated"><div role="separator" aria-orientation="vertical"></div></div>
  </body></html>`);
  await page.addScriptTag({ content: source });
  await expect(page.locator("#native-tree")).toHaveAttribute(
    "data-codexhost-native-file-tree-left",
    "v1",
  );
}

async function dragBy(page: Page, delta: number) {
  const box = await page.locator("#native-tree [role=separator]").boundingBox();
  if (!box) throw new Error("Missing native file tree separator");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 4 });
  await page.mouse.up();
}

test("places the existing official tree before file contents and preserves file opening", async ({
  page,
}, testInfo) => {
  await setup(page);
  const before = await page.evaluateHandle(() =>
    Reflect.get(globalThis, "treeFixture").references(),
  );
  const tree = await page.locator("#native-tree").boundingBox();
  const content = await page.locator("#content").boundingBox();
  if (!tree || !content) throw new Error("Missing file tree or contents");
  expect(tree.x + tree.width).toBeLessThanOrEqual(content.x);
  await page.getByRole("button", { name: "src/app.ts" }).click();
  await expect(page.locator("#content")).toHaveText("export const app = true;");
  expect(
    await page.evaluate((previous) => {
      const current = Reflect.get(globalThis, "treeFixture").references();
      return previous.pane === current.pane && previous.parent === current.parent;
    }, before),
  ).toBe(true);
  await expect(page.locator("#unrelated [role=separator]")).not.toHaveAttribute(
    "data-codexhost-native-file-tree-resizer",
  );
  await page.screenshot({ path: testInfo.outputPath("native-tree-left.png") });
});

test("resizes from the right edge through current official callbacks, including zoom and reset", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#workspace").evaluate((element) => {
    element.style.zoom = "0.8";
  });
  await dragBy(page, 64);
  await expect(page.locator("#native-tree")).toHaveCSS("width", "320px");
  await page.locator("#native-tree [role=separator]").dblclick();
  await expect(page.locator("#native-tree")).toHaveCSS("width", "240px");
  await page.evaluate(() => Reflect.get(globalThis, "treeFixture").replaceResize());
  await dragBy(page, 32);
  await expect(page.locator("#native-tree")).toHaveCSS("width", "280px");
  const calls = await page.evaluate(() => Reflect.get(globalThis, "treeFixture").calls);
  expect(calls).toContain("current-binding");
  expect(calls).not.toContain("original-left-drag");
});

test("handles collapse, remounts and review trees and restores native layout on disposal", async ({
  page,
}) => {
  await setup(page);
  await dragBy(page, -180);
  await expect(page.locator("#native-tree")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "treeFixture").mount("changed-files"));
  await expect(page.locator("#native-tree")).toHaveAttribute(
    "data-codexhost-native-file-tree-left",
    "v1",
  );
  await page.evaluate(() => Reflect.get(globalThis, "treeFixture").dispose());
  await expect(page.locator("#native-tree")).not.toHaveAttribute(
    "data-codexhost-native-file-tree-left",
  );
  const tree = await page.locator("#native-tree").boundingBox();
  const content = await page.locator("#content").boundingBox();
  if (!tree || !content) throw new Error("Missing file tree or contents");
  expect(content.x + content.width).toBeLessThanOrEqual(tree.x);
});

test("ignores unsupported bindings and releases an active drag on disposal", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => Reflect.get(globalThis, "treeFixture").mount("terminal"));
  await expect(page.locator("#native-tree")).not.toHaveAttribute(
    "data-codexhost-native-file-tree-left",
  );
  await page.evaluate(() => Reflect.get(globalThis, "treeFixture").mount());
  await expect(page.locator("#native-tree")).toHaveAttribute(
    "data-codexhost-native-file-tree-left",
    "v1",
  );
  const box = await page.locator("#native-tree [role=separator]").boundingBox();
  if (!box) throw new Error("Missing native file tree separator");
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.evaluate(() => Reflect.get(globalThis, "treeFixture").dispose());
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.up();
  expect(await page.evaluate(() => Reflect.get(globalThis, "treeFixture").calls)).toEqual([]);
});
