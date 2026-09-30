import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

const sourceId = "019ccb31-9520-7120-bc17-556e9a92d860";
const targetId = "019ccb31-9520-7120-bc17-556e9a92d861";
test.use({ locale: "zh-CN" });
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
    contents: `
      import { installRendererBindingProbe } from './packages/renderer-extension/src/renderer-binding-probe.ts';
      import { createRendererModelClient } from './packages/renderer-extension/src/renderer-model-client.ts';
      const config = globalThis.fixtureConfig;
      const sourceId = '${sourceId}', targetId = '${targetId}';
      let hostId = config.hostId ?? 'local';
      let cwd = '/workspace/demo';
      let serial = 0;
      let busyTarget = false;
      globalThis.sends = [];
      globalThis.drafts = {};
      globalThis.rankings = [];
      globalThis.targetReads = 0;
      globalThis.nativeRequests = [];
      let finishTargetCheck;
      const targetCheck = new Promise(resolve => { finishTargetCheck = resolve; });
      const main = document.querySelector('main');
      const publishWorkspace = (workspace) => {
        window.__codexhostDraftWorkspacesV1 = { [hostId]: workspace };
        window.dispatchEvent(new CustomEvent('codexhost:draft-workspace', { detail: { hostId, cwd: workspace } }));
      };
      const locationProps = () => ({
        composerMode: 'local', setComposerMode: () => {},
        ...(hostId === 'local'
          ? { executionTargetOverride: { hostId, cwd } }
          : { remoteSelectionState: { isAttachedToStartedTask: false, draftNewThreadRemoteSelectionState: { hostId, projectPath: cwd } } }),
      });
      const project = { projectKind: hostId === 'local' ? 'local' : 'remote', hostId, projectId: 'other', path: '/workspace/other', label: 'Other project' };
      const row = document.querySelector('#project');
      row.setAttribute('data-sidebar-project-kind', project.projectKind);
      const projectProps = { group: project, canStartNewThread: true, onStartNewThread: () => mount(null, project.path) };
      row.__reactFiber$fixture = { memoizedProps: projectProps, return: null };
      document.querySelector('#new').__reactFiber$fixture = { memoizedProps: projectProps, return: row.__reactFiber$fixture };
      document.querySelector('#new').addEventListener('click', projectProps.onStartNewThread);
      const targetRow = document.querySelector('#target');
      const dataAttributes = {
        'data-app-action-sidebar-thread-row': 'true',
        'data-app-action-sidebar-thread-id': targetId,
        'data-app-action-sidebar-thread-host-id': hostId,
      };
      for (const [key,value] of Object.entries(dataAttributes)) targetRow.setAttribute(key,value);
      targetRow.__reactFiber$fixture = { memoizedProps: { conversationId: targetId, hostId, dataAttributes }, return: null };
      targetRow.addEventListener('click', () => mount(targetId, project.path));
      document.querySelector('#busy').addEventListener('click', () => { busyTarget = true; });
      document.querySelector('#finish-target-check').addEventListener('click', () => finishTargetCheck());
      document.querySelector('#switch-project').addEventListener('click', () => {
        cwd = '/other/project';
        main.querySelector('#location').__reactFiber$fixture.memoizedProps = locationProps();
        if (!config.delayWorkspace) publishWorkspace(cwd);
      });
      document.querySelector('#background-prewarm').addEventListener('click', () => publishWorkspace('/workspace/official-app'));
      document.querySelector('#switch-host').addEventListener('click', () => { hostId = 'ssh:another'; });
      function mount(threadId, workspace) {
        cwd = workspace;
        publishWorkspace(config.staleWorkspace ? '/workspace/official-app' : cwd);
        const draftKey = threadId ?? 'draft-' + (++serial);
        const composerThreadId = config.scopedCurrentThreadId && threadId ? hostId + ':' + threadId : threadId;
        main.innerHTML = '<div data-codex-composer-root style="position:relative;border:1px solid #555;padding:12px">' +
          (threadId ? '<div data-above-composer-portal data-above-composer-conversation-id="' + composerThreadId + '"></div>' : '') +
          '<div data-codex-composer contenteditable="true" role="textbox" aria-label="Message" style="min-height:60px;white-space:pre-wrap"></div>' +
          (config.attachment ? '<div data-composer-attachments-row>attached.txt</div>' : '') +
          '<div><button id="location" type="button">Project location</button><button id="send" type="submit">Send</button></div></div>';
        if (!config.missingWorkspace) main.querySelector('#location').__reactFiber$fixture = { memoizedProps: locationProps(), return: null };
        const editor = main.querySelector('[contenteditable]');
        editor.innerText = globalThis.drafts[draftKey] ?? (threadId === targetId ? config.targetDraft ?? '' : '');
        const makeDoc = (text) => ({ text, content: { size: text.length }, type: { createAndFill: () => makeDoc('') }, textBetween: (from,to) => text.slice(from,to) });
        const state = { doc: makeDoc(editor.innerText), schema: { nodes: {} }, selection: { from: 0, to: 0 }, get tr() { return { insertText: text => ({ text }), delete: () => ({ text: '' }) }; } };
        const save = doc => { globalThis.drafts[draftKey] = doc.text; };
        const controller = { view: { dom: editor, state, posAtDOM: () => 0, dispatch: action => { state.doc = makeDoc(action.text); editor.innerText = action.text; save(state.doc); } }, insertMentionNodeInRange: () => {} };
        const atom = { atom: {}, get: () => ({ isManuallyChanged: false, modelSettings: null, serviceTier: null }), set: () => {} };
        editor.__reactFiber$fixture = { memoizedProps: { composerController: controller, initialDocument: undefined, onDocumentChange: save }, updateQueue: { memoCache: { data: threadId ? [] : [
          [undefined, atom, atom], [{}, {}, 'client-new-thread:' + draftKey, atom, undefined, atom, atom],
        ] } }, return: null };
        editor.addEventListener('input', () => { state.doc = makeDoc(editor.innerText); save(state.doc); });
        editor.addEventListener('input', () => { if (!editor.innerText.trim()) editor.innerText = ''; });
        document.querySelector('#send').addEventListener('click', () => {
          globalThis.sends.push({ hostId, cwd, threadId, text: editor.innerText, attachment: config.attachment ?? false });
          if (!config.sendFails) { controller.view.dispatch({ text: '' }); }
        });
        editor.addEventListener('keydown', event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            document.querySelector('#send').click();
          }
        });
      }
      mount(config.existing ? sourceId : null, cwd);
      const policy = { state: 'ready', hostId, select: async () => {}, clear: async () => {} };
      const manager = {
        getConversationCwd: id => id === sourceId ? '/workspace/demo' : '/workspace/other',
        sendRequest: async () => {
          globalThis.targetReads++;
          if (config.delayTargetCheck) await targetCheck;
          return { thread: { id: targetId, cwd: '/workspace/other', status: { type: busyTarget ? 'active' : 'idle' }, turns: [{ status: 'completed' }] } };
        },
      };
      window.__codexhostHostRoutingV1 = { forComposer: () => ({ hostId, policy }), forHost: () => ({ hostId, policy, manager }) };
      const unused = async () => { throw new Error('unused fixture capability'); };
      const client = {
        currentHostId: () => hostId, clientForHost: () => client,
        ...(config.mode === 'unsupported' ? {} : { routeSession: async params => {
          globalThis.rankings.push(params);
          if (config.mode === 'pending') return new Promise(() => {});
          if (config.candidateDelay) await new Promise(resolve => setTimeout(resolve, config.candidateDelay));
          if (config.mode === 'failed') throw new Error('history unavailable');
          return { candidates: config.mode === 'empty' ? [] : [
            { threadId: targetId, title: 'Existing discussion', cwd: '/workspace/other', confidence: null, preview: 'Earlier message' },
            { threadId: config.scopedCandidateThreadId ? hostId + ':' + sourceId : sourceId, title: 'Source discussion', cwd: '/workspace/demo', confidence: null, preview: 'Source message' },
            ...Array.from({ length: config.extraCandidates ?? 0 }, (_, index) => ({
              threadId: '019ccb31-9520-7120-bc17-556e9a92d9' + String(index).padStart(2, '0'),
              title: 'Older discussion ' + index, cwd: '/workspace/other', confidence: null, preview: 'Earlier message',
            })),
          ], reason: 'fixture' };
        } }),
        inspectThread: async () => ({ owner: 'codex', locked: true }),
        listThreadOwnership: async ({ threadIds }) => ({ threads: threadIds.map(threadId => ({ threadId, owner: 'codex' })) }),
        inspectThreadUsage: async () => ({ threadId: sourceId, usage: null, accountCredits: null }),
        inspectThreadCommands: async () => ({ commands: [] }),
        inspectHarness: unused, forkThread: unused,
        selectThreadModel: unused, selectThreadThinking: unused, selectThreadPermissionMode: unused,
        checkUpdate: unused, startUpdate: unused, readUpdateStatus: unused,
      };
      if (config.mode === 'native') {
        client.routeSession = createRendererModelClient([{ sendRequest: async (method, params) => {
          globalThis.nativeRequests.push(method);
          if (method === 'codexhost/session/route') {
            throw Object.assign(new Error('method not found'), { code: -32601 });
          }
          if (method === 'thread/list') {
            return { data: [{ id: targetId, cwd: project.path, name: 'Native remote discussion' }] };
          }
          if (method === 'thread/turns/list' && params.threadId === targetId) {
            return { data: [{ status: 'completed' }] };
          }
          throw new Error('Unexpected native request: ' + method);
        } }]).routeSession;
      }
      const binding = installRendererBindingProbe({ enabledAgents: ['codex'], defaultAgent: 'codex' });
      binding.setAdapter({ state: 'ready', reason: 'fixture', modelUpdates: 0, hook: 'model-state' }, undefined, () => true, client);
    `,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2024",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  write: false,
});
const bundle = (() => {
  const source = outputFiles[0]?.text;
  if (!source) throw new Error("Session picker fixture did not build");
  return source;
})();
async function setup(page: Page, config: Record<string, unknown> = {}) {
  await page.route("http://picker.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body style="background:#202124;color:#eee;color-scheme:dark;padding:24px">
    <button id="switch-project">Switch project</button><button id="switch-host">Switch Host</button><button id="busy">Start target</button>
    <button id="finish-target-check">Finish target check</button><button id="background-prewarm">Background prewarm</button>
    <aside><div id="project" role="listitem" data-sidebar-project-container-id="project:other"><button id="new">New project chat</button></div><button id="target">Open target</button></aside>
    <main style="margin-top:440px"></main></body>`,
    }),
  );
  await page.goto("http://picker.test/");
  await page.evaluate((value) => Reflect.set(globalThis, "fixtureConfig", value), config);
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("[data-codexhost-agent-control]")).toBeAttached();
  await page.getByRole("textbox", { name: "Message" }).fill("继续这个任务\n保留第二行");
}
const sends = (page: Page) => page.evaluate(() => Reflect.get(globalThis, "sends"));
const transfer = (page: Page) => page.getByRole("button", { name: "发送到其他会话或项目" });
const picker = (page: Page) => page.getByRole("dialog", { name: "发送到其他会话" });
const closePicker = (page: Page) => picker(page).getByRole("button", { name: "关闭" });

test("completed conversations lead, new conversations follow, and the header closes the picker", async ({
  page,
}) => {
  await setup(page, { existing: true });
  await transfer(page).click();
  const panel = picker(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("继续已完成会话", { exact: true })).toBeVisible();
  await expect(panel.getByText("新建会话", { exact: true })).toBeVisible();
  const headings = await panel.locator(".codexhost-session-picker-heading").allTextContents();
  expect(headings.indexOf("继续已完成会话")).toBeLessThan(headings.indexOf("新建会话"));
  await closePicker(page).click();
  await expect(panel).toHaveCount(0);
  expect(await sends(page)).toEqual([]);
});

test("Escape closes the picker even when focus moves outside it", async ({ page }) => {
  await setup(page, { existing: true });
  await transfer(page).click();
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
  expect(await sends(page)).toEqual([]);
});

for (const config of [
  { hostId: "local" },
  { hostId: "remote-ssh-discovered:okm252" },
  { hostId: "remote-ssh-discovered:okm252", scopedCurrentThreadId: true },
  { hostId: "remote-ssh-discovered:okm252", scopedCandidateThreadId: true },
]) {
  test(`recent conversations exclude the current conversation: ${JSON.stringify(config)}`, async ({
    page,
  }, testInfo) => {
    await setup(page, { existing: true, ...config });
    await transfer(page).click();
    await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Source discussion/ })).toHaveCount(0);
    await page.getByRole("searchbox").fill("Source discussion");
    await expect(page.getByRole("button", { name: /Source discussion/ })).toHaveCount(0);
    await expect(picker(page)).toContainText("没有匹配的发送目标");
    await page.screenshot({ path: testInfo.outputPath("current-excluded.png") });
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);
    expect(await sends(page)).toEqual([]);
  });
}

test("a new draft still lists other conversations in its project", async ({ page }) => {
  await setup(page);
  await transfer(page).click();
  await expect(page.getByRole("button", { name: /Source discussion/ })).toBeVisible();
});

for (const hostId of ["local", "remote-ssh-discovered:okm252"]) {
  test(`current project uses the composer instead of another prewarmed project: ${hostId}`, async ({
    page,
  }, testInfo) => {
    await setup(page, { hostId, staleWorkspace: true });
    await transfer(page).click();
    await page.screenshot({ path: testInfo.outputPath("current-project.png") });
    expect(await page.evaluate(() => Reflect.get(globalThis, "rankings")[0].cwd)).toBe(
      "/workspace/demo",
    );
    await page.keyboard.press("Escape");
    expect(await sends(page)).toEqual([]);
  });
}

test("background prewarm cannot invalidate the current project", async ({ page }) => {
  await setup(page, { hostId: "remote-ssh-discovered:okm252" });
  await transfer(page).click();
  await page.getByRole("button", { name: "Background prewarm" }).click();
  await page.keyboard.press("Escape");
  expect(await sends(page)).toEqual([]);
});

test("project changes invalidate explicit transfer before prewarm catches up", async ({ page }) => {
  await setup(page, { delayWorkspace: true });
  await transfer(page).click();
  await page.getByRole("button", { name: "Switch project" }).click();
  await page.getByRole("button", { name: /在 Other project 新建会话/ }).click();
  await expect(picker(page)).toContainText("会话、项目或 Host 已改变");
  expect(await sends(page)).toEqual([]);
});

test("unknown project never borrows a cached directory", async ({ page }) => {
  await setup(page, { missingWorkspace: true, staleWorkspace: true });
  await transfer(page).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "rankings")[0].cwd)).toBeUndefined();
  await page.keyboard.press("Escape");
  expect(await sends(page)).toEqual([]);
});

for (const existing of [false, true]) {
  test(`${existing ? "existing conversation" : "new draft"}: Enter sends directly and explicit transfer offers other targets`, async ({
    page,
  }, testInfo) => {
    await setup(page, { existing });
    await page.keyboard.press("Enter");
    expect(await sends(page)).toEqual([
      {
        hostId: "local",
        cwd: "/workspace/demo",
        threadId: existing ? sourceId : null,
        text: "继续这个任务\n保留第二行",
        attachment: false,
      },
    ]);
    await page.getByRole("textbox", { name: "Message" }).fill("继续这个任务\n保留第二行");
    await transfer(page).click();
    await expect(picker(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /在 Other project 新建会话/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeVisible();
    expect(await sends(page)).toHaveLength(1);
    await page.screenshot({
      path: testInfo.outputPath("picker.png"),
    });
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);
  });
}
test("native SSH history remains selectable without Host extensions", async ({
  page,
}, testInfo) => {
  await setup(page, { existing: true, hostId: "remote-ssh-discovered:cloud", mode: "native" });
  await transfer(page).click();
  const target = page.getByRole("button", { name: /Native remote discussion/ });
  await expect(target).toBeVisible();
  await expect(picker(page)).not.toContainText("近期会话暂不可用");
  expect(await sends(page)).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "nativeRequests"))).toEqual([
    "codexhost/session/route",
    "thread/list",
    "thread/turns/list",
  ]);
  await page.screenshot({ path: testInfo.outputPath("native-ssh-history.png") });
  await target.click();
  await expect.poll(() => sends(page)).toHaveLength(1);
  expect((await sends(page))[0]).toMatchObject({
    hostId: "remote-ssh-discovered:cloud",
    threadId: targetId,
    cwd: "/workspace/other",
  });
});

test("slow history remains available when it arrives after five seconds", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await setup(page, { existing: true, hostId: "ssh:macbook", candidateDelay: 6_000 });
  await transfer(page).click();
  await page.clock.runFor(5_100);
  await expect(picker(page)).toContainText("近期会话加载较慢，仍在读取");
  await page.screenshot({ path: testInfo.outputPath("slow-history.png") });
  await page.clock.runFor(1_000);
  await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeVisible();
  await expect(picker(page)).not.toContainText("仍在读取");
  expect(await sends(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("history-loaded.png") });
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect.poll(() => sends(page)).toHaveLength(1);
  expect((await sends(page))[0]).toMatchObject({
    hostId: "ssh:macbook",
    threadId: targetId,
    text: "继续这个任务\n保留第二行",
  });
});

test("a slow history failure replaces the loading notice", async ({ page }) => {
  await page.clock.install();
  await setup(page, { mode: "failed", candidateDelay: 6_000 });
  await transfer(page).click();
  await page.clock.runFor(5_100);
  await expect(picker(page)).toContainText("近期会话加载较慢，仍在读取");
  await page.clock.runFor(1_000);
  await expect(picker(page)).toContainText("近期会话暂不可用");
  await expect(picker(page)).not.toContainText("仍在读取");
  expect(await sends(page)).toEqual([]);
});

test("late history cannot reopen a picker cancelled while loading", async ({ page }) => {
  await page.clock.install();
  await setup(page, { candidateDelay: 6_000 });
  await transfer(page).click();
  await page.clock.runFor(5_100);
  await page.keyboard.press("Escape");
  await page.clock.runFor(1_000);
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveText(
    "继续这个任务\n保留第二行",
    { useInnerText: true },
  );
  expect(await sends(page)).toEqual([]);
});

for (const mode of ["empty", "failed", "unsupported", "pending"]) {
  test(`${mode}: explicit transfer never sends automatically`, async ({ page }) => {
    await page.clock.install();
    await setup(page, { hostId: "ssh:macbook", mode, attachment: true });
    await transfer(page).click();
    await expect(picker(page)).toBeVisible();
    await page.clock.runFor(5_100);
    expect(await sends(page)).toEqual([]);
  });
}

test("search stays inside explicit transfer; Escape preserves the original draft", async ({
  page,
}) => {
  await setup(page, { existing: true });
  await transfer(page).click();
  await page.getByRole("searchbox").fill("Existing discussion");
  await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveText("继续这个任务\n保留第二行", {
    useInnerText: true,
  });
  expect(await sends(page)).toEqual([]);
});

for (const change of ["project", "host"]) {
  test(`stale ${change} cannot submit`, async ({ page }) => {
    await setup(page);
    await transfer(page).click();
    await page.locator(`#switch-${change}`).click();
    await page.getByRole("button", { name: /在 Other project 新建会话/ }).click();
    await expect(picker(page)).toContainText("会话、项目或 Host 已改变");
    expect(await sends(page)).toEqual([]);
  });
}

