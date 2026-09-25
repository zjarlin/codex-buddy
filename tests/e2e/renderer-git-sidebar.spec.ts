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
        const header = document.createElement("header");
        header.setAttribute("data-pip-obstacle", "app-shell-header");
        header.style.cssText = "position:fixed;inset:0 0 auto 0;box-sizing:border-box;height:46px";
        const main = document.createElement("main");
        main.setAttribute("data-app-shell-main-surface", "default");
        main.style.cssText = "position:fixed;top:46px;right:0;bottom:0;left:260px;box-sizing:border-box";
        main.textContent = "Conversation";
        document.body.append(sidebar, header, main);
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
          changes: [
            { path: "src/app.ts", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null },
            { path: "src/components/button.ts", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null },
            { path: "vendor/lib", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:{ path:"vendor/lib", status:"uninitialized" } },
          ],
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
          listWorkspaceFiles: async (input) => {
            calls.push(["listFiles", input]);
            if (input.path === "") {
              return { workspace: "/repo", path: "", truncated: false, entries: [
                { name: "src", path: "src", kind: "directory", size: null },
                { name: "README.md", path: "README.md", kind: "file", size: 12 },
              ] };
            }
            if (input.path === "src") {
              return { workspace: "/repo", path: "src", truncated: false, entries: [
                { name: "app.ts", path: "src/app.ts", kind: "file", size: 25 },
              ] };
            }
            return { workspace: "/repo", path: input.path, truncated: false, entries: [] };
          },
          readWorkspaceFile: async (input) => {
            calls.push(["readFile", input]);
            return { workspace: "/repo", path: input.path, size: 25, content: "export const app = true;\\n", binary: false, truncated: false };
          },
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
    .toEqual(["terminal"]);
  await expect(rail.getByRole("button", { name: "文件浏览器" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rail.getByRole("button", { name: "终端" })).toHaveAttribute("aria-pressed", "true");

  const filesPanel = root.locator("[data-codexhost-workspace-files-panel]");
  await expect(filesPanel).toBeVisible();
  await expect(filesPanel.getByRole("button", { name: /src/ })).toBeVisible();
  await filesPanel.getByRole("button", { name: /src/ }).click();
  const appFile = filesPanel.getByRole("button", { name: /app\.ts/ });
  await expect(appFile).toBeVisible();
  await appFile.click();
  const preview = page.locator("[data-codexhost-workspace-file-preview]");
  await expect(preview).toHaveAttribute("data-open", "true");
  const mainBox = await page.locator("[data-app-shell-main-surface='default']").boundingBox();
  const previewBox = await preview.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(previewBox?.x).toBe(mainBox?.x);
  expect(previewBox?.y).toBe(mainBox?.y);
  expect(Math.abs((previewBox?.width ?? 0) - (mainBox?.width ?? 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((previewBox?.height ?? 0) - (mainBox?.height ?? 0))).toBeLessThanOrEqual(2);
  await expect(preview.locator(".codexhost-preview-body")).toHaveText("export const app = true;");
  await expect(preview.locator(".codexhost-preview-title strong")).toHaveText("src/app.ts");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual(["readFile", { threadId: "thread-1", path: "src/app.ts" }]);
  await preview.locator("button[aria-label='关闭文件预览']").click();
  await expect(preview).toHaveCount(0);

  await root.getByRole("button", { name: "提交" }).click();
  const sidebarBox = await sidebar.boundingBox();
  const panelBox = await root.locator(".codexhost-git-panel").boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x).toBe((sidebarBox?.x ?? 0) + 38);
  expect(panelBox?.y).toBe(sidebarBox?.y);
  expect(panelBox?.height).toBe(sidebarBox?.height);
  await expect(root.locator(".codexhost-git-log-subject")).toHaveCount(0);
  await expect(root.locator("[data-codexhost-git-sidebar-changes-tab]")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(root.locator("[data-codexhost-git-sidebar-staged-tab]")).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await expect(root.locator(".codexhost-git-change")).toHaveCount(3);
  await expect(root.locator("[data-codexhost-git-sidebar-tree]")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await root.locator("[data-codexhost-git-sidebar-tree]").click();
  await expect(root.locator("[data-codexhost-git-sidebar-tree]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(root.locator(".codexhost-git-directory").filter({ hasText: "src" })).toBeVisible();
  await expect(
    root.locator(".codexhost-git-directory").filter({ hasText: "components" }),
  ).toBeVisible();
  await expect(root.locator(".codexhost-git-modules").getByText("模块")).toBeVisible();
  await root.locator(".codexhost-git-directory").filter({ hasText: "components" }).click();
  await expect(
    root.locator(".codexhost-git-directory").filter({ hasText: "components" }),
  ).toHaveAttribute("aria-expanded", "false");
  await root.locator("[data-codexhost-git-sidebar-staged-tab]").click();
  await expect(root.getByText("没有已暂存文件")).toBeVisible();
  await root.locator("[data-codexhost-git-sidebar-changes-tab]").click();
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
        paths: ["src/app.ts", "src/components/button.ts", "vendor/lib"],
      },
    ]);
  await expect(root.getByText("已提交 (def4567)并推送。")).toBeVisible();
  await expect(root.locator(".codexhost-git-change")).toHaveCount(0);
  await expect(root.getByText("vendor/lib · uninitialized")).toBeVisible();
  const initialize = root.getByRole("button", { name: "初始化" });
  await expect(initialize).toBeEnabled();
  await initialize.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "submodule",
      {
        threadId: "thread-1",
        path: "vendor/lib",
        init: true,
      },
    ]);
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
