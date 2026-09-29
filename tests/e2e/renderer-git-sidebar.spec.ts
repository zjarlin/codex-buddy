import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererGitSidebar } from "./packages/renderer-extension/src/renderer-git-sidebar.ts";
      import { RendererMethodUnavailableError } from "./packages/renderer-extension/src/renderer-request-sender.ts";
      import { createRendererHostClients } from "./packages/renderer-extension/src/renderer-host-clients.ts";
      import { hostThreadIdSchema } from "./packages/shared-contracts/src/index.ts";

      globalThis.RendererMethodUnavailableError = RendererMethodUnavailableError;
      globalThis.createRendererHostClients = createRendererHostClients;
      globalThis.setupGitSidebar = () => {
        document.body.innerHTML = "<style>[hidden] { display: none !important; }</style>";
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
          operation: null, conflicts: [],
          submodules: [{ path: "vendor/lib", status: "uninitialized" }],
          changes: [
            { path: "src/app.ts", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null },
            { path: "src/components/button.ts", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null },
            { path: "vendor/lib", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:{ path:"vendor/lib", status:"uninitialized" } },
          ],
        };
        const submoduleStatus = {
          workspace: "/repo/vendor/lib", branch: "main", detached: false, head: "def456", upstream: "origin/main", ahead: 0, behind: 0,
          operation: null, conflicts: [], submodules: [],
          changes: [
            { path: "child.txt", indexStatus:" ", workTreeStatus:"M", staged:false, unstaged:true, untracked:false, conflicted:false, submodule:null },
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
        addOfficialButton("切换文件树显示", "files");
        addOfficialButton("切换底部面板显示", "terminal");
        const client = {
          inspectGitStatus: async (input) => { calls.push(["status", input]); return structuredClone(input.repository ? submoduleStatus : status); },
          inspectGitDiff: async (input) => { calls.push(["diff", input]); return { path:input.path, diff:input.repository ? "+child changed" : input.path === "vendor/lib" ? "-Subproject commit abc123\\n+Subproject commit abc123-dirty" : "+changed", truncated:false }; },
          inspectGitContent: async (input) => {
            calls.push(["content", input]);
            return {
              path: input.path,
              kind: input.path === "vendor/lib" && !input.repository ? "submodule" : "file",
              baseLabel: "HEAD",
              base: "export const app = false;\\n",
              working: input.repository ? "child changed\\n" : "export const app = true;\\n",
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
            const target = input.repository ? submoduleStatus : status;
            target.changes[0].staged = true;
            target.changes[0].unstaged = false;
            target.changes[0].indexStatus = "M";
            target.changes[0].workTreeStatus = " ";
            return structuredClone(target);
          },
          unstageGitPaths: async (input) => structuredClone(input.repository ? submoduleStatus : status),
          commitGit: async (input) => {
            calls.push(["commit", input]);
            const target = input.repository ? submoduleStatus : status;
            target.changes = [];
            return { commit: "def4567", pushed: input.push, output: "", status: structuredClone(target) };
          },
          pushGit: async (input) => structuredClone(input.repository ? submoduleStatus : status),
          syncGit: async (input) => {
            calls.push(["sync", input]);
            status.behind = 0;
            status.ahead = 0;
            return { strategy: "fast-forward", behind: 1, conflicts: [], output: "", status: structuredClone(status) };
          },
          continueGitMerge: async (input) => {
            calls.push(["mergeContinue", input]);
            status.operation = null;
            status.conflicts = [];
            return structuredClone(status);
          },
          abortGitMerge: async (input) => {
            calls.push(["mergeAbort", input]);
            status.operation = null;
            status.conflicts = [];
            return structuredClone(status);
          },
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
            const response = { workspace: "/repo", path: input.path, size: 25, revision: "a".repeat(64), content: "export const app = true;\\n", binary: false, truncated: false };
            if (Reflect.get(globalThis, "gitSidebarFixture")?.omitReadRevision) {
              delete response.revision;
            }
            return response;
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
        let activeContext = { threadId: hostThreadIdSchema.parse("thread-1"), hostId: "local", client };
        const nativeReviewCalls = [];
        const nativeScope = { value: { routeKind: "local-thread", conversationId: "thread-1" }, get() {}, set() {} };
        const nativeTab = {
          tabId: "diff",
          durableRoute: { kind: "review", payloadVersion: 1, params: { conversationId: "thread-1", hostId: "local", cwd: "/repo", diffFilter: "last-turn" } },
          tabType: { kind: "review", durableRoute: { restore({ descriptor, scope, target, revealAndFocus }) {
            nativeReviewCalls.push({ descriptor, target, revealAndFocus });
            if (scope !== nativeScope) throw new Error("wrong native scope");
            if (globalThis.gitSidebarFixture.rejectReview) return false;
            nativeTab.durableRoute = descriptor;
            return true;
          } } },
        };
        const nativeButton = document.createElement("button");
        nativeButton.setAttribute("role", "tab");
        nativeButton.textContent = "官方审查";
        nativeButton.style.cssText = "position:fixed;left:270px;top:50px";
        nativeButton.__reactFiber$fixture = { memoizedProps: { tab: nativeTab }, return: { memoizedProps: { value: nativeScope } } };
        const mountReview = () => {
          nativeScope.value.conversationId = activeContext.threadId;
          nativeTab.durableRoute.params.conversationId = activeContext.threadId;
          nativeTab.durableRoute.params.hostId = globalThis.gitSidebarFixture.wrongNativeHost ? "other-host" : activeContext.hostId;
          document.body.append(nativeButton);
          let content = document.getElementById("native-review");
          if (!content) {
            content = document.createElement("section");
            content.id = "native-review";
            content.style.cssText = "position:fixed;left:270px;top:90px";
            for (const path of ["src/app.ts", "src/components/button.ts", "child.txt", "vendor/lib"]) {
              const file = document.createElement("div");
              file.setAttribute("data-review-path", path);
              file.textContent = path;
              content.append(file);
            }
            document.body.append(content);
          }
        };
        window.addEventListener("message", ({ data }) => {
          if (data?.type !== "run-command") return;
          officialCalls.push(data.id);
          if (data.id === "openReviewTab") {
            if (globalThis.gitSidebarFixture.delayReview) globalThis.gitSidebarFixture.resolveReview = mountReview;
            else mountReview();
          }
        });
        const control = installRendererGitSidebar({
          getContext: () => activeContext,
          getProjectSyncClient: () => projectSyncClient,
        });
        globalThis.gitSidebarFixture = {
          client,
          status,
          setContext(threadId, nextClient = client, hostId = "local", cwd) {
            activeContext = { threadId, cwd, hostId, client: threadId || cwd ? nextClient : null };
            control.syncContext();
          },
          calls,
          officialCalls,
          nativeReviewCalls,
          nativeTab,
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

const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Git sidebar fixture bundle missing");

async function setup(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost/git-sidebar-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => Reflect.get(globalThis, "setupGitSidebar")());
}

test("tracks native terminal replacement and label changes without relying on message updates", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const terminal = page.locator("[data-codexhost-git-sidebar-terminal]");
  await expect(terminal).toHaveAttribute("title", "终端");
  await page
    .locator('body > button[aria-label="切换底部面板显示"]')
    .evaluate((button) => button.remove());
  await expect(terminal).toHaveAttribute("title", "终端（不可用）");
  await page.evaluate(() => {
    const replacement = document.createElement("button");
    replacement.id = "replacement-terminal";
    replacement.setAttribute("aria-label", "Toggle bottom panel");
    replacement.setAttribute("aria-pressed", "true");
    document.body.append(replacement);
  });
  await expect(terminal).toHaveAttribute("title", "终端");
  await expect(terminal).toHaveAttribute("aria-pressed", "true");
  await page
    .locator("#replacement-terminal")
    .evaluate((button) => button.setAttribute("aria-label", "Copy output"));
  await expect(terminal).toHaveAttribute("title", "终端（不可用）");
  await expect(terminal).toHaveAttribute("aria-pressed", "false");
  await page
    .locator("#replacement-terminal")
    .evaluate((button) => button.setAttribute("aria-label", "切换底部面板显示"));
  await expect(terminal).toHaveAttribute("title", "终端");
  await expect(terminal).toHaveAttribute("aria-pressed", "true");
});

test("forwards files and terminal to the official UI and keeps project sync available", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.getByRole("button", { name: "设备", exact: true }).click();
  const devices = root.locator("[data-codexhost-project-sync-panel]");
  await expect(devices).toBeVisible();
  await devices.getByRole("button", { name: "生成配对码" }).click();
  await expect(devices.getByText("12345678", { exact: true })).toBeVisible();
  await root.getByRole("button", { name: "文件浏览器", exact: true }).click();
  await expect(devices).toBeHidden();
  await expect(page.locator("#native-projects")).toBeVisible();
  await root.getByRole("button", { name: "终端", exact: true }).click();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").officialCalls),
  ).toEqual(["files", "terminal"]);
  await expect(
    page.locator("[data-codexhost-workspace-files-panel], [data-codexhost-workspace-file-preview]"),
  ).toHaveCount(0);
  await expect(root.getByRole("button", { name: "文件浏览器", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("passes repository context to official review without fetching duplicate file contents", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.locator('.codexhost-git-directory[title="src"]').click();
  await root.locator('.codexhost-git-change[title="src/app.ts"]').click();
  await expect(page.getByRole("tab", { name: "官方审查" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls))
    .toEqual([
      {
        descriptor: {
          kind: "review",
          payloadVersion: 1,
          tabId: "diff",
          params: {
            conversationId: "thread-1",
            hostId: "local",
            cwd: "/repo",
            repositoryRoot: null,
            diffFilter: "uncommitted",
          },
        },
        target: "right",
        revealAndFocus: true,
      },
    ]);
  const calls = await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls);
  expect(
    calls.some(([name]: string[]) =>
      ["diff", "content", "readFile", "writeFile", "listFiles"].includes(name ?? ""),
    ),
  ).toBe(false);
  await expect(page.locator("[data-codexhost-git-content]")).toHaveCount(0);
  await expect(page.locator("[data-app-shell-main-surface='default']")).toHaveText("Conversation");
  await root.locator("[data-codexhost-git-sidebar-message]").fill("fix: native review");
  await root.locator("[data-codexhost-git-sidebar-commit]").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "commit",
      {
        threadId: "thread-1",
        message: "fix: native review",
        paths: [],
        push: false,
      },
    ]);
  await expect(page.getByRole("tab", { name: "官方审查" })).toBeVisible();
});

test("opens staged review on the originating remote host", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const f = Reflect.get(globalThis, "gitSidebarFixture");
    f.status.changes[0].staged = true;
    f.setContext("remote-thread", f.client, "remote-host");
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.locator("[data-codexhost-git-sidebar-staged-tab]").click();
  await root.getByRole("button", { name: "审查", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls[0]?.descriptor.params,
      ),
    )
    .toEqual({
      conversationId: "remote-thread",
      hostId: "remote-host",
      cwd: "/repo",
      repositoryRoot: null,
      diffFilter: "staged",
    });
});

test("cancels an old review request when the active chat changes", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    Reflect.get(globalThis, "gitSidebarFixture").delayReview = true;
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.getByRole("button", { name: "审查", exact: true }).click();
  await expect(root.getByText("正在打开官方审查…")).toBeVisible();
  await page.evaluate(() => {
    const f = Reflect.get(globalThis, "gitSidebarFixture");
    f.setContext("next-thread");
    f.resolveReview();
  });
  await expect(root.getByText("正在打开官方审查…")).toBeHidden();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls),
  ).toEqual([]);
});