for (const existing of [false, true]) {
  test(`${existing ? "existing conversation" : "new draft"}: editing while transfer is open does not affect direct send`, async ({
    page,
  }) => {
    await setup(page, { existing, mode: "pending" });
    await transfer(page).click();
    await expect(picker(page)).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Message" });
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially(" 补充内容");
    expect(await sends(page)).toEqual([]);
    await expect(editor).toHaveText("继续这个任务\n保留第二行 补充内容", {
      useInnerText: true,
    });
    await editor.press("Enter");
    await expect(picker(page)).toHaveCount(0);
    expect(await sends(page)).toEqual([
      {
        hostId: "local",
        cwd: "/workspace/demo",
        threadId: existing ? sourceId : null,
        text: "继续这个任务\n保留第二行 补充内容",
        attachment: false,
      },
    ]);
  });
}

for (const destination of ["existing", "new"]) {
  test(`edit before selecting ${destination} transfers the latest draft`, async ({ page }) => {
    await setup(page, { existing: true });
    await transfer(page).click();
    await page.getByRole("textbox", { name: "Message" }).fill("改过的正文\n补充内容");
    await page
      .getByRole("button", {
        name: destination === "existing" ? /Existing discussion/ : /在 Other project 新建会话/,
      })
      .click();
    await expect.poll(() => sends(page)).toHaveLength(1);
    expect((await sends(page))[0]).toMatchObject({
      cwd: "/workspace/other",
      threadId: destination === "existing" ? targetId : null,
      text: "改过的正文\n补充内容",
    });
    expect(await page.evaluate((id) => Reflect.get(globalThis, "drafts")[id], sourceId)).toBe("");
  });
}

