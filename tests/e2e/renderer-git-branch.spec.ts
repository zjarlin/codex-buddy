import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const bundle = await build({
  stdin: {
    contents: `
      import { installRendererGitBranchControl } from "./packages/renderer-extension/src/renderer-git-branch-control.ts";
      import { RendererGitCache } from "./packages/renderer-extension/src/renderer-git-cache.ts";
      const cache = new RendererGitCache();
      const fixture = globalThis.branchFixture = { calls: [], pending: [], branch: "main" };
      const snapshot = (branch) => ({
        workspace: "/repo", branch, detached: false, head: "abc123456789",
        upstream: null, ahead: 0, behind: 0, changes: [], submodules: [],
        operation: null, conflicts: [],
      });
      const client = {
        inspectGitStatus: (input) => {
          fixture.calls.push(input);
          if (input.threadId.startsWith("slow")) {
            return new Promise(resolve => fixture.pending.push(() => resolve(snapshot("old-branch"))));
          }
          if (input.threadId === "unavailable") return Promise.reject(new Error("not a git repository"));
          if (input.threadId === "detached") return Promise.resolve({ ...snapshot(null), detached: true });
          return Promise.resolve(snapshot(input.repository ? "linked-branch" : fixture.branch));
        },
      };
      const remoteClient = {
        inspectGitStatus: async (input) => {
          fixture.calls.push({ ...input, host: "remote" });
          return { ...snapshot("remote-branch"), workspace: "/remote/repo" };
        },
      };
      let context = {
        anchor: document.querySelector("#composer"), threadId: "main", hostId: "local", client,
      };
      const control = installRendererGitBranchControl({
        cache, getContext: () => context, getLocale: () => "zh-CN",
      });
      document.querySelectorAll("[data-thread]").forEach(button => {
        button.addEventListener("click", () => {
          context = button.dataset.thread ? {
            anchor: document.querySelector("#composer"),
            threadId: button.dataset.thread,
            hostId: button.dataset.host || "local",
            client: button.dataset.host ? remoteClient : client,
          } : null;
          control.refreshContext();
        });
      });
      document.querySelector("#resolve").onclick = () => fixture.pending.splice(0).forEach(resolve => resolve());
      document.querySelector("#switch-branch").onclick = () => { fixture.branch = "feature/updated"; };
      document.querySelector("#linked").onclick = () => cache.status(client, context, "/linked");
      document.querySelector("#sidebar").onclick = () => cache.status(client, context);
      document.querySelector("#replace").onclick = () => {
        const replacement = document.querySelector("#composer").cloneNode(true);
        document.querySelector("#composer").replaceWith(replacement);
        context = { ...context, anchor: replacement };
        control.refreshContext();
      };
      document.querySelector("#dispose").onclick = () => control.dispose();
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  loader: { ".svg": "dataurl" },
  write: false,
});

async function setup(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`
    <style>
      body { background:#171717; color:#ddd; font:13px system-ui; margin:28px; }
      nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:36px; }
      button { color:inherit; background:#303030; border:1px solid #555; border-radius:5px; padding:6px; }
      main { max-width:480px; }
      #composer { min-height:70px; border:1px solid #555; border-radius:12px; padding:12px; }
    </style>
    <nav aria-label="测试操作">
      <button data-thread="main">本地会话</button>
      <button data-thread="slow">慢请求会话</button>
      <button data-thread="slow-dispose">退出前请求</button>
      <button data-thread="slow" data-host="remote">远程会话</button>
      <button data-thread="detached">Detached HEAD</button>
      <button data-thread="unavailable">非 Git 项目</button>
      <button data-thread="">新建对话</button>
      <button id="resolve">完成旧请求</button>
      <button id="switch-branch">外部切换分支</button>
      <button id="linked">选择关联仓库</button>
      <button id="sidebar">侧栏读取</button>
      <button id="replace">重建输入框</button>
      <button id="dispose">卸载</button>
    </nav>
    <main><p>当前会话</p><div id="composer" contenteditable="true" role="textbox">保留输入草稿</div></main>
  `);
  const output = bundle.outputFiles[0];
  if (!output) throw new Error("分支展示测试缺少构建产物");
  await page.addScriptTag({ content: output.text });
  await expect(page.getByRole("status")).toHaveText("main");
  return errors;
}

test("shows the conversation branch, detached commit and errors without changing the draft", async ({
  page,
}, testInfo) => {
  const errors = await setup(page);
  const root = page.locator("[data-codexhost-git-branch]");
  const status = page.getByRole("status");
  await expect(status).toHaveAttribute("title", "/repo\nGit 分支: main");
  expect(await root.evaluate((element) => element.nextElementSibling?.id)).toBe("composer");
  await page.screenshot({ path: testInfo.outputPath("conversation-branch.png") });
  await page.getByRole("button", { name: "Detached HEAD", exact: true }).click();
  await expect(status).toHaveText("HEAD · abc1234");
  await page.getByRole("button", { name: "非 Git 项目", exact: true }).click();
  await expect(status).toHaveText("Git 分支不可用");
  await expect(status).toHaveAttribute("title", "not a git repository");
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await expect(root).toHaveCount(0);
  await page.getByRole("button", { name: "本地会话", exact: true }).click();
  await expect(status).toHaveText("main");
  await page.getByRole("button", { name: "重建输入框", exact: true }).click();
  await expect(root).toHaveCount(1);
  await expect(page.getByRole("textbox")).toHaveText("保留输入草稿");
  expect(errors).toEqual([]);
});

test("ignores delayed results from another Host and never remounts after disposal", async ({
  page,
}) => {
  const errors = await setup(page);
  await page.getByRole("button", { name: "慢请求会话", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("正在读取分支…");
  await page.getByRole("button", { name: "远程会话", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("remote-branch");
  await expect(page.getByRole("status")).toHaveAttribute(
    "title",
    "/remote/repo\nGit 分支: remote-branch",
  );
  await page.getByRole("button", { name: "完成旧请求", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("remote-branch");
  await page.getByRole("button", { name: "退出前请求", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("正在读取分支…");
  await page.getByRole("button", { name: "卸载", exact: true }).click();
  await page.getByRole("button", { name: "完成旧请求", exact: true }).click();
  await expect(page.locator("[data-codexhost-git-branch]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("shares primary status reads and updates the branch without following linked repositories", async ({
  page,
}) => {
  await page.clock.install();
  const errors = await setup(page);
  await page.getByRole("button", { name: "侧栏读取", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "branchFixture").calls)).toEqual([
    { threadId: "main" },
  ]);
  await page.getByRole("button", { name: "选择关联仓库", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("main");
  await page.getByRole("button", { name: "外部切换分支", exact: true }).click();
  await page.clock.runFor(60_000);
  await expect(page.getByRole("status")).toHaveText("feature/updated");
  expect(errors).toEqual([]);
});
