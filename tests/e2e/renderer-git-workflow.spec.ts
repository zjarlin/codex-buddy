import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const bundle = await build({
  stdin: {
    contents: `
    import { installRendererGitWorkflowControl } from "./packages/renderer-extension/src/renderer-git-workflow-control.ts";
    const composer = document.querySelector("#composer");
    const idle = { workspace: "/repo", phase: "idle", threadId: null, turnId: null, message: "全部任务结束后自动推送" };
    const fixture = globalThis.workflowFixture = { calls: [], states: new Map(), resolvers: new Map() };
    const client = {
      inspectGitWorkflow: async ({threadId}) => fixture.states.get(threadId) ?? { ...idle, workspace: "/" + threadId },
      runGitWorkflow: ({threadId}) => {
        fixture.calls.push(threadId);
        return new Promise((resolve, reject) => {
          fixture.resolvers.set(threadId, (phase = "running") => {
            const value = { ...idle, workspace: "/" + threadId, threadId, phase, message: phase === "failed" ? "推送失败，可重试" : "推送工作流运行中…" };
            fixture.states.set(threadId, value);
            resolve(value);
          });
        });
      },
    };
    let context = { anchor: composer, threadId: "a", client };
    const control = installRendererGitWorkflowControl(() => context);
    fixture.switch = (threadId) => { context = threadId ? { anchor: composer, threadId, client } : null; control.refreshContext(); };
    fixture.dispose = () => control.dispose();
  `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});

test("runs from the active composer, keeps loading across task switches and allows retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(
    '<main style="width:600px;margin:60px"><div id="composer" contenteditable="true">草稿保留</div></main>',
  );
  const output = bundle.outputFiles[0];
  if (!output) throw new Error("工作流按钮测试缺少构建产物");
  await page.addScriptTag({ content: output.text });
  const root = page.locator("[data-codexhost-git-workflow]");
  const button = root.getByRole("button", { name: "推送代码" });
  await expect(button).toBeEnabled();
  expect(await root.evaluate((element) => element.nextElementSibling?.id)).toBe("composer");
  await button.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "workflowFixture").switch("b"));
  await expect(button).toBeEnabled();
  await page.evaluate(() => Reflect.get(globalThis, "workflowFixture").switch("a"));
  await expect(button).toBeDisabled();
  expect(await page.evaluate(() => Reflect.get(globalThis, "workflowFixture").calls)).toEqual([
    "a",
  ]);
  await page.evaluate(() =>
    Reflect.get(globalThis, "workflowFixture").resolvers.get("a")("failed"),
  );
  await expect(root.getByRole("status")).toHaveText("推送失败，可重试");
  await expect(button).toBeEnabled();
  await button.click();
  await page.evaluate(() => Reflect.get(globalThis, "workflowFixture").resolvers.get("a")());
  await expect(button).toBeDisabled();
  await expect(root.getByRole("status")).toHaveText("推送工作流运行中…");
  await expect(page.locator("#composer")).toHaveText("草稿保留");
  await page.evaluate(() => {
    const f = Reflect.get(globalThis, "workflowFixture");
    f.states.set("a", {
      workspace: "/a",
      phase: "completed",
      threadId: "a",
      turnId: "done",
      message: "推送工作流已完成",
    });
  });
  await expect(button).toBeEnabled();
  await expect(root.getByRole("status")).toHaveText("推送工作流已完成");
  await page.evaluate(() => Reflect.get(globalThis, "workflowFixture").switch(null));
  await expect(root).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.evaluate(() => Reflect.get(globalThis, "workflowFixture").dispose());
});
