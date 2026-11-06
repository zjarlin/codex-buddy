import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { openRendererThread } from "./packages/renderer-extension/src/renderer-fork-control.ts";
      import { installRendererLocalWorkspace } from "./packages/renderer-extension/src/renderer-local-workspace.ts";
      import { captureLocalWorkspaceContext, saveLocalWorkspaceContext } from "./packages/renderer-extension/src/local-workspace-context.ts";
      globalThis.setupLocalWorkspace = (mode) => {
        const sourceId = "7b249261-9be6-4562-8cea-555ed09455f1";
        const localId = "2b249261-9be6-4562-8cea-555ed09455f2";
        const source = { id: sourceId, cwd: "/remote/project", name: "Pagination", gitInfo: { repositoryUrl: "https://example.test/cached.git" }, turns: [{ items: [
          { type: "userMessage", content: [{ type: "text", text: "Keep pagination in the URL" }] },
          { type: "commandExecution", command: "git status", aggregatedOutput: "clean" }
        ] }] };
        if (mode === "offline") saveLocalWorkspaceContext(localStorage, captureLocalWorkspaceContext("ssh:mac", sourceId, source, 1000));
        const calls = [];
        const remote = { sendRequest: async (method, params) => {
          calls.push(["remote", method, params]);
          if (mode === "offline" || mode === "missing") throw new Error("disconnected");
          if (method === "codexhost/git/origin") return { remote: "https://example.test/project.git" };
          return { thread: source };
        } };
        const local = { sendRequest: async (method, params) => {
          calls.push(["local", method, params]);
          if (method === "codexhost/local-workspace/directories") return {
            project: "/local", path: params.path === "/local/chosen" ? "/local/chosen" : "/local", parent: "/",
            entries: params.path === "/local/chosen" ? [] : [{ name: "chosen", path: "/local/chosen" }], truncated: false
          };
          if (method === "codexhost/local-workspace/prepare") {
            if (mode === "clone-failure") throw new Error("Clone failed");
            return { path: params.path, cloned: true };
          }
          if (method === "thread/start") {
            if (mode === "start-failure") throw new Error("Create result unknown");
            return { thread: { id: localId } };
          }
          if (method === "turn/start") {
            if (mode === "turn-failure") throw new Error("Turn result unknown");
            return { turn: { id: "turn-1" } };
          }
          if (method === "project/list") return { data: [] };
          if (method === "project/import") {
            const row = document.createElement("button");
            const attrs = {
              "data-app-action-sidebar-thread-row": "true",
              "data-app-action-sidebar-thread-id": "local:" + localId,
              "data-app-action-sidebar-thread-host-id": "local"
            };
            for (const [key, value] of Object.entries(attrs)) row.setAttribute(key, value);
            row.__reactFiber$test = { memoizedProps: { conversationId: localId, dataAttributes: attrs }, return: null };
            row.onclick = () => { globalThis.localOpened = true; };
            document.body.append(row);
            return {};
          }
          throw new Error("Unexpected method: " + method);
        } };
        let target = { hostId: "ssh:mac", threadId: sourceId };
        const feature = installRendererLocalWorkspace({
          getActiveThread: () => target,
          getLocale: () => "zh-CN",
          getManager: (hostId) => hostId === "local" ? local : remote,
          openThread: (threadId) => openRendererThread(threadId, { hostId: "local" }),
        });
        feature.refresh();
        globalThis.localWorkspaceFixture = { calls, feature, switchLocal: () => { target = { hostId: "local", threadId: localId }; feature.refresh(); } };
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

async function setup(page: Page, mode: string): Promise<void> {
  await page.route("http://localhost/local-workspace-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><div data-app-shell-titlebar-content></div></body></html>",
    }),
  );
  await page.goto("http://localhost/local-workspace-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((value) => Reflect.get(globalThis, "setupLocalWorkspace")(value), mode);
  await page.getByRole("button", { name: "切回本地" }).click();
}

