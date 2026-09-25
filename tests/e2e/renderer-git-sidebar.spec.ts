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
          inspectGitContent: async (input) => {
            calls.push(["content", input]);
            return {
              path: input.path,
              baseLabel: "HEAD",
              base: "export const app = false;\\n",
              working: "export const app = true;\\n",
              revision: "a".repeat(64),
              conflicted: false,
              ours: null,
              theirs: null,
              binary: false,
              truncated: false,
            };
          },
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
            return { workspace: "/repo", path: input.path, size: 25, revision: "a".repeat(64), content: "export const app = true;\\n", binary: false, truncated: false };
          },
          writeWorkspaceFile: async (input) => {
            calls.push(["writeFile", input]);
            if (Reflect.get(globalThis, "gitSidebarFixture")?.rejectWrite) {
              throw new Error("文件已被其他程序修改，请重新打开后再编辑。");
            }
            return { workspace: "/repo", path: input.path, size: input.content.length, revision: "b".repeat(64) };
          },
        };
        const projectSyncClient = {
          inspectProjectSync: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          inviteProjectSync: async () => {
            calls.push(["projectSync", "invite"]);
            return { code: "12345678", expiresAt: Date.now() + 300000 };
          },
          pairProjectSync: async ({ code }) => {
            calls.push(["projectSync", "pair", code]);
            return structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot);
          },
          acceptProjectSync: async ({ requestId }) => {
            calls.push(["projectSync", "accept", requestId]);
            const snapshot = structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot);
            snapshot.pending = [];
            snapshot.peers = [{ id: "53a62eae-5a99-4427-95d1-cb6cd1d340b8", name: "Laptop" }];
            globalThis.gitSidebarFixture.projectSyncSnapshot = snapshot;
            return structuredClone(snapshot);
          },
          rejectProjectSync: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          configureProjectSyncGit: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          pullProjectSyncGit: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          pushProjectSyncGit: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          syncProjectSync: async ({ peerId }) => {
            calls.push(["projectSync", "sync", peerId]);
            const snapshot = structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot);
            snapshot.projects = [{ name: "boxun-app", remote: "https://github.com/example/boxun-app.git", localPath: null, state: "missing" }];
            globalThis.gitSidebarFixture.projectSyncSnapshot = snapshot;
            return structuredClone(snapshot);
          },
          removeProjectSyncPeer: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          addProjectSync: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          bindProjectSync: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
          cloneProjectSync: async () => structuredClone(globalThis.gitSidebarFixture.projectSyncSnapshot),
        };
        let activeContext = { threadId: hostThreadIdSchema.parse("thread-1"), client };
        const control = installRendererGitSidebar({
          getContext: () => activeContext,
          getProjectSyncClient: () => projectSyncClient,
        });
        globalThis.gitSidebarFixture = {
          client,
          status,
          setContext(threadId, nextClient = client) {
            activeContext = { threadId, client: threadId ? nextClient : null };
            control.syncContext();
          },
          calls,
          officialCalls,
          projectSyncSnapshot: {
            peers: [],
            pending: [{ requestId: "eb28d531-8ba0-4733-a24b-61bc6b2fa84c", name: "Desktop", fingerprint: "a123456789abcdef" }],
            connected: true,
            relay: "wss://relay.example.test",
            gitRemote: null,
            projects: [],
          },
          dispose: () => control.dispose(),
        };
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

test("ignores a delayed Git diff after selecting another file", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.client.inspectGitDiff = ({ path }: { path: string }) => {
      if (path !== "src/app.ts") return Promise.resolve({ path, diff: "+newer", truncated: false });
      return new Promise((resolve) => {
        fixture.resolveDiff = () => resolve({ path, diff: "+older", truncated: false });
      });
    };
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  const content = page.locator("[data-codexhost-git-content]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(content.getByText("正在加载差异…")).toBeVisible();
  await root.locator('.codexhost-git-change[title="src/components/button.ts"]').click();
  await expect(content.locator(".codexhost-git-diff")).toHaveText("+newer");
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveDiff());
  await expect(content.locator(".codexhost-git-diff")).toHaveText("+newer");
  await expect(content.locator(".codexhost-git-diff")).toHaveText("+newer");
  await expect(page.locator("[data-app-shell-main-surface='default']")).toHaveText("Conversation");
});
const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Git sidebar fixture bundle missing");

async function setup(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost/git-sidebar-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupGitSidebar")());
}

