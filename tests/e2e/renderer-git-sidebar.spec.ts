import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererGitSidebar, GIT_SIDEBAR_ROOT_ATTRIBUTE, GIT_SIDEBAR_FILES_ATTRIBUTE, GIT_SIDEBAR_TERMINAL_ATTRIBUTE } from "./packages/renderer-extension/src/renderer-git-sidebar.ts";
      import { hostThreadIdSchema } from "./packages/shared-contracts/src/index.ts";

      globalThis.setupGitSidebar = () => {
        document.body.innerHTML = "";
        const sidebar = document.createElement("aside");
        sidebar.id = "native-sidebar";
        sidebar.style.cssText = "position:fixed;left:0;top:0;display:grid;grid-template-columns:34px minmax(0,1fr);width:260px;height:700px";
        const content = document.createElement("div");
        content.id = "native-projects";
        const row = document.createElement("div");
        row.setAttribute("data-app-action-sidebar-thread-row", "");
        row.textContent = "boxun-app";
        content.append(row);
        sidebar.append(content);
        document.body.append(sidebar);
        for (const element of [sidebar, content, row]) element.getBoundingClientRect = () => ({ x:0,y:0,left:0,top:0,right:260,bottom:700,width:260,height:700,toJSON:()=>({}) });
        const status = {
          workspace: "/repo", branch: "main", detached: false, head: "abc123", upstream: "origin/main", ahead: 1, behind: 0,
          submodules: [{ path: "vendor/lib", status: "uninitialized" }],
          changes: [{ path: "src/app.ts", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null }],
        };
        const calls = [];
        const hostMessages = [];
        window.addEventListener("codexhost:host-message", (event) => hostMessages.push(event.detail.type));
        const client = {
          inspectGitStatus: async () => status,
          inspectGitDiff: async () => ({ path:"src/app.ts", diff:"+changed", truncated:false }),
          stageGitPaths: async () => status,
          unstageGitPaths: async () => status,
          commitGit: async () => ({ status }),
          pushGit: async () => status,
          listGitMessageModels: async () => ({ models: [], defaultModel: null }),
          generateGitMessage: async () => ({ message:"feat: x", model:"x" }),
          updateGitSubmodule: async (input) => { calls.push(input); return status; },
          inspectGitLog: async () => ({
            workspace: "/repo", branch: "main", head: "abcdef123456",
            refs: [{ name: "HEAD", kind: "head", commit: "abcdef123456", current: true }, { name: "refs/heads/main", kind: "local", commit: "abcdef123456", current: true }],
            commits: [{ commit: "abcdef123456", shortCommit: "abcdef1", subject: "feat: history", authorName: "zjarlin", authorEmail: "dev@example.com", authoredAt: "2026-09-24T12:00:00Z", parents: [], refs: ["HEAD -> main"] }],
          }),
          inspectGitCommit: async () => ({
            commit: { commit: "abcdef123456", shortCommit: "abcdef1", subject: "feat: history", authorName: "zjarlin", authorEmail: "dev@example.com", authoredAt: "2026-09-24T12:00:00Z", parents: [], refs: ["HEAD -> main"] },
            body: "feat: history\\n\\nDetails",
            files: [{ path: "src/app.ts", status: "M", additions: 2, deletions: 1 }],
          }),
          inspectGitCommitDiff: async () => ({ path: "src/app.ts", diff: "+history", truncated: false }),
        };
        const control = installRendererGitSidebar({ getContext: () => ({ threadId: hostThreadIdSchema.parse("thread-1"), client }) });
        globalThis.gitSidebarFixture = { calls, hostMessages, dispose: () => control.dispose() };
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
const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Git sidebar fixture bundle missing");

async function setup(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost/git-sidebar-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupGitSidebar")());
}

test("switches project sidebar to commit view with the same width", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await expect(root).toBeAttached();
  const sidebar = page.locator("#native-sidebar");
  const width = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  await root.getByRole("button", { name: "提交" }).click();
  await expect(root.locator(".codexhost-git-log-subject")).toHaveText("feat: history");
  await expect(root.getByRole("heading", { name: "feat: history" })).toBeVisible();
  await expect(root.getByText("M src/app.ts +2 -1")).toBeVisible();
  await root.getByRole("button", { name: "工作区" }).click();
  await expect(root.locator(".codexhost-git-change").filter({ hasText: "src/app.ts" })).toBeVisible();
  await expect(root.getByText("vendor/lib · uninitialized")).toBeVisible();
  const initialize = root.getByRole("button", { name: "初始化" });
  await expect(initialize).toBeEnabled();
  await initialize.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls.length))
    .toBe(1);
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
  await root.getByRole("button", { name: "文件" }).click();
  await root.getByRole("button", { name: "终端" }).click();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").hostMessages),
  ).toEqual(["toggle-file-tree-panel", "toggle-terminal"]);
  await root.getByRole("button", { name: "项目" }).click();
  await expect(page.locator("#native-projects")).toBeVisible();
});