for (const mode of ["online", "offline"]) {
  test(`continues locally with ${mode} context`, async ({ page }) => {
    await setup(page, mode);
    const dialog = page.getByRole("dialog");
    if (mode === "offline") await expect(dialog.getByRole("status")).toContainText("使用本机缓存");
    await expect(dialog.getByRole("button", { name: "准备目录并续接" })).toBeEnabled();
    await expect(dialog.getByLabel("本地工作区绝对路径")).toHaveText("/remote/project");
    await expect(dialog.locator("input")).toHaveCount(0);
    await dialog.getByRole("button", { name: "准备目录并续接" }).click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => Reflect.get(globalThis, "localOpened"))).toBe(true);
    const calls = await page.evaluate(() => Reflect.get(globalThis, "localWorkspaceFixture").calls);
    expect(
      calls
        .filter(([host]: string[]) => host === "remote")
        .every(([, method]: string[]) => ["thread/read", "codexhost/git/origin"].includes(method)),
    ).toBe(true);
    expect(
      calls.find(([, method]: string[]) => method === "codexhost/local-workspace/prepare")[2],
    ).toEqual({
      path: "/remote/project",
      remote:
        mode === "offline" ? "https://example.test/cached.git" : "https://example.test/project.git",
    });
    const turn = calls.find(([, method]: string[]) => method === "turn/start");
    expect(turn[2].input[0].text).toContain("Keep pagination in the URL");
    expect(turn[2].input[0].text).toContain("Current workspace: /remote/project");
    if (mode === "offline") expect(turn[2].input[0].text).toContain("1970-01-01T00:00:01.000Z");
  });
}

test("blocks continuation when both remote and cached history are absent", async ({ page }) => {
  await setup(page, "missing");
  await expect(page.getByRole("status")).toContainText("没有可用缓存");
  await expect(page.getByRole("button", { name: "准备目录并续接" })).toBeDisabled();
});

test("does not create a chat when clone fails", async ({ page }) => {
  await setup(page, "clone-failure");
  await expect(page.getByRole("button", { name: "准备目录并续接" })).toBeEnabled();
  await page.getByRole("button", { name: "准备目录并续接" }).click();
  await expect(page.getByRole("status")).toContainText("Clone failed");
  await expect(page.getByRole("button", { name: "准备目录并续接" })).toBeEnabled();
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "localWorkspaceFixture").calls.some(
        ([, method]: string[]) => method === "thread/start",
      ),
    ),
  ).toBe(false);
});

test("retains the created chat and blocks duplicate creation after a turn failure", async ({
  page,
}) => {
  await setup(page, "turn-failure");
  await expect(page.getByRole("button", { name: "准备目录并续接" })).toBeEnabled();
  await page.getByRole("button", { name: "准备目录并续接" }).click();
  await expect(page.getByRole("status")).toContainText("Turn result unknown");
  await expect(page.getByRole("button", { name: "准备目录并续接" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "打开本地聊天" })).toBeVisible();
});

test("hides the action in local chats and disposes mounted UI", async ({ page }) => {
  await setup(page, "online");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(() => Reflect.get(globalThis, "localWorkspaceFixture").switchLocal());
  await expect(page.getByRole("button", { name: "切回本地" })).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "localWorkspaceFixture").feature.dispose());
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("does not retry an ambiguous creation request", async ({ page }) => {
  await setup(page, "start-failure");
  const submit = page.getByRole("button", { name: "准备目录并续接" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("status")).toContainText("创建请求结果尚未确认");
  await expect(submit).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        Reflect.get(globalThis, "localWorkspaceFixture").calls.filter(
          ([, method]: string[]) => method === "thread/start",
        ).length,
    ),
  ).toBe(1);
});

test("restores the action after the native titlebar remounts", async ({ page }) => {
  await setup(page, "online");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(() => {
    const original = document.querySelector("[data-app-shell-titlebar-content]");
    const replacement = document.createElement("div");
    replacement.setAttribute("data-app-shell-titlebar-content", "");
    original?.replaceWith(replacement);
  });
  await expect(page.getByRole("button", { name: "切回本地" })).toHaveCount(1);
  await page.getByRole("button", { name: "切回本地" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("changes the path only on picker confirmation and remembers explicit selection", async ({
  page,
}) => {
  await setup(page, "online");
  const choose = page.getByRole("button", { name: "选择本地目录…", exact: true });
  await expect(choose).toBeEnabled();
  const folder = page.getByLabel("本地工作区绝对路径");
  await choose.click();
  await page.getByRole("button", { name: "📁 chosen", exact: true }).click();
  await expect(page.getByRole("button", { name: "选择此目录", exact: true })).toBeEnabled();
  await expect(folder).toHaveText("/remote/project");
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await expect(folder).toHaveText("/remote/project");
  await choose.click();
  await page.getByRole("button", { name: "📁 chosen", exact: true }).click();
  await page.getByRole("button", { name: "选择此目录", exact: true }).click();
  await expect(folder).toHaveText("/local/chosen");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "切回本地", exact: true }).click();
  await expect(folder).toHaveText("/local/chosen");
  await page.getByRole("button", { name: "使用远程同一路径", exact: true }).click();
  await expect(folder).toHaveText("/remote/project");
});