test("editing during target verification preserves the draft and allows retry", async ({
  page,
}) => {
  await setup(page, { existing: true, delayTargetCheck: true });
  await transfer(page).click();
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "targetReads"))).toBe(1);
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.fill("核对期间补充的正文");
  await editor.press("Enter");
  await page.getByRole("button", { name: "Finish target check" }).click();
  await expect(picker(page)).toContainText("草稿已变化");
  expect(await sends(page)).toEqual([]);
  await expect(editor).toHaveText("核对期间补充的正文");
  await transfer(page).click();
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect.poll(() => sends(page)).toHaveLength(1);
  expect((await sends(page))[0]).toMatchObject({
    threadId: targetId,
    text: "核对期间补充的正文",
  });
});

test("repeated submit while verifying a target sends only once", async ({ page }) => {
  await setup(page, { existing: true, delayTargetCheck: true });
  await transfer(page).click();
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.press("Enter");
  await editor.press("Enter");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "targetReads"))).toBe(1);
  expect(await sends(page)).toEqual([]);
  await page.getByRole("button", { name: "Finish target check" }).click();
  await expect.poll(() => sends(page)).toHaveLength(1);
  await expect(picker(page)).toHaveCount(0);
});

test("empty transfer reports an error and keeps direct editing available", async ({ page }) => {
  await setup(page);
  await transfer(page).click();
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.fill("");
  await page.getByRole("button", { name: /在 Other project 新建会话/ }).click();
  await expect(picker(page)).toContainText("请输入消息后再发送");
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveText("");
  expect(await sends(page)).toEqual([]);
  await editor.fill("重新输入的正文");
  await editor.press("Enter");
  expect((await sends(page))[0]?.text).toBe("重新输入的正文");
});

