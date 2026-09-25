import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererGitSidebar } from "./packages/renderer-extension/src/renderer-git-sidebar.ts";
      import { hostThreadIdSchema } from "./packages/shared-contracts/src/index.ts";

      globalThis.setupGitSidebar = () => {
        document.body.innerHTML = "";
        const sidebar = document.createElement("aside");
        sidebar.id = "app-shell-sidebar";
        sidebar.style.cssText = "box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:260px;height:700px;overflow:hidden";
        const content = document.createElement("div");
        content.id = "native-sidebar-content";
        content.style.cssText = "box-sizing:border-box;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;width:100%";
        const projects = document.createElement("div");
        projects.id = "native-projects";
        projects.style.cssText = "box-sizing:border-box;flex:1;min-height:0;width:100%";
        const row = document.createElement("div");
        row.setAttribute("data-app-action-sidebar-thread-row", "");
        row.textContent = "boxun-app";
        projects.append(row);
        content.append(projects);
        sidebar.append(content);
        document.body.append(sidebar);
        globalThis.replaceNativeSidebarContent = () => {
          const replacement = document.createElement("div");
          replacement.id = "native-sidebar-content";
          replacement.style.cssText = content.style.cssText;
          replacement.append(projects);
          content.replaceWith(replacement);
        };
        const status = {
          workspace: "/repo", branch: "main", detached: false, head: "abc123", upstream: "origin/main", ahead: 1, behind: 0,
          submodules: [{ path: "vendor/lib", status: "uninitialized" }],
          changes: [{ path: "src/app.ts", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null }],
        };
        const calls = [];
        const officialCalls = [];
        const addOfficialButton = (label, panel) => {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("aria-label", label);
          button.setAttribute("aria-pressed", "false");
          button.addEventListener("click", () => {
            officialCalls.push(panel);
            button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
          });
          document.body.append(button);
        };
        addOfficialButton("显示/隐藏侧边面板", "files");
        addOfficialButton("切换底部面板显示", "terminal");
        const client = {
          inspectGitStatus: async () => structuredClone(status),
          inspectGitDiff: async () => ({ path:"src/app.ts", diff:"+changed", truncated:false }),
          stageGitPaths: async (input) => {
            calls.push(["stage", input]);
            status.changes[0].staged = true;
            status.changes[0].unstaged = false;
            status.changes[0].indexStatus = "M";
            status.changes[0].workTreeStatus = " ";
            return structuredClone(status);
          },
          unstageGitPaths: async () => structuredClone(status),
          commitGit: async (input) => {
            calls.push(["commit", input]);
            status.changes = [];
            return { commit: "def4567", pushed: input.push, output: "", status: structuredClone(status) };
          },
          pushGit: async () => structuredClone(status),
          listGitMessageModels: async () => ({ models: [
            { id: "gpt-strong", label: "gpt-strong", tier: "夯", eligible: true },
            { id: "deepseek-flash", label: "deepseek-flash", tier: "垃", eligible: true },
          ], defaultModel: "deepseek-flash" }),
          generateGitMessage: async (input) => {
            calls.push(["generate", input]);
            return { message: "feat: generated commit", model: input.model };
          },
          updateGitSubmodule: async (input) => { calls.push(["submodule", input]); return structuredClone(status); },
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
        globalThis.gitSidebarFixture = { calls, officialCalls, dispose: () => control.dispose() };
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

test("separates commit and log views and commits unstaged changes", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await expect(root).toBeAttached();
  const sidebar = page.locator("#app-shell-sidebar");
  const width = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  await expect(sidebar).toHaveCSS("display", "flex");
  const rail = root.locator("[data-codexhost-git-sidebar-rail]");
  await expect(rail.getByRole("button", { name: "提交" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "日志" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "文件浏览器" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "终端" })).toBeVisible();
  await expect(root.getByRole("button", { name: "工作区" })).toHaveCount(0);

  await rail.getByRole("button", { name: "文件浏览器" }).click();
  await rail.getByRole("button", { name: "终端" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").officialCalls))
    .toEqual(["files", "terminal"]);
  await expect(rail.getByRole("button", { name: "文件浏览器" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rail.getByRole("button", { name: "终端" })).toHaveAttribute("aria-pressed", "true");

  await root.getByRole("button", { name: "提交" }).click();
  const sidebarBox = await sidebar.boundingBox();
  const panelBox = await root.locator(".codexhost-git-panel").boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x).toBe((sidebarBox?.x ?? 0) + 38);
  expect(panelBox?.y).toBe(sidebarBox?.y);
  expect(panelBox?.height).toBe(sidebarBox?.height);
  await expect(root.locator(".codexhost-git-log-subject")).toHaveCount(0);
  await expect(
    root.locator(".codexhost-git-change").filter({ hasText: "src/app.ts" }),
  ).toBeVisible();
  const message = root.locator("[data-codexhost-git-sidebar-message]");
  await expect(root.locator("[data-codexhost-git-sidebar-model]")).toHaveValue("deepseek-flash");
  await root.locator("[data-codexhost-git-sidebar-generate]").click();
  await expect(message).toHaveValue("feat: generated commit");
  await root.locator("[data-codexhost-git-sidebar-commit-push]").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "commit",
      {
        threadId: "thread-1",
        message: "feat: generated commit",
        paths: [],
        push: true,
      },
    ]);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "stage",
      {
        threadId: "thread-1",
        paths: ["src/app.ts"],
      },
    ]);
  await expect(root.getByText("已提交 (def4567)并推送。")).toBeVisible();
  await expect(root.locator(".codexhost-git-change")).toHaveCount(0);
  await expect(root.getByText("vendor/lib · uninitialized")).toBeVisible();
  const initialize = root.getByRole("button", { name: "初始化" });
  await expect(initialize).toBeEnabled();
  await initialize.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls.length))
    .toBe(4);
  await root.getByRole("button", { name: "日志" }).click();
  await expect(root.locator(".codexhost-git-log-subject")).toHaveText("feat: history");
  await expect(root.getByRole("heading", { name: "feat: history" })).toBeVisible();
  await expect(root.getByText("M src/app.ts +2 -1")).toBeVisible();
  await expect(root.locator("[data-codexhost-git-sidebar-message]")).toBeHidden();
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
  await root.getByRole("button", { name: "项目" }).click();
  await expect(page.locator("#native-projects")).toBeVisible();
  await page.evaluate(() => Reflect.get(globalThis, "replaceNativeSidebarContent")());
  await expect(sidebar.locator(":scope > [data-codexhost-git-sidebar]")).toBeAttached();
  await expect(page.locator("#native-sidebar-content")).toHaveCSS("padding-left", "38px");
});
