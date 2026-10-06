import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installBuddyControl } from "./packages/renderer-extension/src/buddy/control.ts";
      import { createRendererRequestSender } from "./packages/renderer-extension/src/renderer-request-sender.ts";
      const snapshot = {
        settings: { enabled: true, planning: true, privateMode: false, bypass: true, jev: true, role: "auto", plannerModel: null, executorModel: null },
        models: [], decisions: []
      };
      globalThis.requests = [];
      globalThis.failures ??= {};
      globalThis.threads = [{ threadId: "stalled", turnId: "failed", title: "待恢复的远程会话", status: "failed", owner: "codex" }];
      globalThis.connect = () => {
        const send = createRendererRequestSender(async (method, params) => {
          globalThis.requests.push([method, params]);
          const failure = globalThis.failures[method];
          if (failure === "unsupported") {
            throw Object.assign(new Error("Method not found"), { code: -32601 });
          }
          if (failure) throw new Error(failure);
          if (method === "codexhost/buddy/settings" || method === "codexhost/buddy/jev-key") {
            await new Promise(resolve => globalThis.finishConfiguration = resolve);
            return structuredClone(snapshot);
          }
          if (method === "codexhost/buddy/status") return structuredClone(snapshot);
          if (method === "codexhost/buddy/interrupted") {
            return { threads: structuredClone(globalThis.threads), runningThreadIds: [], unreadable: 0 };
          }
          if (method === "codexhost/buddy/continue") globalThis.threads = [];
          return {};
        });
        globalThis.client = {
          buddyStatus: () => send("codexhost/buddy/status", {}),
          buddyConfigure: settings => send("codexhost/buddy/settings", settings),
          buddyJevKey: config => send("codexhost/buddy/jev-key", config),
          buddyInterrupted: () => send("codexhost/buddy/interrupted", {}),
          buddyContinue: (threadId, turnId) => send("codexhost/buddy/continue", { threadId, turnId })
        };
      };
      globalThis.connect();
      const anchor = document.createElement("div");
      document.body.append(anchor);
      globalThis.control = installBuddyControl(
        () => ({ anchor, threadId: "current", client: globalThis.client }),
        () => globalThis.locale ?? "zh-CN"
      );
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const browserBundle = outputFiles[0]?.text;
if (!browserBundle) throw new Error("Buddy connection bundle was not generated");

