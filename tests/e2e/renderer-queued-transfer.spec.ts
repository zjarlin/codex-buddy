import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const sourceThreadId = "11111111-1111-4111-8111-111111111111";
const targetThreadId = "22222222-2222-4222-8222-222222222222";
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    sourcefile: "renderer-queued-transfer-fixture.ts",
    contents: `
      import { installRendererQueuedTransfer } from "./packages/renderer-extension/src/renderer-queued-transfer.ts";
      globalThis.setupQueuedTransfer = (sourceThreadId, targetThreadId) => {
        const more = document.querySelector('[aria-label="排队消息操作"]');
        more.__reactFiber$test = {
          memoizedProps: {},
          return: {
            memoizedProps: { messageId: "queued-1", hostId: "local", onDeleteMessage() {} },
            return: null,
          },
        };
        const image = { src: "data:image/png;base64,cG5n" };
        const queued = [{
          id: "queued-1", text: "这部分怎么解决？", cwd: "/source",
          context: { prompt: "这部分怎么解决？", imageAttachments: [image], workspaceRoots: ["/source"] },
        }];
        const sent = [];
        const coordinator = {
          async loadMessages() {},
          readMessages() { return queued; },
          async removeQueuedMessage(_threadId, messageId) {
            const index = queued.findIndex((message) => message.id === messageId);
            if (index < 0) return null;
            const [message] = queued.splice(index, 1);
            return { message, index, previousMessageId: null, nextMessageId: null };
          },
          async restoreQueuedMessage(_threadId, removed) { queued.push(removed.message); },
          deferAutomaticTurns() { return { [Symbol.dispose]() {} }; },
        };
        const manager = {
          async sendRequest(method, params) {
            if (method !== "thread/list") throw new Error(method);
            const title = "另一个中文会话";
            return {
              data: title.includes(params.searchTerm ?? "")
                ? [{ id: targetThreadId, name: title, cwd: "/target", canAcceptDirectInput: true }]
                : [],
              nextCursor: null,
            };
          },
          getTurnCoordinator() { return coordinator; },
          getConversationCwd() { return "/target"; },
          getConversation() { return null; },
          async sendFollowUpMessage(threadId, options) { sent.push({ threadId, options }); },
        };
        const control = installRendererQueuedTransfer({ getManager: () => manager, getLocale: () => "zh-CN" });
        globalThis.queuedTransferState = { queued, sent, control };
      };
    `,
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  write: false,
});

test("a queued message can be moved through Chinese title suggestions", async ({ page }) => {
  await page.setContent(`
    <style>body{font:14px system-ui;margin:24px}.composer{width:min(650px,calc(100vw - 48px));margin-top:160px}.actions{display:flex;justify-content:flex-end;align-items:center;gap:4px}</style>
    <div class="composer" data-codex-composer-root>
      <div data-above-composer-portal data-above-composer-conversation-id="${sourceThreadId}"></div>
      <div class="actions"><span>这部分怎么解决？</span><button aria-label="排队消息操作">•••</button></div>
    </div>
  `);
  const bundle = outputFiles[0];
  if (!bundle) throw new Error("Queued transfer fixture bundle is unavailable");
  await page.addScriptTag({ content: bundle.text });
  await page.evaluate(
    ({ sourceThreadId, targetThreadId }) => {
      (
        globalThis as typeof globalThis & {
          setupQueuedTransfer(sourceThreadId: string, targetThreadId: string): void;
        }
      ).setupQueuedTransfer(sourceThreadId, targetThreadId);
    },
    { sourceThreadId, targetThreadId },
  );

  await page.getByRole("button", { name: "转移到会话" }).click();
  await expect(page.locator("[data-codexhost-queued-transfer-panel]")).toContainText(
    "转移并发送到会话",
  );
  await expect(page.getByRole("combobox")).toBeVisible();
  await page.getByRole("combobox").fill("中文");
  await expect(page.getByRole("option", { name: /另一个中文会话/u })).toBeVisible();
  await page.screenshot({ path: "test-results/queued-transfer-suggestions.png" });
  await page.getByRole("button", { name: "关闭" }).click();
  await page.setViewportSize({ width: 390, height: 340 });
  await page.getByRole("button", { name: "转移到会话" }).click();
  await page.getByRole("combobox").fill("中文");
  await expect(page.getByRole("option", { name: /另一个中文会话/u })).toBeVisible();
  const panel = await page.locator("[data-codexhost-queued-transfer-panel]").boundingBox();
  if (!panel) throw new Error("Queued transfer panel is not visible");
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(340);
  await page.screenshot({ path: "test-results/queued-transfer-suggestions-mobile.png" });
  await page.getByRole("option", { name: /另一个中文会话/u }).click();
  await expect(page.getByRole("status")).toContainText("已转移到");

  const state = await page.evaluate(() => {
    const { queued, sent } = (
      globalThis as typeof globalThis & {
        queuedTransferState: { queued: unknown[]; sent: unknown[] };
      }
    ).queuedTransferState;
    return { queued, sent };
  });
  expect(state.queued).toHaveLength(0);
  expect(state.sent).toEqual([
    {
      threadId: targetThreadId,
      options: {
        prompt: "这部分怎么解决？",
        attachmentContext: expect.objectContaining({
          imageAttachments: [{ src: "data:image/png;base64,cG5n" }],
          workspaceRoots: ["/target"],
        }),
      },
    },
  ]);
});
