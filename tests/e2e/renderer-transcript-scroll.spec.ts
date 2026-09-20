import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installTranscriptAutoScroll } from "./packages/renderer-extension/src/renderer-transcript-scroll.ts";
      globalThis.install = () => { globalThis.disposeScroll?.(); globalThis.disposeScroll = installTranscriptAutoScroll(document); };
      globalThis.grow = () => {
        const answer = document.querySelector("#answer");
        answer.textContent += "More streamed answer text.\\n".repeat(12);
      };
      globalThis.install();
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
if (!bundle) throw new Error("Transcript scroll fixture did not build");

for (const reverse of [false, true]) {
  test(`follows streamed output and resized content, respecting manual reading (${reverse ? "reverse" : "normal"})`, async ({
    page,
  }) => {
    await page.setContent(`<!doctype html><style>
      [data-app-action-timeline-scroll]{height:240px;width:600px;overflow-y:auto;overflow-anchor:none;display:flex;flex-direction:${reverse ? "column-reverse" : "column"}}
      #content{flex:none} #answer{white-space:pre-wrap;font:14px/20px monospace;margin:0}
      #tool{height:50px;overflow-y:auto} #tool pre{height:400px}
    </style><div data-app-action-timeline-scroll tabindex="0">
      <div id="content"><div data-thread-find-target="conversation"><div data-turn-key="turn"><pre id="answer">Start</pre><div id="image"></div></div></div>
      <div id="tool"><pre>Tool output</pre></div><div data-codexhost-agent-control="composer"></div></div></div>`);
    await page.addScriptTag({ content: bundle });
    const scroller = page.locator("[data-app-action-timeline-scroll]");
    const gap = () =>
      scroller.evaluate(
        (node, reverse) =>
          reverse
            ? Math.abs(node.scrollTop)
            : node.scrollHeight - node.clientHeight - node.scrollTop,
        reverse,
      );
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => Reflect.get(globalThis, "grow")());
      await expect.poll(gap).toBeLessThanOrEqual(1);
    }
    await page.locator("#image").evaluate((node) => {
      (node as HTMLElement).style.height = "180px";
    });
    await expect.poll(gap).toBeLessThanOrEqual(1);

    // 内嵌工具面板自己滚动时不改变消息区的自动跟随。
    await page.locator("#tool").evaluate((node) => {
      node.scrollTop = 100;
    });
    await page.locator("#tool").dispatchEvent("wheel", { deltaY: -20 });
    await page.evaluate(() => Reflect.get(globalThis, "grow")());
    await expect.poll(gap).toBeLessThanOrEqual(1);

    await scroller.hover();
    await page.mouse.wheel(0, -260);
    await expect.poll(gap).toBeGreaterThan(100);
    const previousTop = await scroller.evaluate((node) => node.scrollTop);
    await page.evaluate(() => Reflect.get(globalThis, "grow")());
    // 等待两帧，覆盖待执行的 MutationObserver/ResizeObserver 回调。
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      Math.abs((await scroller.evaluate((node) => node.scrollTop)) - previousTop),
    ).toBeLessThan(2);

    await scroller.evaluate((node, reverse) => {
      node.scrollTop = reverse ? 0 : node.scrollHeight;
    }, reverse);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    await page.evaluate(() => Reflect.get(globalThis, "grow")());
    await expect.poll(gap).toBeLessThanOrEqual(1);

    await scroller.hover();
    await page.mouse.wheel(0, -260);
    await expect.poll(gap).toBeGreaterThan(100);
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("codexhost:renderer-submission", { detail: { composerId: "composer" } }),
      ),
    );
    await expect.poll(gap).toBeLessThanOrEqual(1);

    // 卸载后不再抢占滚动；重新挂载可继续跟随新输出。
    await page.evaluate(() => Reflect.get(globalThis, "disposeScroll")());
    await scroller.evaluate((node, reverse) => {
      node.scrollTop = reverse ? -150 : node.scrollHeight - node.clientHeight - 150;
    }, reverse);
    await page.evaluate(() => Reflect.get(globalThis, "grow")());
    await expect.poll(gap).toBeGreaterThan(100);
    await scroller.evaluate((node, reverse) => {
      node.scrollTop = reverse ? 0 : node.scrollHeight;
    }, reverse);
    await page.evaluate(() => Reflect.get(globalThis, "install")());
    await page.evaluate(() => Reflect.get(globalThis, "grow")());
    await expect.poll(gap).toBeLessThanOrEqual(1);
  });
}

test("a replacement conversation gets its own scroll state", async ({ page }) => {
  await page.setContent('<div id="host"></div>');
  await page.addScriptTag({ content: bundle });
  const addThread = () =>
    page.locator("#host").evaluate((host) => {
      host.innerHTML =
        '<div data-app-action-timeline-scroll style="height:200px;overflow:auto"><div><pre id="answer" style="white-space:pre-wrap;line-height:20px">New conversation</pre></div></div>';
    });
  await addThread();
  await expect
    .poll(() => page.evaluate(() => document.querySelector("#answer")?.textContent))
    .toBe("New conversation");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => Reflect.get(globalThis, "grow")());
  const gap = () =>
    page
      .locator("[data-app-action-timeline-scroll]")
      .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  await expect.poll(gap).toBeLessThanOrEqual(1);
  await addThread();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => Reflect.get(globalThis, "grow")());
  await expect.poll(gap).toBeLessThanOrEqual(1);
});