test("empty existing-conversation transfer reports an error and preserves the draft (legacy coverage)", async ({
  page,
}) => {
  await setup(page, { existing: true });
  await transfer(page).click();
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.fill("");
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect(picker(page)).toContainText("请输入消息后再发送");
  expect(await sends(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
});

for (const destination of ["existing", "new"]) {
  test(`transfer from an existing conversation to ${destination} target`, async ({ page }) => {
    await setup(page, { existing: true, hostId: "ssh:macbook", staleWorkspace: true });
    await transfer(page).click();
    await page
      .getByRole("button", {
        name: destination === "existing" ? /Existing discussion/ : /在 Other project 新建会话/,
      })
      .click();
    await expect.poll(() => sends(page)).toHaveLength(1);
    expect((await sends(page))[0]).toMatchObject({
      hostId: "ssh:macbook",
      cwd: "/workspace/other",
      threadId: destination === "existing" ? targetId : null,
      text: "继续这个任务\n保留第二行",
    });
    await expect(picker(page)).toHaveCount(0);
    expect(await page.evaluate((id) => Reflect.get(globalThis, "drafts")[id], sourceId)).toBe("");
  });
}

for (const config of [{ targetDraft: "Unsent target draft" }, { attachment: true }]) {
  test(`unsafe transfer preserves drafts: ${JSON.stringify(config)}`, async ({ page }) => {
    await setup(page, { existing: true, ...config });
    await transfer(page).click();
    await page.getByRole("button", { name: /Existing discussion/ }).click();
    await expect(picker(page)).toContainText("发送失败");
    expect(await sends(page)).toEqual([]);
    expect(await page.evaluate((id) => Reflect.get(globalThis, "drafts")[id], sourceId)).toBe(
      "继续这个任务\n保留第二行",
    );
  });
}

test("a target that starts running after listing cannot receive the draft", async ({ page }) => {
  await setup(page, { existing: true });
  await transfer(page).click();
  await page.getByRole("button", { name: "Start target" }).click();
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect(picker(page)).toContainText("已不处于完成状态");
  expect(await sends(page)).toEqual([]);
});

test("holding Enter does not repeat a direct send", async ({ page }) => {
  await setup(page, { existing: true, mode: "pending" });
  await page.keyboard.down("Enter");
  await expect.poll(() => sends(page)).toHaveLength(1);
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  expect(await sends(page)).toHaveLength(1);
  expect(picker(page)).toHaveCount(0);
});

test("arrow navigation explicitly selects a transfer project", async ({ page }) => {
  await setup(page, { existing: true });
  await transfer(page).click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /在 Other project 新建会话/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect.poll(() => sends(page)).toHaveLength(1);
  expect((await sends(page))[0]).toMatchObject({ threadId: null, cwd: "/workspace/other" });
});

test("history refresh preserves keyboard confirmation of a focused project", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await setup(page, { existing: true, candidateDelay: 1_000 });
  await transfer(page).click();
  const project = page.getByRole("button", { name: /在 Other project 新建会话/ });
  await project.focus();
  await expect(project).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("focused-project.png") });
  await page.clock.runFor(1_100);
  await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeVisible();
  await expect(project).toBeFocused();
  await expect(project).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await page.clock.runFor(200);
  await page.screenshot({ path: testInfo.outputPath("confirmed-project.png") });
  await expect(picker(page)).toHaveCount(0);
  expect(await sends(page)).toMatchObject([{ threadId: null, cwd: "/workspace/other" }]);
});

