import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { PendingConfirmationsModel, PENDING_CONFIRMATIONS_STORAGE_KEY } from "./packages/renderer-extension/src/pending-confirmations-state.ts";
      import { installRendererPendingConfirmations } from "./packages/renderer-extension/src/renderer-pending-confirmations.ts";

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
        const client = {
          requestThreadProjection: async (method, params) => {
            requests.push([method, params]);
            return {};
          },
        };
        const control = installRendererPendingConfirmations({
          getClient: () => client,
          getManager: () => ({ addNotificationCallback(methods, callback) {
            callbacks.push(callback);
            return () => {};
          }}),
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

test("completed non-current conversations open a modal and support read/archive actions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  });
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
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
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
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
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ content: bundle });
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
