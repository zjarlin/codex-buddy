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
      import { createRendererSpeechAnnouncer } from "./packages/renderer-extension/src/renderer-speech.ts";
      import { readRendererSpeechEnabled } from "./packages/renderer-extension/src/renderer-speech-preference.ts";

      const NativeAudio = Audio;
      globalThis.Audio = function(source) {
        const audio = new NativeAudio(source);
        for (const name of ["playing", "ended", "error"]) {
          audio.addEventListener(name, () => globalThis.speech.audioEvents.push(name));
        }
        return audio;
      };

      globalThis.setupPendingConfirmations = () => {
        localStorage.clear();
        document.body.innerHTML = \`
          <aside id="app-shell-sidebar">
            <section data-sidebar-project-container-id="project:one">
              <button data-app-action-sidebar-project-row>Project</button>
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
          const attrs = {
            "data-app-action-sidebar-thread-row": "",
            "data-app-action-sidebar-thread-host-id": row.dataset.appActionSidebarThreadHostId,
            "data-app-action-sidebar-thread-id": row.dataset.appActionSidebarThreadId,
          };
          const threadId = row.dataset.appActionSidebarThreadId.split(":").slice(1).join(":");
          row.__reactFiber$fixture = { memoizedProps: { conversationId: threadId, dataAttributes: attrs } };
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
        const announcer = createRendererSpeechAnnouncer(
          { getClient: () => client, getLocale: () => "zh-CN" },
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
        globalThis.speech = { announced, replayed, synthesized: [], audioEvents: [], failure: "" };
        const control = installRendererPendingConfirmations({
          speech,
          getClient: () => client,
          getManager: () => manager,
          getHostIds: () => ["local"],
          activeThread: () => {
            const active = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
            if (!active) return null;
            return { hostId: "local", threadId: active.dataset.appActionSidebarThreadId.slice("local:".length) };
          },
          getLocale: () => "zh-CN",
          openThread: async (threadId, options) => {
            opened.push([threadId, options.hostId]);
            for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
              row.dataset.appActionSidebarThreadActive = String(row.dataset.appActionSidebarThreadId === options.hostId + ":" + threadId);
            }
          },
        });
        globalThis.pendingConfirmations = {
          control,
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
          state() { return JSON.parse(localStorage.getItem(PENDING_CONFIRMATIONS_STORAGE_KEY) || "null"); },
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
    [["thread-b", "local"]],
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
  // Sending reuses the open path so the user lands on the continuing conversation.
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "pendingConfirmations").opened))
    .toEqual([["thread-b", "local"]]);
  await expect(modal).toBeHidden();
});