test("failed project selection keeps the reason visible and keyboard recovery available", async ({
  page,
}, testInfo) => {
  await setup(page, { existing: true, attachment: true, extraCandidates: 16 });
  await transfer(page).click();
  await expect(page.getByRole("button", { name: /Older discussion 15/ })).toBeAttached();
  await page.screenshot({ path: testInfo.outputPath("attachment-picker.png") });
  await page.getByRole("button", { name: /在 Other project 新建会话/ }).click();
  const status = picker(page).getByRole("status");
  await expect(status).toContainText("含附件、引用或格式的草稿暂不能跨会话发送");
  await page.screenshot({ path: testInfo.outputPath("attachment-transfer-error.png") });
  await expect(status).toBeInViewport({ ratio: 1 });
  expect(await sends(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  expect(await sends(page)).toEqual([]);
});

test("history updates preserve transfer errors without stealing composer focus", async ({
  page,
}) => {
  await page.clock.install();
  await setup(page, { existing: true, attachment: true, candidateDelay: 1_000 });
  await transfer(page).click();
  await page.getByRole("button", { name: /在 Other project 新建会话/ }).click();
  const status = picker(page).getByRole("status");
  await expect(status).toContainText("草稿暂不能跨会话发送");
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.click();
  await page.clock.runFor(1_100);
  await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeAttached();
  await expect(status).toContainText("草稿暂不能跨会话发送");
  await expect(editor).toBeFocused();
  expect(await sends(page)).toEqual([]);
});

test("unconfirmed target submission preserves the source and does not retry", async ({ page }) => {
  await page.clock.install();
  await setup(page, { existing: true, sendFails: true });
  await transfer(page).click();
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await page.clock.runFor(6_000);
  await expect(picker(page)).toContainText("尚未确认发送");
  expect(await sends(page)).toHaveLength(1);
  expect(await page.evaluate((id) => Reflect.get(globalThis, "drafts")[id], sourceId)).toBe(
    "继续这个任务\n保留第二行",
  );
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await page.clock.runFor(6_000);
  expect(await sends(page)).toHaveLength(1);
});