test("reports unsupported native review and never sends data to a different host", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    Reflect.get(globalThis, "gitSidebarFixture").wrongNativeHost = true;
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.getByRole("button", { name: "审查", exact: true }).click();
  await expect(root.getByText(/未能打开当前会话的官方审查面板/)).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls),
  ).toEqual([]);
  await expect(page.locator("[data-codexhost-git-content]")).toHaveCount(0);
});

test("uses the official file-tree command when its toolbar button is absent", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() =>
    document.querySelector('button[aria-label="切换文件树显示"]')?.remove(),
  );
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.getByRole("button", { name: "文件浏览器", exact: true }).click();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").officialCalls),
  ).toEqual(["toggleFileTreePanel"]);
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "gitSidebarFixture").calls.filter(
        ([name]: string[]) => name === "listFiles",
      ),
    ),
  ).toEqual([]);
});

test("cancels a pending review when the comparison range changes", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    Reflect.get(globalThis, "gitSidebarFixture").delayReview = true;
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.getByRole("button", { name: "审查", exact: true }).click();
  await expect(root.getByText("正在打开官方审查…")).toBeVisible();
  await root.locator("[data-codexhost-git-sidebar-staged-tab]").click();
  await expect(root.getByText("正在打开官方审查…")).toBeHidden();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveReview());
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls),
  ).toEqual([]);
});