test("commits unstaged changes from the commit sidebar", async ({ page }) => {
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
  await expect(rail.getByRole("button", { name: "设备" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "日志" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "文件浏览器" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "终端" })).toBeVisible();
  await expect(root.getByRole("button", { name: "工作区" })).toHaveCount(0);

  await rail.getByRole("button", { name: "设备" }).click();
  const devicesPanel = root.locator("[data-codexhost-project-sync-panel]");
  await expect(devicesPanel).toBeVisible();
  await expect(root.locator("[data-codexhost-git-panel]")).toBeHidden();
  await devicesPanel.getByRole("button", { name: "生成配对码" }).click();
  await expect(devicesPanel.getByText("12345678", { exact: true })).toBeVisible();
  await devicesPanel.getByRole("button", { name: "同意" }).click();
  await expect(devicesPanel.getByText("Laptop")).toBeVisible();
  await devicesPanel.locator("[data-codexhost-project-sync-sync]").click();
  await expect(devicesPanel.getByText("boxun-app", { exact: true })).toBeVisible();
  await expect(devicesPanel.getByText("本机缺少")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toEqual(
      expect.arrayContaining([
        ["projectSync", "invite"],
        ["projectSync", "accept", "eb28d531-8ba0-4733-a24b-61bc6b2fa84c"],
        ["projectSync", "sync", "53a62eae-5a99-4427-95d1-cb6cd1d340b8"],
      ]),
    );

  await rail.getByRole("button", { name: "文件浏览器" }).click();
  await expect(devicesPanel).toBeHidden();
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
  const editor = preview.locator("[data-codexhost-workspace-file-editor] .cm-content");
  await expect(editor).toHaveText("export const app = true;");
  await expect(preview.locator(".codexhost-preview-title strong")).toHaveText("src/app.ts");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual(["readFile", { threadId: "thread-1", path: "src/app.ts" }]);
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("\nexport const changed = true;");
  await expect(preview.locator("[data-codexhost-workspace-file-dirty]")).toBeVisible();
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "writeFile",
      {
        threadId: "thread-1",
        path: "src/app.ts",
        content: "export const app = true;\nexport const changed = true;",
        expectedRevision: "a".repeat(64),
      },
    ]);
  await expect(preview.locator("[data-codexhost-workspace-file-dirty]")).toBeHidden();
  await page.evaluate(() => {
    Reflect.get(globalThis, "gitSidebarFixture").rejectWrite = true;
  });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("\nexport const conflict = true;");
  await preview.locator("[data-codexhost-workspace-file-save]").click();
  await expect(preview.getByText("文件已被其他程序修改，请重新打开后再编辑。")).toBeVisible();
  await expect(preview.locator("[data-codexhost-workspace-file-dirty]")).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(globalThis, "gitSidebarFixture").rejectWrite = false;
  });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
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
  const gitContent = page.locator("[data-codexhost-git-content]");
  await expect(gitContent.locator(".codexhost-git-diff")).toHaveText("+changed");
  await expect(gitContent.getByRole("button", { name: "并排" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(gitContent.locator(".split-row")).toHaveCount(1);
  await gitContent.locator(".split-row").first().locator(".gutter").click();
  await expect(gitContent.locator(".split-row").first().locator(".right .line")).toHaveText(
    "export const app = false;",
  );
  await gitContent.getByRole("button", { name: "结果" }).click();
  await expect(gitContent.getByRole("textbox", { name: "合并结果" })).toHaveValue(
    "export const app = false;\n",
  );
  await gitContent.getByRole("button", { name: "保存" }).click();
  await expect(gitContent.getByText("已保存到工作区。")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "writeFile",
      {
        threadId: "thread-1",
        path: "src/app.ts",
        content: "export const app = false;\n",
        expectedRevision: "a".repeat(64),
      },
    ]);
  await expect(root.locator(".codexhost-git-diff")).toHaveCount(0);
  expect(await gitContent.boundingBox()).toEqual(mainBox);
  await page.locator("[data-app-shell-main-surface='default']").evaluate((element) => {
    (element as HTMLElement).style.left = "320px";
    (element as HTMLElement).style.bottom = "180px";
  });
  await expect
    .poll(() => gitContent.boundingBox())
    .toEqual(await page.locator("[data-app-shell-main-surface='default']").boundingBox());
  await page.keyboard.press("Escape");
  await expect(gitContent).toHaveCount(0);
  await root.locator(".codexhost-git-change").first().click();
  await expect(gitContent.locator(".codexhost-git-diff")).toHaveText("+changed");
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
  await expect(gitContent).toHaveCount(0);
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
  await expect(root.locator("[data-codexhost-git-sidebar-message]")).toBeVisible();
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.status.changes = [
      {
        path: "src/conflict.ts",
        indexStatus: "U",
        workTreeStatus: "U",
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true,
        submodule: null,
      },
    ];
    fixture.client.inspectGitDiff = async () => ({
      path: "src/conflict.ts",
      diff: "+current\\n+incoming",
      truncated: false,
    });
    fixture.client.inspectGitContent = async () => ({
      path: "src/conflict.ts",
      baseLabel: "BASE",
      base: "base\\n",
      working: "<<<<<<< HEAD\\ncurrent\\n=======\\nincoming\\n>>>>>>> feature\\n",
      revision: "c".repeat(64),
      conflicted: true,
      ours: "current\\n",
      theirs: "incoming\\n",
      binary: false,
      truncated: false,
    });
  });
  await root.getByRole("button", { name: "刷新" }).click();
  await root.locator('.codexhost-git-change[title="src/conflict.ts"]').click();
  await expect(gitContent.getByText("冲突：需要合并")).toBeVisible();
  await expect(gitContent.getByRole("button", { name: "暂存" })).toBeDisabled();
  await gitContent.getByRole("button", { name: "采用传入" }).click();
  await expect(gitContent.getByRole("textbox", { name: "合并结果" })).toHaveValue("incoming\\n");
  await gitContent.getByRole("button", { name: "关闭 Git 内容" }).click();
  await root.getByRole("button", { name: "项目" }).click();
  await expect(gitContent).toHaveCount(0);
  await expect(page.locator("#native-projects")).toBeVisible();
  await page.evaluate(() => Reflect.get(globalThis, "replaceNativeSidebarContent")());
  await expect(sidebar.locator(":scope > [data-codexhost-git-sidebar]")).toBeAttached();
  await expect(page.locator("#native-sidebar-content")).toHaveCSS("padding-left", "38px");
  await rail.getByRole("button", { name: "文件浏览器" }).click();
  await expect(gitContent).toHaveCount(0);
  await expect(filesPanel).toBeVisible();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").dispose());
  await expect(gitContent).toHaveCount(0);
});

