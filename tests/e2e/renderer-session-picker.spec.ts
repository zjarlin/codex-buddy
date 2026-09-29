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
      let finishTargetCheck;
      const targetCheck = new Promise(resolve => { finishTargetCheck = resolve; });
      const main = document.querySelector('main');
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
        window.dispatchEvent(new CustomEvent('codexhost:draft-workspace', { detail: { hostId, cwd } }));
      });
      document.querySelector('#switch-host').addEventListener('click', () => { hostId = 'ssh:another'; });
      function mount(threadId, workspace) {
        cwd = workspace;
        window.__codexhostDraftWorkspacesV1 = { [hostId]: cwd };
        window.dispatchEvent(new CustomEvent('codexhost:draft-workspace', { detail: { hostId, cwd } }));
        const draftKey = threadId ?? 'draft-' + (++serial);
        main.innerHTML = '<div data-codex-composer-root style="position:relative;border:1px solid #555;padding:12px">' +
          (threadId ? '<div data-above-composer-portal data-above-composer-conversation-id="' + threadId + '"></div>' : '') +
          '<div data-codex-composer contenteditable="true" role="textbox" aria-label="Message" style="min-height:60px;white-space:pre-wrap"></div>' +
          (config.attachment ? '<div data-composer-attachments-row>attached.txt</div>' : '') +
          '<div><button id="send" type="submit">Send</button></div></div>';
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
        document.querySelector('#send').addEventListener('click', () => {
          globalThis.sends.push({ hostId, cwd, threadId, text: editor.innerText, attachment: config.attachment ?? false });
          if (!config.sendFails) { controller.view.dispatch({ text: '' }); }
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
          if (config.mode === 'failed') throw new Error('history unavailable');
          return { candidates: config.mode === 'empty' ? [] : [
            { threadId: targetId, title: 'Existing discussion', cwd: '/workspace/other', confidence: null, preview: 'Earlier message' },
            { threadId: sourceId, title: 'Source discussion', cwd: '/workspace/demo', confidence: null, preview: 'Source message' },
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
    <button id="finish-target-check">Finish target check</button>
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
const current = (page: Page) => page.getByRole("button", { name: /当前会话/ });
const picker = (page: Page) => page.getByRole("dialog", { name: "选择发送会话" });

for (const existing of [false, true]) {
  test(`${existing ? "existing conversation" : "new draft"}: two Enters send only to the current conversation`, async ({
    page,
  }, testInfo) => {
    await setup(page, { existing });
    await page.keyboard.press("Enter");
    await expect(picker(page)).toBeVisible();
    await expect(current(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /在 Other project 新建会话/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Existing discussion/ })).toBeVisible();
    expect(await sends(page)).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("picker.png"),
    });
    await page.keyboard.press("Enter");
    await expect(picker(page)).toHaveCount(0);
    expect(await sends(page)).toEqual([
      {
        hostId: "local",
        cwd: "/workspace/demo",
        threadId: existing ? sourceId : null,
        text: "继续这个任务\n保留第二行",
        attachment: false,
      },
    ]);
  });
}
for (const mode of ["empty", "failed", "unsupported", "pending"]) {
  test(`${mode}: never sends automatically and current remains available`, async ({ page }) => {
    await page.clock.install();
    await setup(page, { hostId: "ssh:macbook", mode, attachment: true });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(picker(page)).toBeVisible();
    await page.clock.runFor(5_100);
    expect(await sends(page)).toEqual([]);
    await current(page).click();
    expect(await sends(page)).toHaveLength(1);
    expect((await sends(page))[0].attachment).toBe(true);
    expect((await sends(page))[0].hostId).toBe("ssh:macbook");
  });
}

test("search never changes default; Escape preserves the original draft", async ({ page }) => {
  await setup(page, { existing: true });
  await page.keyboard.press("Enter");
  await page.getByRole("searchbox").fill("Existing discussion");
  await expect(current(page)).toHaveAttribute("aria-pressed", "true");
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
    await page.keyboard.press("Enter");
    await page.locator(`#switch-${change}`).click();
    await current(page).click();
    await expect(picker(page)).toContainText("会话、项目或 Host 已改变");
    expect(await sends(page)).toEqual([]);
  });
}

for (const existing of [false, true]) {
  for (const confirmation of ["Enter", "Send", "current"]) {
    test(`${existing ? "existing conversation" : "new draft"}: edit after Send then confirm via ${confirmation}`, async ({
      page,
    }, testInfo) => {
      await setup(page, { existing, mode: "pending" });
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(picker(page)).toBeVisible();
      const editor = page.getByRole("textbox", { name: "Message" });
      await editor.press("ControlOrMeta+End");
      await editor.pressSequentially(" 补充内容");
      expect(await sends(page)).toEqual([]);
      await expect(editor).toHaveText("继续这个任务\n保留第二行 补充内容", {
        useInnerText: true,
      });
      if (confirmation === "Enter") {
        await page.screenshot({
          path: testInfo.outputPath("edited-draft.png"),
        });
      }
      if (confirmation === "Enter") await editor.press("Enter");
      else if (confirmation === "Send") {
        await page.getByRole("button", { name: "Send", exact: true }).click();
      } else await current(page).click();
      await expect(picker(page)).toHaveCount(0);
      if (confirmation === "Enter") {
        await page.screenshot({
          path: testInfo.outputPath("sent-draft.png"),
        });
      }
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
}

for (const destination of ["existing", "new"]) {
  test(`edit before selecting ${destination} transfers the latest draft`, async ({ page }) => {
    await setup(page, { existing: true });
    await page.getByRole("button", { name: "Send", exact: true }).click();
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

test("editing during target verification preserves the draft and allows fresh confirmation", async ({
  page,
}) => {
  await setup(page, { existing: true, delayTargetCheck: true });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "targetReads"))).toBe(1);
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.fill("核对期间补充的正文");
  await editor.press("Enter");
  await page.getByRole("button", { name: "Finish target check" }).click();
  await expect(picker(page)).toContainText("草稿已变化");
  expect(await sends(page)).toEqual([]);
  await expect(editor).toHaveText("核对期间补充的正文");
  await editor.press("Enter");
  await expect.poll(() => sends(page)).toHaveLength(1);
  expect((await sends(page))[0]).toMatchObject({
    threadId: targetId,
    text: "核对期间补充的正文",
  });
});

test("repeated submit while verifying a target sends only once", async ({ page }) => {
  await setup(page, { existing: true, delayTargetCheck: true });
  await page.keyboard.press("Enter");
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

test("cleared draft can be edited again without reopening the picker", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Enter");
  const editor = page.getByRole("textbox", { name: "Message" });
  await editor.fill("");
  await current(page).click();
  await expect(picker(page)).toContainText("请输入消息后再发送");
  expect(await sends(page)).toEqual([]);
  await editor.fill("重新输入的正文");
  await editor.press("Enter");
  await expect(picker(page)).toHaveCount(0);
  expect(await sends(page)).toHaveLength(1);
  expect((await sends(page))[0].text).toBe("重新输入的正文");
});

for (const destination of ["existing", "new"]) {
  test(`transfer from an existing conversation to ${destination} target`, async ({ page }) => {
    await setup(page, { existing: true, hostId: "ssh:macbook" });
    await page.keyboard.press("Enter");
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
    await page.keyboard.press("Enter");
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
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start target" }).click();
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await expect(picker(page)).toContainText("已不处于完成状态");
  expect(await sends(page)).toEqual([]);
});

test("holding Enter does not confirm; a second distinct press sends during loading", async ({
  page,
}) => {
  await setup(page, { existing: true, mode: "pending" });
  await page.keyboard.down("Enter");
  await expect(picker(page)).toBeVisible();
  await page.keyboard.down("Enter");
  expect(await sends(page)).toEqual([]);
  await page.keyboard.up("Enter");
  await page.keyboard.press("Enter");
  expect(await sends(page)).toHaveLength(1);
  expect((await sends(page))[0].threadId).toBe(sourceId);
});

test("arrow navigation explicitly selects a project instead of the default", async ({ page }) => {
  await setup(page, { existing: true });
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /在 Other project 新建会话/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect.poll(() => sends(page)).toHaveLength(1);
  expect((await sends(page))[0]).toMatchObject({ threadId: null, cwd: "/workspace/other" });
});

test("unconfirmed target submission preserves the source and does not retry", async ({ page }) => {
  await page.clock.install();
  await setup(page, { existing: true, sendFails: true });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Existing discussion/ }).click();
  await page.clock.runFor(6_000);
  await expect(picker(page)).toContainText("尚未确认发送");
  expect(await sends(page)).toHaveLength(1);
  expect(await page.evaluate((id) => Reflect.get(globalThis, "drafts")[id], sourceId)).toBe(
    "继续这个任务\n保留第二行",
  );
  await page.keyboard.press("Enter");
  expect(await sends(page)).toHaveLength(1);
});