test("reports a native rejection without falling back to custom diff rendering", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    Reflect.get(globalThis, "gitSidebarFixture").rejectReview = true;
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.getByRole("button", { name: "审查", exact: true }).click();
  await expect(root.getByText("官方审查未接受当前仓库或比较范围。")).toBeVisible();
  await expect(page.locator("[data-codexhost-git-content]")).toHaveCount(0);
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

test("stops loading when the active project is not inside a Git repository", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.client.inspectGitStatus = () =>
      new Promise((_resolve, reject) => {
        fixture.rejectWorkspace = () => reject(new Error("当前目录不是 Git 仓库。"));
      });
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  const project = root.locator("[data-codexhost-git-sidebar-project]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(project).toHaveText("正在读取项目…");
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").rejectWorkspace());
  await expect(project).toHaveText("未检测到工作区");
  await expect(root.locator(".codexhost-git-empty")).toHaveText("无法读取 Git 状态");
  await expect(root.getByText("当前目录不是 Git 仓库。")).toBeVisible();
  await expect(root.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
});

test("explains a missing remote Git service without loading models and recovers on reconnection", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    const Unavailable = Reflect.get(globalThis, "RendererMethodUnavailableError");
    fixture.setContext(
      "remote-thread",
      {
        ...fixture.client,
        inspectGitStatus: async () => {
          throw new Unavailable("codexhost/git/status", { code: -32601 });
        },
        listGitMessageModels: async () => {
          fixture.calls.push(["unsupported-models"]);
          throw new Unavailable("codexhost/git/message-models", { code: -32601 });
        },
      },
      "remote-host",
    );
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveText(
    "当前连接未启用 Git 服务",
  );
  await expect(
    root.locator(".codexhost-git-notice").filter({ hasText: "此连接未提供 Git 服务" }),
  ).toBeVisible();
  await expect(root.locator(".codexhost-git-empty")).toHaveText("无法读取 Git 状态");
  await expect(root.locator("[data-codexhost-git-sidebar-push]")).toBeDisabled();
  await expect(root.locator("[data-codexhost-git-sidebar-sync]")).toBeDisabled();
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeDisabled();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls),
  ).not.toContainEqual(["unsupported-models"]);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.setContext("remote-thread", { ...fixture.client }, "remote-host");
  });
  await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveText("repo");
  await expect(root.locator("[data-codexhost-git-sidebar-push]")).toBeEnabled();
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await expect(root.getByText("此连接未提供 Git 服务", { exact: false })).toHaveCount(0);
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
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeDisabled();
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveMessage());
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
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

