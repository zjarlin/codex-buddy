import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// 100 毫秒 PCM WAV，交给真实浏览器解码和播放，不替换 play()。
const wave = Buffer.alloc(44 + 1_600);
wave.write("RIFF", 0);
wave.writeUInt32LE(wave.length - 8, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8_000, 24);
wave.writeUInt32LE(16_000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(1_600, 40);

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { PendingConfirmationsModel, PENDING_CONFIRMATIONS_STORAGE_KEY } from "./packages/renderer-extension/src/pending-confirmations-state.ts";
      import { installRendererPendingConfirmations } from "./packages/renderer-extension/src/renderer-pending-confirmations.ts";
      import { installRendererThreadReturn } from "./packages/renderer-extension/src/renderer-thread-return.ts";
      import { createRendererSpeechAnnouncer } from "./packages/renderer-extension/src/renderer-speech.ts";
      import { readRendererSpeechEnabled } from "./packages/renderer-extension/src/renderer-speech-preference.ts";
      import { createRendererHostClients } from "./packages/renderer-extension/src/renderer-host-clients.ts";
      import { BUDDY_SPEECH_METHOD } from "@codexhost/shared-contracts";

      const NativeAudio = Audio;
      globalThis.Audio = function(source) {
        const audio = new NativeAudio(source);
        for (const name of ["playing", "ended", "error"]) {
          audio.addEventListener(name, () => globalThis.speech.audioEvents.push(name));
        }
        return audio;
      };

      globalThis.setupPendingConfirmations = (hostId = "local", clear = true) => {
        if (clear) localStorage.clear();
        document.body.innerHTML = \`
          <aside id="app-shell-sidebar">
            <section data-sidebar-project-container-id="project:one">
              <button data-app-action-sidebar-project-row data-app-action-sidebar-project-label="Project">Project</button>
              <button data-app-action-sidebar-thread-row data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-id="local:thread-a" data-app-action-sidebar-thread-active="true">
                <span data-thread-title-trigger><span data-thread-title>Task A</span></span>
              </button>
              <button data-app-action-sidebar-thread-row data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-id="local:thread-b" data-app-action-sidebar-thread-active="false">
                <span data-thread-title-trigger><span data-thread-title>Task B</span></span>
              </button>
            </section>
          </aside>
        \`;
        for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
          row.dataset.appActionSidebarThreadHostId = hostId;
          row.dataset.appActionSidebarThreadId = hostId + ":" + row.dataset.appActionSidebarThreadId.slice("local:".length);
          const attrs = {
            "data-app-action-sidebar-thread-row": "",
            "data-app-action-sidebar-thread-host-id": row.dataset.appActionSidebarThreadHostId,
            "data-app-action-sidebar-thread-id": row.dataset.appActionSidebarThreadId,
          };
          const threadId = row.dataset.appActionSidebarThreadId.slice(hostId.length + 1);
          row.__reactFiber$fixture = {
            memoizedProps: {
              conversationId: threadId,
              dataAttributes: attrs,
              statusState: { type: "idle", unread: false },
            },
          };
          row.addEventListener("click", () => {
            for (const candidate of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
              candidate.dataset.appActionSidebarThreadActive = String(candidate === row);
            }
          });
        }
        const callbacks = [];
        const requests = [];
        const opened = [];
        const sent = [];
        globalThis.sentMessages = sent;
        localStorage.setItem("codexhost.model-favorites.v1:codex", JSON.stringify(["gpt-5.6"]));
        const client = {
          synthesizeSpeech: async (input) => {
            globalThis.speech.synthesized.push(input);
            if (globalThis.speech.failure) throw new Error(globalThis.speech.failure);
            return { audioBase64: ${JSON.stringify(wave.toString("base64"))}, format: "wav", characters: input.text.length, latencyMs: 1 };
          },
          inspectThread: async () => ({ owner: "codex", locked: true }),
          requestThreadProjection: async (method, params) => {
            requests.push([method, params]);
            return {};
          },
          sendThreadMessage: async (threadId, text, model) => {
            sent.push([threadId, text, model]);
            return "turn-follow-up";
          },
        };
        // A stable manager identity: connect() drops callbacks from a replaced
        // manager, so returning a fresh object per call would silence the fixture.
        const manager = { addNotificationCallback(methods, callback) {
          callbacks.push(callback);
          return () => {};
        }};
        const announced = [];
        const replayed = [];
        const speechRequests = [];
        const local = { hostId: "local", manager: { sendRequest(method, params) {
          speechRequests.push(["local", method, params]);
          if (method === BUDDY_SPEECH_METHOD) return client.synthesizeSpeech(params);
          throw new Error("Unexpected local fixture method: " + method);
        }} };
        const remote = { hostId, manager: { sendRequest(method, params) {
          speechRequests.push([hostId, method, params]);
          throw { code: -32600, message: "Invalid request: unknown variant \`" + method + "\`" };
        }} };
        const clients = createRendererHostClients(() => ({
          forHost: (id) => id === "local" ? local : id === hostId ? remote : null,
          forComposer: () => hostId === "local" ? local : remote,
          hostIdForComposer: () => hostId,
          dispose() {},
        }));
        const announcer = createRendererSpeechAnnouncer(
          { getClient: (id) => clients.forHost(id), getLocale: () => "zh-CN" },
          () => readRendererSpeechEnabled(window),
        );
        const speech = {
          announce: (entry) => {
            announced.push([entry.threadId, entry.summary]);
            announcer.announce(entry);
          },
          replay: (entry) => {
            replayed.push([entry.threadId, entry.summary]);
            return announcer.replay(entry);
          },
        };
        globalThis.speech = { announced, replayed, requests: speechRequests, synthesized: [], audioEvents: [], failure: "" };
        const returnTargets = [];
        const threadReturn = installRendererThreadReturn({
          getLocale: () => "zh-CN",
          activeThread: () => {
            const active = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
            if (!active) return null;
            return { hostId, threadId: active.dataset.appActionSidebarThreadId.slice(hostId.length + 1) };
          },
          openThread: async (threadId, options) => {
            returnTargets.push([threadId, options.hostId]);
            for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
              row.dataset.appActionSidebarThreadActive = String(row.dataset.appActionSidebarThreadId === options.hostId + ":" + threadId);
            }
          },
        });
        const control = installRendererPendingConfirmations({
          onNavigateAway: (source) => threadReturn.remember(source),
          speech,
          getClient: () => client,
          getManager: () => manager,
          getHostIds: () => [hostId],
          activeThread: () => {
            const active = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
            if (!active) return null;
            return { hostId, threadId: active.dataset.appActionSidebarThreadId.slice(hostId.length + 1) };
          },
          getLocale: () => "zh-CN",
          openThread: async (threadId, options) => {
            opened.push([threadId, options.hostId, options.project]);
            for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
              row.dataset.appActionSidebarThreadActive = String(row.dataset.appActionSidebarThreadId === options.hostId + ":" + threadId);
            }
          },
        });
        globalThis.pendingConfirmations = {
          control,
          threadReturn,
          returnTargets,
          callbacks,
          requests,
          opened,
          sent,
          complete(threadId, turnId, summary, status = "completed") {
            for (const callback of callbacks) callback({ method: "turn/completed", params: { threadId, turn: {
              id: turnId, status, items: [{ type: "agentMessage", text: summary }],
            } } });
          },
          start(threadId, turnId) {
            for (const callback of callbacks) callback({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress" } } });
          },
          declareThread(threadId, ephemeral) {
            for (const callback of callbacks) callback({ method: "thread/started", params: { thread: { id: threadId, ephemeral } } });
          },
          state() { return JSON.parse(localStorage.getItem(PENDING_CONFIRMATIONS_STORAGE_KEY) || "null"); },
          nativeStatus(threadId, type, unread) {
            for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
              if (row.dataset.appActionSidebarThreadId !== hostId + ":" + threadId) continue;
              row.__reactFiber$fixture.memoizedProps.statusState = { type, unread };
              let described = row.querySelector("#fixture-unread-" + threadId);
              if (unread && !described) {
                described = document.createElement("span");
                described.id = "fixture-unread-" + threadId;
                described.textContent = "unread";
                row.append(described);
              }
              if (!unread) described?.remove();
              row.setAttribute("aria-describedby", unread ? "fixture-unread-" + threadId : "");
              // 原生行执行中会挂状态槽；它的出现/消失同时是状态缓存失效的信号。
              const slot = row.querySelector("#fixture-status-" + threadId);
              if (type === "loading" && !slot) {
                const status = document.createElement("span");
                status.id = "fixture-status-" + threadId;
                status.setAttribute("role", "status");
                row.append(status);
              } else if (type !== "loading") {
                slot?.remove();
              }
            }
          },
          nativeUnread(threadId, unread) {
            this.nativeStatus(threadId, "idle", unread);
          },
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
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});

const bundle = outputFiles[0]?.text;
if (!bundle) throw new Error("Pending confirmation fixture bundle is unavailable");

// localStorage is unavailable on about:blank's opaque origin, so the fixture is
// served from a real origin; /fixture.js carries the bundled renderer code.
test.beforeEach(async ({ context }) => {
  await context.route("https://codexhost.test/**", (route) =>
    route.fulfill(
      route.request().url().endsWith("/fixture.js")
        ? { contentType: "application/javascript", body: bundle }
        : {
            contentType: "text/html",
            body: '<!doctype html><style>:root{color-scheme:light dark}</style><body></body><script src="/fixture.js"></script>',
          },
    ),
  );
});

test("completed non-current conversations open a modal and support read/archive actions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const modal = page.locator("[data-codexhost-pending-confirmations]");

  await expect(modal).toBeHidden();
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-b",
      "B 会话已完成。",
    ),
  );
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("B 会话已完成。");
  await expect(modal).toContainText("Task B");
  // “继续”不区分终态：正常结束的会话同样提供，操作顺序不变。
  await expect(modal.getByRole("button", { name: "继续", exact: true })).toBeVisible();
  await expect(modal.locator("footer button").first()).toHaveText("查看结果");
  // “继续”会立刻发消息，与只处理提醒的“已读”“归档”分组隔开，避免误触。
  await expect(
    modal.locator("footer .codexhost-pending-action-group").first().getByRole("button"),
  ).toHaveText(["查看结果", "标为已读", "归档"]);
  await expect(modal.locator("footer .codexhost-pending-followup").getByRole("button")).toHaveText([
    "继续",
  ]);

  await page.getByRole("button", { name: "标为已读" }).click();
  await expect(modal).toBeHidden();
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, "pendingConfirmations").state().entries[0].state,
    ),
  ).toBe("confirmed");

  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-a",
      "turn-a",
      "当前会话结果。",
    ),
  );
  await expect(modal).toBeHidden();
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b2", "归档结果。"),
  );
  await expect(modal).toBeVisible();
  await page.getByRole("button", { name: "归档" }).click();
  await expect(modal).toBeHidden();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").requests),
  ).toContainEqual(["thread/archive", { threadId: "thread-b" }]);
});

test("closing the card marks it read and it stays gone after a restart", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "关闭即已读。"),
  );
  await expect(modal).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(modal).toBeHidden();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").state().entries[0]),
  ).toMatchObject({ turnId: "turn-b", state: "confirmed" });

  // 重启：保留存储重新安装，已读记录不能再次变成弹窗。
  await page.reload();
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")("local", false));
  await expect(page.locator("[data-codexhost-pending-confirmations]")).toBeHidden();
});

test("a restored pending entry the official sidebar already read is confirmed, not re-shown", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "codexhost.pending-confirmations.v1",
      JSON.stringify({
        version: 1,
        entries: [
          {
            hostId: "local",
            threadId: "thread-b",
            turnId: "turn-old",
            status: "completed",
            title: "Task B",
            summary: "上一条已经读过的结果。",
            project: "/workspace",
            completedAt: Date.now() - 60_000,
            state: "pending",
            confirmedAt: null,
          },
        ],
      }),
    );
  });
  // 侧栏行是 idle/unread=false：官方认为已读，队列必须跟着一起确认。
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")("local", false));
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  await expect(modal).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(globalThis, "pendingConfirmations").state()?.entries?.[0]?.state,
      ),
    )
    .toBe("confirmed");
});

test("formats the final message as structured markdown instead of one collapsed line", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-b",
      "## 结论\n\n已完成 **三项** 修改：\n\n1. 第一项\n2. 第二项\n\n| 项 | 状态 |\n| --- | --- |\n| 渲染 | 完成 |",
    ),
  );
  const summary = page.locator(".codexhost-pending-summary");
  await expect(summary).toBeVisible();
  // 分块渲染：标题、段落、有序列表、表格各成块，而不是塌成一段。
  await expect(summary.locator("h2")).toHaveText("结论");
  await expect(summary.locator("ol > li")).toHaveCount(2);
  await expect(summary.locator("table th").nth(1)).toHaveText("状态");
  await expect(summary.locator("table td").nth(1)).toHaveText("完成");
  await expect(summary).not.toContainText("结论 已完成");
});

test("sizes the completion card for long final messages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-b",
      "## 结论\n\n" +
        Array.from({ length: 30 }, (_, i) => `${i + 1}. 第 ${i + 1} 条结果`).join("\n"),
    ),
  );
  const panel = page.locator("[data-codexhost-pending-confirmations-panel]");
  await expect(panel).toBeVisible();
  // 卡片比旧的 560px 上限更宽，且正文与操作区同时可见，不再把长结果挤成一小块。
  const box = await panel.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(800);
  await expect(page.locator(".codexhost-pending-summary")).toBeVisible();
  await expect(page.getByPlaceholder("输入续发内容…")).toBeVisible();
  await expect(page.getByRole("button", { name: "查看结果" })).toBeVisible();
});

test("view action opens the source conversation and keeps the modal non-modal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "查看结果。"),
  );
  await page.getByRole("button", { name: "查看结果" }).click();
  expect(await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").opened)).toEqual(
    [["thread-b", "local", "Project"]],
  );
  await expect(page.locator("[data-codexhost-pending-confirmations]")).toBeHidden();
});

test("a newer Turn replaces the old pending item and repeated completion stays idempotent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-1", "旧结果"),
  );
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-1", "重复结果"),
  );
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").state().entries),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, "pendingConfirmations").state().entries[0].summary,
    ),
  ).toBe("旧结果");

  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").start("thread-b", "turn-2"),
  );
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-2", "新结果"),
  );
  const state = await page.evaluate(
    () => Reflect.get(globalThis, "pendingConfirmations").state().entries,
  );
  expect(state).toHaveLength(1);
  expect(state[0]).toMatchObject({ turnId: "turn-2", summary: "新结果", state: "pending" });
});

// 回归：中断恢复、重连自动续跑、"继续"续发都会在后台开新回合并带来新的 turnId。
// 旧实现一收到 turn/started 就删掉该 Thread 的待确认项，用户看到的卡片就一闪而过。
test("a background turn start keeps the unread card until the new turn produces a result", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  const entries = () =>
    page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").state().entries);

  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "第一次结果。"),
  );
  await expect(modal).toBeVisible();
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").start("thread-b", "turn-resumed"),
  );
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("第一次结果。");
  expect(await entries()).toMatchObject([{ turnId: "turn-b", state: "pending" }]);

  // 新回合出结果后才替换旧卡片。
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-resumed",
      "恢复后结果。",
    ),
  );
  await expect(modal).toContainText("恢复后结果。");
  expect(await entries()).toMatchObject([{ turnId: "turn-resumed", state: "pending" }]);
});

// 回归：会话重新进入执行态（中断后续跑、重连恢复）时侧栏是"未读=false"，
// 不能当成用户已读而确认卡片。
test("a thread that goes back to running is not treated as read", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  const state = () =>
    page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").state().entries[0].state);

  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "等待确认。"),
  );
  await expect(modal).toBeVisible();
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").nativeStatus("thread-b", "idle", true),
  );
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").nativeStatus("thread-b", "loading", false),
  );
  await expect(modal).toBeVisible();
  expect(await state()).toBe("pending");

  // 真正回到 idle 且官方未读消失，才视为用户已读。
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").nativeStatus("thread-b", "idle", false),
  );
  await expect(modal).toBeHidden();
  expect(await state()).toBe("confirmed");
});

test("completion stays silent and the top-right speaker plays audio manually", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "播报结果。"),
  );
  // 完成通知仍经过播报器；默认关闭时不合成音频。
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "speech").announced))
    .toEqual([["thread-b", "播报结果。"]]);
  expect(await page.evaluate(() => Reflect.get(globalThis, "speech").synthesized)).toEqual([]);

  const modal = page.locator("[data-codexhost-pending-confirmations]");
  const replay = modal.locator("header").getByRole("button", { name: "重播语音" });
  await expect(replay).toBeVisible();
  await expect(replay.locator("svg")).toBeVisible();
  await expect(replay).toHaveText("");
  await expect(modal.locator("footer button").first()).toHaveText("查看结果");
  await page.screenshot({ path: testInfo.outputPath("manual-speaker-before.png") });
  await replay.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "speech").replayed))
    .toEqual([["thread-b", "播报结果。"]]);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "speech").audioEvents))
    .toContain("playing");
  await expect(replay).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("manual-speaker-after.png") });
});

test("manual speaker plays an SSH summary through the local Host", async ({ page }, testInfo) => {
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => {
    Reflect.get(globalThis, "setupPendingConfirmations")("remote-ssh-discovered:okm252");
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-b",
      "远程会话已完成。",
    );
  });
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  await expect(modal).toContainText("remote-ssh-discovered:okm252");
  const replay = modal.getByRole("button", { name: "重播语音" });
  await expect(replay).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("ssh-speaker-before.png") });

  await replay.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "speech").audioEvents))
    .toContain("playing");
  await expect(replay).toBeEnabled();
  await expect(page.getByRole("alert")).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(globalThis, "speech").requests)).toEqual([
    [
      "remote-ssh-discovered:okm252",
      "codexhost/buddy/speech",
      { text: "远程会话已完成。", locale: "zh-CN" },
    ],
    ["local", "codexhost/buddy/speech", { text: "远程会话已完成。", locale: "zh-CN" }],
  ]);
  await page.screenshot({ path: testInfo.outputPath("ssh-speaker-after.png") });
});

test("manual speaker displays a synthesis error and lets the user retry", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => {
    Reflect.get(globalThis, "setupPendingConfirmations")();
    Reflect.get(globalThis, "speech").failure = "HTTP 401";
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "播报结果。");
  });
  const replay = page.getByRole("button", { name: "重播语音" });
  await expect(replay).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("manual-speaker-error-before.png") });
  await replay.click();
  await expect(page.getByRole("alert")).toHaveText("语音播报失败: HTTP 401");
  await expect(replay).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("manual-speaker-error-after.png") });
});

test("composer input sends a follow-up into the pending conversation", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "结果。"),
  );
  await expect(modal).toBeVisible();
  const send = modal.getByRole("button", { name: "发送", exact: true });
  await expect(send).toHaveText("");
  await expect(send.locator("svg")).toBeVisible();
  await expect(send).toHaveCSS("background-color", "rgb(13, 13, 13)");
  await expect(send).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(send).toHaveCSS("width", "28px");
  await expect(send).toHaveCSS("height", "28px");
  await page.screenshot({ path: testInfo.outputPath("send-button-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(send).toHaveCSS("background-color", "rgb(243, 243, 243)");
  await expect(send).toHaveCSS("color", "rgb(13, 13, 13)");
  await page.screenshot({ path: testInfo.outputPath("send-button-dark.png") });
  const modelSelect = modal.getByRole("combobox", { name: "续发模型" });
  await expect(modelSelect).toBeVisible();
  await modelSelect.selectOption("gpt-5.6");
  await modal.getByPlaceholder("输入续发内容…").fill("再补充一点");
  await send.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").sent))
    .toEqual([["thread-b", "再补充一点", "gpt-5.6"]]);
  // 续发成功只关闭卡片，保留用户当前正在查看的会话。
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").opened))
    .toEqual([]);
  await expect(modal).toBeHidden();
  await expect(
    page.locator('[data-app-action-sidebar-thread-id="local:thread-a"]'),
  ).toHaveAttribute("data-app-action-sidebar-thread-active", "true");
});

for (const draft of ["", "尚未发送的草稿"]) {
  test(`continue button sends a fixed follow-up without navigating (draft: ${draft || "empty"})`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    });
    await page.goto("https://codexhost.test/");
    await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
    const modal = page.locator("[data-codexhost-pending-confirmations]");
    await page.evaluate(() =>
      Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "结果。"),
    );
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("输入续发内容…").fill(draft);
    const modelSelect = modal.getByRole("combobox", { name: "续发模型" });
    await expect(modelSelect).toBeVisible();
    await modelSelect.selectOption("gpt-5.6");
    await modal.getByRole("button", { name: "继续", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").sent))
      .toEqual([["thread-b", "继续,遇到决策你自己决定", "gpt-5.6"]]);
    await expect(modal).toBeHidden();
    expect(
      await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").opened),
    ).toEqual([]);
    await expect(
      page.locator('[data-app-action-sidebar-thread-id="local:thread-a"]'),
    ).toHaveAttribute("data-app-action-sidebar-thread-active", "true");
  });
}

// 回归：Codex 用后台 ephemeral Thread 生成标题。这类 Thread 没有 rollout、
// 不在 thread/list、也没有侧栏行，它的 turn 终态一旦进入待确认队列，用户就会
// 看到"会话已完成"卡片，却永远定位不到对应会话。
test("title generation ephemeral threads never raise a pending card", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  const control = (action: string) =>
    page.evaluate((call) => Reflect.get(globalThis, "pendingConfirmations")[call](), action);

  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").declareThread("title-thread", true),
  );
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").start("title-thread", "title-turn"),
  );
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "title-thread",
      "title-turn",
      "",
      "interrupted",
    ),
  );
  await expect(modal).toBeHidden();
  expect(await control("state")).toBeNull();

  // 普通会话仍照常弹卡片，确认过滤只作用于被声明为 ephemeral 的 Thread。
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").declareThread("thread-b", false),
  );
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-b",
      "B 会话已完成。",
    ),
  );
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("B 会话已完成。");
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, "pendingConfirmations")
        .state()
        .entries.map((entry: { threadId: string }) => entry.threadId),
    ),
  ).toEqual(["thread-b"]);
});

// 标题生成要求 JSON，但模型也可能按字段名回两行纯文本；这类回合同样不能提醒。
test("labeled title generation output never raises a pending card", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "title-thread",
      "title-turn",
      "Title: 移除继续按钮的会话结束校验\nDescription: 去掉继续按钮对会话正常结束状态的判断逻辑",
    ),
  );
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  await expect(modal).toBeHidden();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").state()),
  ).toBeNull();
});

// 命名完成前侧栏标题是打字机点阵，标题生成的 JSON 也不是用户结果：这类 Turn
// 不入队、不弹卡片，点阵也不能被当成会话标题写进提醒。
test("naming turns do not replace the conversation title or summary", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  await page.evaluate(() => {
    const row = document.querySelector('[data-app-action-sidebar-thread-id="local:thread-b"]');
    const title = row?.querySelector("[data-thread-title]");
    if (title) title.textContent = "...";
  });
  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete(
      "thread-b",
      "turn-b",
      '{"title":"T","description":"d"}',
    ),
  );
  const modal = page.locator("[data-codexhost-pending-confirmations]");
  await expect(modal).toBeHidden();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").state()),
  ).toBeNull();
  await expect(
    page.locator('[data-app-action-sidebar-thread-id="local:thread-b"] [data-thread-title]'),
  ).toHaveText("...");
});

// 完成提醒会把用户带到已完成的会话；用户常常记不住原本正在看哪一个。
// 这里覆盖：跳转前记住来源会话 → 显示返回入口 → 点击切回来源会话。
test("completion reminder offers a way back to the previously viewed conversation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.goto("https://codexhost.test/");
  // 当前正在看 thread-a，thread-b 在后台完成。
  await page.evaluate(() => Reflect.get(globalThis, "setupPendingConfirmations")());
  const chip = page.locator("[data-codexhost-thread-return]");
  await expect(chip).toBeHidden();

  await page.evaluate(() =>
    Reflect.get(globalThis, "pendingConfirmations").complete("thread-b", "turn-b", "B 结果。"),
  );
  await page.getByRole("button", { name: "查看结果" }).click();
  // 跳转后落到 thread-b，返回入口指向原来的 thread-a。
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("回到刚才的会话");
  await expect(chip).toContainText("Task A");

  await chip.locator("[data-codexhost-thread-return-open]").click();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").returnTargets),
  ).toEqual([["thread-a", "local"]]);
  // 已回到来源会话，入口自动收起。
  await expect(chip).toBeHidden();
});