for (const width of [390, 1200]) {
  test(`unsupported router keeps recovery independent and tabs usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.setContent('<body style="font:14px system-ui"></body>');
    await page.evaluate(() => {
      Reflect.set(globalThis, "failures", { "codexhost/buddy/status": "unsupported" });
    });
    await page.addScriptTag({ content: browserBundle });
    const root = page.locator("[data-buddy-router]");
    await expect(root.locator("summary")).toContainText("当前连接不支持 Auto Router");
    await root.locator("summary").click();
    await expect(root.getByRole("tab")).toHaveCount(2);
    await expect(
      root.getByRole("status").filter({ hasText: "SSH 会话需在远端启用" }),
    ).toBeVisible();
    await expect(page.locator("[data-buddy-recovery] .buddy-interrupted")).toBeVisible();
    await expect(page.locator("[data-buddy-recovery]").getByText("待恢复的远程会话")).toBeVisible();
    await page.screenshot({ path: `test-results/buddy-connection-recovery-${width}.png` });
    await page
      .locator("[data-buddy-recovery]")
      .getByRole("button", { name: "恢复", exact: true })
      .click();
    await expect(
      page.locator("[data-buddy-recovery]").getByText("暂无最近中断会话。"),
    ).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(globalThis, "requests"))).toContainEqual([
      "codexhost/buddy/continue",
      { threadId: "stalled", turnId: "failed" },
    ]);
  });
}

test("a native connection explains missing capabilities and rechecks a replacement connection", async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent('<body style="font:14px system-ui"></body>');
  await page.evaluate(() => {
    Reflect.set(globalThis, "failures", {
      "codexhost/buddy/status": "unsupported",
      "codexhost/buddy/interrupted": "unsupported",
    });
  });
  await page.addScriptTag({ content: browserBundle });
  const root = page.locator("[data-buddy-router]");
  await root.locator("summary").click();
  const recovery = page.locator("[data-buddy-recovery] .buddy-interrupted");
  await expect(recovery).toContainText("当前连接不支持会话恢复。");
  await expect(recovery).toContainText("SSH 会话需在远端启用后重新连接。");
  await expect(recovery.getByRole("button")).toHaveCount(0);
  await expect(root).not.toContainText("is unsupported on this Host connection");
  await page.clock.runFor(31_000);
  expect(await page.evaluate(() => Reflect.get(globalThis, "requests"))).toEqual([
    ["codexhost/buddy/status", {}],
    ["codexhost/buddy/interrupted", {}],
  ]);
  await page.screenshot({ path: "test-results/buddy-connection-unavailable.png" });
  await page.evaluate(async () => {
    Reflect.set(globalThis, "failures", {});
    Reflect.get(globalThis, "connect")();
    await Reflect.get(globalThis, "control").refresh();
  });
  await expect(root.locator("summary")).toContainText("夯规划 → 垃执行");
  await expect(recovery.getByText("待恢复的远程会话")).toBeVisible();
  await expect(root.getByText(/当前连接未提供 Auto Router/)).toHaveCount(0);
  await root.getByRole("tab", { name: "路由", exact: true }).click();
  await expect(root.getByRole("switch", { name: /Auto Router/ })).toBeVisible();
});

test("transient status failure clears stale controls and recovers on the same connection", async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent("<body></body>");
  await page.addScriptTag({ content: browserBundle });
  const root = page.locator("[data-buddy-router]");
  await root.locator("summary").click();
  await expect(root.getByRole("switch", { name: /Auto Router/ })).toBeVisible();
  await page.evaluate(async () => {
    Reflect.set(globalThis, "failures", { "codexhost/buddy/status": "暂时无法连接" });
    await Reflect.get(globalThis, "control").refresh();
  });
  await expect(root.getByRole("alert").filter({ hasText: "暂时无法连接" })).toBeVisible();
  await expect(root.getByRole("switch")).toHaveCount(0);
  await expect(
    page.locator("[data-buddy-recovery] .buddy-interrupted").getByRole("button"),
  ).toHaveCount(0);
  await expect(page.locator("[data-buddy-recovery] .buddy-interrupted")).toContainText(
    "连接状态尚未确认",
  );
  await expect(page.locator("[data-buddy-recovery] .buddy-interrupted")).not.toContainText(
    "当前连接不支持",
  );
  await expect(root).not.toContainText("当前连接未提供 Auto Router");
  await page.evaluate(async () => {
    Reflect.set(globalThis, "failures", {});
    await Reflect.get(globalThis, "control").refresh();
  });
  await expect(page.locator("[data-buddy-recovery]").getByText("待恢复的远程会话")).toBeVisible();
  await expect(root.getByText("暂时无法连接")).toHaveCount(0);
});

test("a missing continue method stops the batch and removes recovery actions", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.evaluate(() => {
    Reflect.set(globalThis, "failures", { "codexhost/buddy/continue": "unsupported" });
  });
  await page.addScriptTag({ content: browserBundle });
  const root = page.locator("[data-buddy-router]");
  await root.locator("summary").click();
  await page
    .locator("[data-buddy-recovery]")
    .getByRole("button", { name: "全部继续 (1)", exact: true })
    .click();
  await expect(page.locator("[data-buddy-recovery] .buddy-interrupted")).toContainText(
    "当前连接不支持会话恢复。",
  );
  await expect(
    page.locator("[data-buddy-recovery] .buddy-interrupted").getByRole("button"),
  ).toHaveCount(0);
});

for (const action of ["settings", "save-key", "clear-key"] as const) {
  test(`late ${action} response cannot restore controls after the connection fails`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.setContent("<body></body>");
    await page.addScriptTag({ content: browserBundle });
    const root = page.locator("[data-buddy-router]");
    await root.locator("summary").click();
    if (action === "settings") {
      await root.getByRole("switch", { name: /Auto Router/ }).click();
    } else {
      await root
        .getByRole("button", { name: action === "save-key" ? "保存密钥" : "清除", exact: true })
        .click();
    }
    await page.evaluate(async () => {
      Reflect.set(globalThis, "failures", { "codexhost/buddy/status": "unsupported" });
      await Reflect.get(globalThis, "control").refresh();
      Reflect.get(globalThis, "finishConfiguration")();
    });
    await expect(root.locator("summary")).toContainText("当前连接不支持 Auto Router");
    await expect(root.getByRole("switch")).toHaveCount(0);
    await expect(root.getByText(/当前连接未提供 Auto Router/)).toBeVisible();
  });
}