test("keeps large projects collapsed and reuses status without reading file contents", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.status.changes = Array.from({ length: 10_000 }, (_, index) => ({
      ...fixture.status.changes[0],
      path: `dir-${Math.floor(index / 100)}/file-${index}.ts`,
    }));
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(root.locator(".codexhost-git-directory")).toHaveCount(100);
  await expect(root.locator(".codexhost-git-change")).toHaveCount(0);
  await root.locator("[data-codexhost-git-sidebar-projects]").click();
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  const calls = await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls);
  expect(calls.filter(([name]: string[]) => name === "status")).toHaveLength(1);
  expect(calls.some(([name]: string[]) => ["diff", "content"].includes(name ?? ""))).toBe(false);
});

test("shows pending actions, ignores repeated clicks and permits retry after failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.locator('.codexhost-git-directory[title="src"]').click();
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await root.locator("[data-codexhost-git-sidebar-message]").fill("fix: single request");
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    const methods = [
      "inspectGitStatus",
      "stageGitPaths",
      "unstageGitPaths",
      "generateGitMessage",
      "commitGit",
      "pushGit",
      "updateGitSubmodule",
      "syncGit",
      "continueGitMerge",
      "abortGitMerge",
    ];
    fixture.pendingCalls = [];
    for (const method of methods) {
      fixture.client[method] = () => {
        fixture.pendingCalls.push(method);
        return new Promise((resolve, reject) => {
          fixture.rejectAction = () => reject(new Error("operation failed; retry"));
          fixture.resolveAction = () =>
            resolve(
              method === "generateGitMessage"
                ? { message: "fix: generated", model: "deepseek-flash" }
                : method === "commitGit"
                  ? { commit: "abc123", pushed: false, status: structuredClone(fixture.status) }
                  : method === "syncGit"
                    ? { strategy: "up-to-date", behind: 0, status: structuredClone(fixture.status) }
                    : structuredClone(fixture.status),
            );
        });
      };
    }
    fixture.status.operation = "merge";
    fixture.status.conflicts = [];
    fixture.status.changes[0].staged = true;
    fixture.status.changes[0].unstaged = false;
    fixture.status.warnings = ["子模块 aio-plugin-documentation-agent 缺少 .gitmodules 映射"];
  });
  const refresh = root.getByRole("button", { name: "刷新", exact: true });
  await refresh.click();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveAction());
  await expect(root.locator("[data-codexhost-git-warnings]")).toContainText(
    "aio-plugin-documentation-agent",
  );

  const actions = [
    ["stage-all", "stageGitPaths"],
    ["generate", "generateGitMessage"],
    ["commit", "commitGit"],
    ["commit-push", "commitGit"],
    ["push", "pushGit"],
    ["sync", "syncGit"],
    ["merge-continue", "continueGitMerge"],
    ["merge-abort", "abortGitMerge"],
    ["refresh", "inspectGitStatus"],
    ["submodule:vendor/lib", "updateGitSubmodule"],
  ];
  for (const [action, method] of actions) {
    const button = root.locator(`button[data-git-action="${action}"]`);
    await expect(button).toBeEnabled();
    const before = await page.evaluate(
      () => Reflect.get(globalThis, "gitSidebarFixture").pendingCalls.length,
    );
    await button.evaluate((element) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
    await expect(refresh).toBeDisabled();
    const calls = await page.evaluate(
      () => Reflect.get(globalThis, "gitSidebarFixture").pendingCalls,
    );
    expect(calls.slice(before)).toEqual([method]);
    expect(
      await button.evaluate((element) => getComputedStyle(element, "::after").animationName),
    ).toBe("codexhost-git-spin");
    await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").rejectAction());
    await expect(button).toHaveAttribute("aria-busy", "false");
    await expect(root.getByText("operation failed; retry", { exact: true })).toBeVisible();
    if (action !== "refresh")
      await expect(root.locator("[data-codexhost-git-warnings]")).toBeVisible();
    // 刷新失败会清空当前快照，先重试恢复，再验证其他操作。
    if (action === "refresh") {
      await refresh.click();
      await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveAction());
    }
  }
  const push = root.locator("[data-codexhost-git-sidebar-push]");
  await push.click();
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveAction());
  await expect(push).toBeEnabled();
  await expect(root.getByText("已推送。", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("pulls and syncs from the sidebar and surfaces an in-progress merge", async ({ page }) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  const sync = root.locator("[data-codexhost-git-sidebar-sync]");
  await expect(sync).toBeVisible();
  await sync.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual(["sync", { threadId: "thread-1" }]);
  await expect(root.getByText("已快进合入远端 1 个提交。")).toBeVisible();

  // 进入合并冲突态后，横幅列出冲突文件并提供继续/中止。
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.status.operation = "merge";
    fixture.status.conflicts = ["src/app.ts"];
  });
  await root.getByRole("button", { name: "刷新", exact: true }).click();
  const banner = root.locator("[data-codexhost-git-sidebar-conflict]");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("1 个冲突文件待解决");
  await expect(root.locator("[data-codexhost-git-sidebar-merge-continue]")).toBeDisabled();
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.status.operation = null;
    fixture.status.conflicts = [];
  });
  await root.locator("[data-codexhost-git-sidebar-merge-abort]").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual(["mergeAbort", { threadId: "thread-1" }]);
  await expect(banner).toBeHidden();
});