test("follows the active chat project and ignores stale status across hosts", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  const project = root.locator("[data-codexhost-git-sidebar-project]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(project).toHaveText("repo");
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.client.inspectGitStatus = ({ threadId }: { threadId: string }) =>
      new Promise((resolve) => {
        fixture[threadId] = () =>
          resolve({
            ...fixture.status,
            workspace: `/workspace/${threadId}`,
            branch: `${threadId}-branch`,
            changes: [{ ...fixture.status.changes[0], path: `${threadId}.ts` }],
          });
      });
    fixture.setContext("old-project");
  });
  await expect(project).toHaveText("正在读取项目…");
  await expect(root.locator(".codexhost-git-change")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").setContext("iot-app"));
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture")["old-project"]());
  await expect(project).toHaveText("正在读取项目…");
  await expect(root.getByRole("button", { name: "刷新", exact: true })).toBeDisabled();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture")["iot-app"]());
  await expect(project).toHaveText("iot-app");
  await expect(project).toHaveAttribute("title", "/workspace/iot-app");
  await expect(root.locator(".codexhost-git-branch")).toContainText("iot-app-branch");
  await expect(root.locator(".codexhost-git-change")).toContainText("iot-app.ts");
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.setContext("iot-app", {
      ...fixture.client,
      inspectGitStatus: async () => ({
        ...fixture.status,
        workspace: "C:\\work\\remote-project",
        changes: [],
      }),
    });
  });
  await expect(project).toHaveText("remote-project");
  await expect(root.locator(".codexhost-git-change")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").setContext(null));
  await expect(project).toHaveText("未选择项目");
  await expect(root.locator("[data-codexhost-git-sidebar-commit-push]")).toBeDisabled();
  await expect(page.locator("[data-codexhost-git-content]")).toHaveCount(0);
});

test("keeps generated messages and commit operations bound to their original project", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  const message = root.locator("[data-codexhost-git-sidebar-message]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.client.generateGitMessage = () =>
      new Promise((resolve) => {
        fixture.resolveMessage = () =>
          resolve({ message: "old project message", model: "deepseek-flash" });
      });
    fixture.client.stageGitPaths = () =>
      new Promise((resolve) => {
        fixture.resolveStage = () => resolve(fixture.status);
      });
  });
  await message.fill("old project draft");
  await root.locator("[data-codexhost-git-sidebar-generate]").click();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").setContext("thread-2"));
  await expect(message).toHaveValue("");
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").setContext("thread-1"));
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveMessage());
  await expect(message).toHaveValue("");
  await message.fill("new draft");
  await root.locator("[data-codexhost-git-sidebar-commit-push]").click();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").setContext("thread-2"));
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveStage());
  await expect(message).toHaveValue("");
  const commits = await page.evaluate(() =>
    Reflect.get(globalThis, "gitSidebarFixture").calls.filter(
      (call: unknown[]) => call[0] === "commit",
    ),
  );
  expect(commits).toEqual([]);
});