async function enableLinkedRepositories(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    const repositories = [{ path: "/repo", primary: true }];
    const frontend = structuredClone(fixture.status);
    frontend.workspace = "/frontend";
    frontend.changes = [frontend.changes[0]];
    frontend.submodules = [];
    const selectedStatus = (repository?: string) => (repository ? frontend : fixture.status);
    const result = () => ({ project: "/repo", repositories: structuredClone(repositories) });
    const client = {
      ...fixture.client,
      listGitRepositories: async () => result(),
      linkGitRepository: (input: { repository: string }) => {
        fixture.calls.push(["link", input]);
        return new Promise((resolve) => {
          fixture.resolveLink = () => {
            repositories.push({ path: input.repository, primary: false });
            resolve(result());
          };
        });
      },
      unlinkGitRepository: async (input: { repository: string }) => {
        fixture.calls.push(["unlink", input]);
        repositories.splice(
          repositories.findIndex((entry) => entry.path === input.repository),
          1,
        );
        return result();
      },
      inspectGitStatus: async (input: { repository?: string }) =>
        structuredClone(selectedStatus(input.repository)),
      inspectGitContent: async (input: { path: string; repository?: string }) => ({
        ...(await fixture.client.inspectGitContent(input)),
        working: input.repository ? "frontend draft\n" : "backend draft\n",
      }),
      stageGitPaths: async (input: { repository?: string }) => {
        fixture.calls.push(["stage", input]);
        const status = selectedStatus(input.repository);
        status.changes[0].staged = true;
        status.changes[0].unstaged = false;
        return structuredClone(status);
      },
      commitGit: async (input: { repository?: string; push: boolean }) => {
        fixture.calls.push(["commit", input]);
        const status = selectedStatus(input.repository);
        status.changes = [];
        return {
          commit: "frontend-commit",
          pushed: input.push,
          output: "",
          status: structuredClone(status),
        };
      },
      pushGit: async (input: { repository?: string }) => {
        fixture.calls.push(["push", input]);
        return structuredClone(selectedStatus(input.repository));
      },
    };
    fixture.linkedClient = client;
    fixture.setContext("thread-1", client);
  });
}

test("links a frontend repository and scopes native review, staging, commit and push to it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await enableLinkedRepositories(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  const selector = root.getByRole("combobox", { name: "操作仓库" });
  await expect(selector).toHaveValue("");
  await root.getByRole("button", { name: "关联仓库", exact: true }).click();
  await root.getByRole("textbox", { name: "Git 仓库绝对路径" }).fill("/frontend");
  const link = root.locator('.codexhost-git-repositories button[type="submit"]');
  await link.evaluate((element) => {
    const form = (element as HTMLButtonElement).form;
    if (!form) throw new Error("Missing link form");
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(link).toHaveAttribute("aria-busy", "true");
  await expect(selector).toBeDisabled();
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "gitSidebarFixture").calls.filter(
        ([name]: string[]) => name === "link",
      ),
    ),
  ).toHaveLength(1);
  await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").resolveLink());
  await expect(selector).toHaveValue("/frontend");
  await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveAttribute(
    "title",
    "/frontend",
  );
  await root.locator('.codexhost-git-directory[title="src"]').click();
  await root.locator('.codexhost-git-change[title="src/app.ts"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls[0]?.descriptor.params
            .repositoryRoot,
      ),
    )
    .toBe("/frontend");
  await root
    .locator('.codexhost-git-change[title="src/app.ts"] .codexhost-git-change-action')
    .click();
  await expect(selector).toBeEnabled();
  const message = root.locator("[data-codexhost-git-sidebar-message]");
  await message.fill("frontend draft");
  await selector.selectOption("");
  await expect(message).toHaveValue("");
  await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveAttribute(
    "title",
    "/repo",
  );
  await expect(selector).toBeEnabled();
  await selector.selectOption("/frontend");
  await message.fill("feat: frontend only");
  await root.locator("[data-codexhost-git-sidebar-commit-push]").click();
  await expect(message).toHaveValue("");
  await root.locator("[data-codexhost-git-sidebar-push]").click();
  const calls = await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls);
  expect(calls).toContainEqual([
    "stage",
    { threadId: "thread-1", repository: "/frontend", paths: ["src/app.ts"] },
  ]);
  expect(calls).toContainEqual([
    "commit",
    {
      threadId: "thread-1",
      repository: "/frontend",
      message: "feat: frontend only",
      paths: [],
      push: true,
    },
  ]);
  expect(calls).toContainEqual(["push", { threadId: "thread-1", repository: "/frontend" }]);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.setContext("thread-2", fixture.linkedClient);
  });
  await expect(selector).toHaveValue("");
  await expect(selector).toBeEnabled();
  await selector.selectOption("/frontend");
  await root.getByRole("button", { name: "解除仓库关联" }).click();
  await expect(selector).toHaveValue("");
  await expect(selector.locator("option")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("uses IDEA-style stage and unstage actions without showing a misleading plus", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await root.locator("[data-codexhost-git-sidebar-tree]").click();

  const unstagedRow = root.locator('.codexhost-git-change[title="src/app.ts"]');
  await expect(unstagedRow.locator("[data-codexhost-git-sidebar-stage]")).toHaveAttribute(
    "data-action",
    "stage",
  );
  await expect(unstagedRow.locator("[data-codexhost-git-sidebar-stage]")).toHaveAttribute(
    "aria-label",
    "暂存",
  );
  await expect(unstagedRow.locator(".codexhost-git-status")).toHaveAttribute(
    "aria-label",
    "已修改",
  );
  await expect(unstagedRow.locator(".codexhost-git-status")).toHaveText("M");
  await expect(
    root.locator("[data-codexhost-git-sidebar-staged-tab] .codexhost-git-change-action"),
  ).toHaveCount(0);

  await unstagedRow.locator("[data-codexhost-git-sidebar-stage]").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual(["stage", { threadId: "thread-1", paths: ["src/app.ts"] }]);

  await root.locator("[data-codexhost-git-sidebar-staged-tab]").click();
  const stagedRow = root.locator('.codexhost-git-change[title="src/app.ts"]');
  await expect(stagedRow.locator("[data-codexhost-git-sidebar-unstage]")).toHaveAttribute(
    "data-action",
    "unstage",
  );
  await expect(stagedRow.locator("[data-codexhost-git-sidebar-unstage]")).toHaveAttribute(
    "aria-label",
    "取消暂存",
  );
  await expect(stagedRow.locator(".codexhost-git-status")).toHaveAttribute("aria-label", "已暂存");
  await expect(stagedRow.locator(".codexhost-git-status")).toHaveText("S");
});

test("shows initialized submodules as separate actionable repositories", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.status.submodules[0].status = "modified";
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();

  const group = root.locator('.codexhost-git-repository-group[data-repository="/repo/vendor/lib"]');
  await expect(group.locator(".codexhost-git-repository-name")).toHaveText("lib");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual(["status", { threadId: "thread-1", repository: "/repo/vendor/lib" }]);
  await group.locator(".codexhost-git-repository-header").click();
  const change = group.locator('.codexhost-git-repository-change[title="child.txt"]');
  await expect(change).toBeVisible();
  await change.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Reflect.get(globalThis, "gitSidebarFixture").nativeReviewCalls[0]?.descriptor.params
            .repositoryRoot,
      ),
    )
    .toBe("/repo/vendor/lib");

  await change.locator(".codexhost-git-change-action").click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "stage",
      { threadId: "thread-1", repository: "/repo/vendor/lib", paths: ["child.txt"] },
    ]);
  await group.getByRole("textbox", { name: "lib 提交消息" }).fill("fix: submodule child");
  await group.getByRole("button", { name: "提交", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls))
    .toContainEqual([
      "commit",
      {
        threadId: "thread-1",
        repository: "/repo/vendor/lib",
        message: "fix: submodule child",
        paths: [],
        push: false,
      },
    ]);
  expect(errors).toEqual([]);
});

test("remote draft shows its project name and supports commit without a thread", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    fixture.status.workspace = "/remote/remote_codex-host";
    fixture.setContext(
      null,
      fixture.client,
      "remote-ssh-discovered:okm252",
      fixture.status.workspace,
    );
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveText(
    "remote_codex-host",
  );
  await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveAttribute(
    "title",
    "/remote/remote_codex-host",
  );
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await page.screenshot({ path: "test-results/remote-draft-git-before.png" });
  await root.locator("[data-codexhost-git-sidebar-generate]").click();
  await expect(root.locator("[data-codexhost-git-sidebar-message]")).toHaveValue(
    "feat: generated commit",
  );
  await root.locator("[data-codexhost-git-sidebar-commit-push]").click();
  await expect(root.locator(".codexhost-git-empty")).toHaveText("没有待提交的变更");
  await page.screenshot({ path: "test-results/remote-draft-git-after.png" });
  const calls = await page.evaluate(() => Reflect.get(globalThis, "gitSidebarFixture").calls);
  for (const method of ["status", "generate", "stage", "commit"]) {
    expect(calls.find(([name]: [string]) => name === method)).toEqual([
      method,
      expect.objectContaining({ cwd: "/remote/remote_codex-host" }),
    ]);
  }
  expect(calls.every(([, input]: [string, object]) => !("threadId" in input))).toBe(true);
  expect(errors).toEqual([]);
});

test("switching draft projects ignores stale status and preserves the name on remote errors", async ({
  page,
}) => {
  await page.route("http://localhost/git-sidebar-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await setup(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "gitSidebarFixture");
    const Unavailable = Reflect.get(globalThis, "RendererMethodUnavailableError");
    let finish: () => void;
    const client = {
      ...fixture.client,
      inspectGitStatus: async ({ cwd }: { cwd: string }) => {
        if (cwd === "/remote/first") {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
        if (cwd === "/remote/unavailable")
          throw new Unavailable("codexhost/git/status", { code: -32601 });
        return { ...fixture.status, workspace: cwd };
      },
    };
    for (const [name, action] of [
      ["Second project", () => fixture.setContext(null, client, "remote", "/remote/second")],
      ["Complete first read", () => finish()],
      [
        "Unavailable project",
        () => fixture.setContext(null, client, "remote", "/remote/unavailable"),
      ],
      ["Clear project", () => fixture.setContext(null)],
    ] as const) {
      const button = document.createElement("button");
      button.textContent = name;
      button.addEventListener("click", action);
      document.querySelector("main")?.append(button);
    }
    fixture.setContext(null, client, "remote", "/remote/first");
  });
  const root = page.locator("[data-codexhost-git-sidebar]");
  const project = root.locator("[data-codexhost-git-sidebar-project]");
  await root.locator("[data-codexhost-git-sidebar-commits]").click();
  await expect(project).toHaveText("first");
  await expect(root.locator(".codexhost-git-empty")).toHaveText("正在读取项目…");
  await page.screenshot({ path: "test-results/remote-draft-git-loading.png" });
  await page.getByRole("button", { name: "Second project", exact: true }).click();
  await expect(project).toHaveText("second");
  await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeEnabled();
  await page.getByRole("button", { name: "Complete first read", exact: true }).click();
  await expect(project).toHaveText("second");
  await page.screenshot({ path: "test-results/remote-draft-git-switched.png" });
  await page.getByRole("button", { name: "Unavailable project", exact: true }).click();
  await expect(project).toHaveText("unavailable");
  await expect(
    root.locator(".codexhost-git-notice").filter({ hasText: "此连接未提供 Git 服务" }),
  ).toBeVisible();
  await expect(root.locator("[data-codexhost-git-sidebar-push]")).toBeDisabled();
  await page.screenshot({ path: "test-results/remote-draft-git-unavailable.png" });
  await page.getByRole("button", { name: "Clear project", exact: true }).click();
  await expect(project).toHaveText("未选择项目");
});

for (const hasThread of [false, true]) {
  test(`native SSH Git fallback restores project and commit controls (${hasThread ? "thread" : "draft"})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://localhost/git-sidebar-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      }),
    );
    await setup(page);
    await page.evaluate((thread) => {
      const f = Reflect.get(globalThis, "gitSidebarFixture");
      const hostId = "remote-ssh-discovered:okm252";
      const cwd = "/remote/remote_codex-host";
      f.status.workspace = cwd;
      f.status.submodules = [];
      f.status.changes = [f.status.changes[0]];
      f.sshCalls = [];
      const routes = new Map();
      routes.set(hostId, {
        hostId,
        manager: {
          async sendRequest(method: string, params: unknown) {
            f.sshCalls.push(["remote", method, params]);
            if (method === "thread/read") return { thread: { cwd } };
            throw { code: -32600, message: `Invalid request: unknown variant \`${method}\`` };
          },
        },
      });
      routes.set("local", {
        hostId: "local",
        manager: {
          async sendRequest(
            method: string,
            params: { hostId: string; method: string; params: Record<string, unknown> },
          ) {
            f.sshCalls.push(["local", method, params]);
            if (
              method !== "codexhost/ssh/git" ||
              params.hostId !== hostId ||
              params.params.cwd !== cwd ||
              "threadId" in params.params
            )
              throw new Error("Wrong SSH destination");
            switch (params.method) {
              case "codexhost/git/status":
                return structuredClone(f.status);
              case "codexhost/git/repositories":
                return { project: cwd, repositories: [{ path: cwd, primary: true }] };
              case "codexhost/git/message-models":
                return { models: [], defaultModel: null };
              case "codexhost/git/stage":
                return f.client.stageGitPaths(params.params);
              case "codexhost/git/commit":
                return f.client.commitGit(params.params);
              default:
                throw new Error(`Unexpected method ${params.method}`);
            }
          },
        },
      });
      const clients = Reflect.get(
        globalThis,
        "createRendererHostClients",
      )(() => ({ forHost: (id: string) => routes.get(id) ?? null }));
      f.setContext(
        thread ? "same-id-as-local-thread" : null,
        clients.forHost(hostId),
        hostId,
        thread ? undefined : cwd,
      );
    }, hasThread);
    const root = page.locator("[data-codexhost-git-sidebar]");
    await root.locator("[data-codexhost-git-sidebar-commits]").click();
    await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveText(
      "remote_codex-host",
    );
    await expect(root.locator("[data-codexhost-git-sidebar-project]")).toHaveAttribute(
      "title",
      "/remote/remote_codex-host",
    );
    await expect(root.locator("[data-codexhost-git-sidebar-generate]")).toBeDisabled();
    await root.locator("[data-codexhost-git-sidebar-message]").fill("fix: remote SSH commit");
    await expect(root.locator("[data-codexhost-git-sidebar-commit-push]")).toBeEnabled();
    await page.screenshot({
      path: `test-results/native-ssh-git-${hasThread ? "thread" : "draft"}.png`,
    });
    await root.locator("[data-codexhost-git-sidebar-commit-push]").click();
    await expect(root.locator(".codexhost-git-empty")).toHaveText("没有待提交的变更");
    const calls: [string, string, Record<string, unknown>][] = await page.evaluate(
      () => Reflect.get(globalThis, "gitSidebarFixture").sshCalls,
    );
    for (const method of ["status", "stage", "commit"]) {
      expect(calls).toContainEqual([
        "local",
        "codexhost/ssh/git",
        expect.objectContaining({
          hostId: "remote-ssh-discovered:okm252",
          method: `codexhost/git/${method}`,
          params: expect.objectContaining({ cwd: "/remote/remote_codex-host" }),
        }),
      ]);
    }
    expect(
      calls.filter(([origin, method]) => origin === "remote" && method === "thread/read").length >
        0,
    ).toBe(hasThread);
    expect(errors).toEqual([]);
  });
}
