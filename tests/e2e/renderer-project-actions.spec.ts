import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) {
  test.use({ launchOptions: { executablePath: browserExecutable } });
}

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererProjectActions } from "./packages/renderer-extension/src/renderer-project-actions.ts";

      globalThis.setupProjectActions = ({ terminalPreference = null } = {}) => {
        document.documentElement.lang = "zh-CN";
        document.body.innerHTML = \`
          <style>
            :root { color-scheme: dark; --color-token-text-primary: #e8e8e8; --color-token-dropdown-background: #292929; --color-border: #414141; }
            * { box-sizing: border-box; }
            body { margin: 0; background: #202020; color: #e8e8e8; font: 14px/20px system-ui, sans-serif; }
            header { height: 44px; border-bottom: 1px solid #343434; display: flex; align-items: center; padding: 0 18px; font-weight: 600; }
            aside { width: 248px; min-height: calc(100vh - 44px); padding: 20px 12px; background: #252525; border-right: 1px solid #343434; }
            h2 { margin: 0 8px 14px; color: #aaa; font-size: 12px; font-weight: 500; }
            .project-row { display: flex; align-items: center; min-width: 0; height: 36px; padding: 0 8px; border-radius: 6px; gap: 8px; }
            .project-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .menu-trigger { width: 26px; height: 26px; padding: 0; color: #bdbdbd; background: transparent; border: 0; border-radius: 4px; cursor: pointer; }
            .menu-trigger:hover { background: #393939; }
            main { position: absolute; top: 44px; left: 248px; right: 0; padding: 32px; }
            main h1 { font-size: 18px; margin: 0 0 10px; font-weight: 600; }
            main p { color: #a4a4a4; margin: 0; }
            .fixture-controls { position: fixed; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; max-width: calc(100vw - 24px); gap: 8px; }
            .fixture-controls button { color: #aaa; font: 12px/18px system-ui; background: transparent; border: 1px solid #484848; padding: 4px 8px; border-radius: 4px; }
            .native-menu { position: fixed; top: 102px; left: 184px; z-index: 100; width: 248px; max-width: calc(100vw - 24px); padding: 5px; background: #2b2b2b; border: 1px solid #444; border-radius: 8px; box-shadow: 0 12px 28px #0006; }
            .native-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 6px 9px; border-radius: 4px; white-space: nowrap; cursor: pointer; outline: none; }
            .native-item:hover, .native-item:focus { background: #464646; }
            .native-item[aria-disabled=true] { color: #777; cursor: default; }
            .native-item svg { width: 16px; height: 16px; flex-shrink: 0; }
            .native-item span:last-child { min-width: 0; }
            .native-separator { height: 1px; margin: 4px; background: #494949; }
            @media (max-width: 600px) {
              aside { width: 100%; border-right: 0; }
              main { display: none; }
              .native-menu { left: auto; right: 12px; }
            }
          </style>
          <header>Codex</header>
          <aside aria-label="项目">
            <h2>项目</h2>
            <div data-sidebar-project-kind="local" data-sidebar-project-container-id="project:local-1">
              <div class="project-row" data-app-action-sidebar-project-row="" data-app-action-sidebar-project-id="local-1">
                <span class="project-name">codex-host</span>
                <button type="button" class="menu-trigger" aria-label="codex-host 项目操作" aria-haspopup="menu">···</button>
              </div>
            </div>
            <div data-sidebar-project-kind="remote" data-sidebar-project-container-id="project:remote-1">
              <div class="project-row" data-app-action-sidebar-project-row="" data-app-action-sidebar-project-id="remote-1">
                <span class="project-name">production-server</span>
                <button type="button" class="menu-trigger" aria-label="production-server 项目操作" aria-haspopup="menu">···</button>
              </div>
            </div>
          </aside>
          <main><h1>codex-host</h1><p>main</p></main>
          <div class="fixture-controls">
            <button type="button" id="refresh-extension">Refresh extension</button>
            <button type="button" id="dispose-extension">Dispose extension</button>
            <button type="button" id="rerender-menu">Rerender menu</button>
            <button type="button" id="remove-added-item">Remove added item</button>
          </div>
        \`;

        if (terminalPreference) localStorage.setItem("codexhost.thread-terminal.v1", terminalPreference);
        const hostCalls = [];
        const nativeCalls = [];
        const events = [];
        const actionOwners = [];
        let menu = null;
        let portal = null;
        const root = { tag: 3, key: null, memoizedProps: {}, return: null, child: null, sibling: null, stateNode: null };
        root.stateNode = { current: root };
        const fiber = (props, parent, key = null, node = null) => ({
          tag: node ? 5 : 0,
          key,
          memoizedProps: props,
          return: parent,
          child: null,
          sibling: null,
          stateNode: node,
        });
        const bind = (element, node) => {
          Object.defineProperty(element, "__reactFiber$fixture", { configurable: true, enumerable: true, value: node });
          Object.defineProperty(element, "__reactProps$fixture", { configurable: true, enumerable: true, value: node.memoizedProps });
        };
        const close = () => {
          if (!menu) return;
          events.push("close");
          menu.remove();
          menu = null;
          if (portal) portal.return.child = null;
          portal = null;
        };
        const folder = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z" /></svg>';
        const configurations = [
          { projectKind: "local", projectId: "local-1", path: "/repo/codex-host", label: "codex-host" },
          { projectKind: "remote", projectId: "remote-1", path: "/srv/production", label: "production-server", hostId: "remote-host" },
        ];
        let previousOwner = null;
        for (const project of configurations) {
          const owner = fiber({ project, actionsRef: { current: null } }, root);
          if (previousOwner) previousOwner.sibling = owner;
          else root.child = owner;
          previousOwner = owner;
          const items = [
            { id: "pin-project", label: "固定" },
            { id: "edit-project", label: "编辑" },
            { id: "project-actions-separator", type: "separator" },
            { id: "section", label: "分区" },
            ...(project.projectKind === "local" ? [{ id: "reveal-project-folder", label: "在访达中显示" }] : []),
            { id: "project-chat-actions-separator", type: "separator" },
            { id: "archive-project-threads", label: "归档对话", enabled: false },
            { id: "project-remove-separator", type: "separator" },
            { id: "remove-project", label: "移除项目" },
          ].map((item) => ({ ...item, message: { id: item.id, defaultMessage: item.label }, onSelect: () => nativeCalls.push([project.projectKind, item.id]) }));
          const onOpenChange = (open) => { if (!open) close(); };
          const actions = fiber({
            getContextMenuItems: () => items,
            triggerAriaLabel: project.label + " 项目操作",
            onOpenChange,
          }, owner);
          actionOwners.push(actions);
          owner.child = actions;
          owner.memoizedProps.actionsRef.current = { getContextMenuItems: () => items };
          const nativeMenu = fiber({ getItems: () => items, trigger: "click", onOpenChange }, actions);
          actions.child = nativeMenu;
          const trigger = document.querySelector('[data-sidebar-project-container-id="project:' + project.projectId + '"] .menu-trigger');
          trigger.addEventListener("click", () => {
            close();
            menu = document.createElement("div");
            menu.className = "native-menu";
            menu.setAttribute("role", "menu");
            menu.setAttribute("data-state", "open");
            menu.setAttribute("aria-label", project.label + " 项目操作");
            portal = fiber({}, nativeMenu);
            portal.tag = 4;
            nativeMenu.child = portal;
            const menuFiber = fiber({ role: "menu" }, portal, null, menu);
            portal.child = menuFiber;
            bind(menu, menuFiber);
            let previousItem = null;
            const registeredItems = [];
            for (const item of items) {
              const element = document.createElement("div");
              element.setAttribute("role", item.type === "separator" ? "separator" : "menuitem");
              element.className = item.type === "separator" ? "native-separator" : "native-item";
              if (item.type !== "separator") {
                registeredItems.push(element);
                element.tabIndex = -1;
                element.setAttribute("aria-disabled", String(item.enabled === false));
                element.innerHTML = folder + '<span class="native-item-label">' + item.label + '</span>';
                element.addEventListener("click", () => {
                  if (item.enabled === false) return;
                  item.onSelect();
                  close();
                });
              }
              const itemFiber = fiber({ disabled: item.enabled === false, onSelect: item.onSelect }, menuFiber, item.id);
              const hostFiber = fiber({ role: element.getAttribute("role"), onClick: item.onSelect }, itemFiber, null, element);
              itemFiber.child = hostFiber;
              if (previousItem) previousItem.sibling = itemFiber;
              else menuFiber.child = itemFiber;
              previousItem = itemFiber;
              bind(element, hostFiber);
              menu.append(element);
            }
            menu.addEventListener("keydown", (event) => {
              const enabled = registeredItems.filter((element) => element.getAttribute("aria-disabled") !== "true");
              const index = enabled.indexOf(document.activeElement);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                enabled[(index + direction + enabled.length) % enabled.length]?.focus();
              } else if (event.key === "Enter") {
                event.preventDefault();
                enabled[index]?.click();
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            });
            document.body.append(menu);
            registeredItems[0]?.focus();
          });
        }
        const clipboardCalls = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (...args) => { clipboardCalls.push(args); events.push("clipboard"); } },
        });
        const client = {
          openProjectTerminal: async (...args) => {
            events.push("host");
            hostCalls.push(["terminal", ...args]);
            return { workspace: args[0].path, terminal: args[0].terminalId ?? "system-default" };
          },
          openProjectWorkspace: async (...args) => {
            events.push("host");
            hostCalls.push(["workspace", ...args]);
            return { workspace: args[0].path, application: "vscode" };
          },
        };
        const control = installRendererProjectActions({ getClient: () => client, getLocale: () => "zh-CN" });
        document.querySelector("#refresh-extension").addEventListener("click", () => control.refresh());
        document.querySelector("#dispose-extension").addEventListener("click", () => control.dispose());
        document.querySelector("#rerender-menu").addEventListener("click", () => {
          for (const owner of actionOwners) {
            const originalClose = owner.memoizedProps.onOpenChange;
            owner.memoizedProps = {
              ...owner.memoizedProps,
              onOpenChange(open) { events.push("rerender-close"); originalClose(open); },
            };
          }
          menu?.setAttribute("data-render-generation", "2");
        });
        document.querySelector("#remove-added-item").addEventListener("click", () => {
          menu?.querySelector("[data-codexhost-project-actions-open-terminal]")?.remove();
        });
        globalThis.projectActionsFixture = { clipboardCalls, hostCalls, nativeCalls, events };
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
const bundle = (() => {
  const source = outputFiles[0]?.text;
  if (!source) {
    throw new Error("Project actions fixture bundle missing");
  }
  return source;
})();

async function setup(
  page: Page,
  options: { width?: number; height?: number; terminalPreference?: string } = {},
): Promise<void> {
  await page.setViewportSize({ width: options.width ?? 960, height: options.height ?? 700 });
  await page.route("http://localhost/project-actions-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto("http://localhost/project-actions-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    (configuration) => Reflect.get(globalThis, "setupProjectActions")(configuration),
    { terminalPreference: options.terminalPreference ?? null },
  );
}

test("adds path, terminal, and VS Code actions after Reveal and preserves native actions", async ({
  page,
}) => {
  await setup(page);
  const inserted = ["复制绝对路径", "在终端中打开", "用 VS Code 打开"];
  const trigger = page.getByRole("button", { name: "codex-host 项目操作", exact: true });
  for (const nativeAction of ["编辑", "在访达中显示", "移除项目"]) {
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "固定",
      "编辑",
      "分区",
      "在访达中显示",
      ...inserted,
      "归档对话",
      "移除项目",
    ]);
    await page.getByRole("button", { name: "Refresh extension" }).click();
    for (const label of inserted) {
      await expect(menu.getByRole("menuitem", { name: label, exact: true })).toHaveCount(1);
    }
    await menu.getByRole("menuitem", { name: nativeAction, exact: true }).click();
    await expect(menu).toHaveCount(0);
  }
  const calls = await page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture"));
  expect(calls.nativeCalls).toEqual([
    ["local", "edit-project"],
    ["local", "reveal-project-folder"],
    ["local", "remove-project"],
  ]);
  expect(calls.hostCalls).toEqual([]);
});

test("copies the absolute project path and shows an inline success message", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "复制绝对路径", exact: true }).click();
  const calls = await page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture"));
  expect(calls.clipboardCalls).toEqual([["/repo/codex-host"]]);
  expect(calls.hostCalls).toEqual([]);
  expect(calls.events).toEqual(["close", "clipboard"]);
  await expect(page.getByRole("status")).toHaveText("已复制绝对路径");
});

test("opens the project in the preferred terminal with its absolute path", async ({ page }) => {
  await setup(page, { terminalPreference: "ghostty" });
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "在终端中打开", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture").hostCalls))
    .toEqual([["terminal", { path: "/repo/codex-host", terminalId: "ghostty" }]]);
  const calls = await page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture"));
  expect(calls.events).toEqual(["close", "host"]);
  expect(calls.nativeCalls).toEqual([]);
});

test("opens the project in VS Code with its absolute path", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "用 VS Code 打开", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture").hostCalls))
    .toEqual([["workspace", { path: "/repo/codex-host" }]]);
});

test("leaves remote project menus unchanged", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "production-server 项目操作", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.getByRole("button", { name: "Refresh extension" }).click();
  for (const label of ["复制绝对路径", "在终端中打开", "用 VS Code 打开"]) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toHaveCount(0);
  }
  await expect(menu.getByRole("menuitem")).toHaveText([
    "固定",
    "编辑",
    "分区",
    "归档对话",
    "移除项目",
  ]);
  await menu.getByRole("menuitem", { name: "编辑", exact: true }).click();
  const calls = await page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture"));
  expect(calls.nativeCalls).toEqual([["remote", "edit-project"]]);
  expect(calls.hostCalls).toEqual([]);
});

test("disposal removes inserted actions and preserves native selection", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "在终端中打开", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dispose extension" }).click();
  await expect(menu.getByRole("menuitem", { name: "在终端中打开", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "在访达中显示", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "在终端中打开", exact: true })).toHaveCount(0);
});

test("restores the added item after DOM removal and uses the current menu close callback", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  const action = page.getByRole("menuitem", { name: "在终端中打开", exact: true });
  await expect(action).toBeVisible();
  await page.getByRole("button", { name: "Remove added item" }).click();
  await expect(action).toHaveCount(1);
  await page.getByRole("button", { name: "Rerender menu" }).click();
  await expect(action).toHaveCount(1);
  await action.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const events = await page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture").events);
  expect(events).toEqual(["rerender-close", "close", "host"]);
});

test("keyboard navigation crosses inserted items and Space opens the focused action", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
  const menu = page.getByRole("menu");
  const reveal = menu.getByRole("menuitem", { name: "在访达中显示", exact: true });
  const action = menu.getByRole("menuitem", { name: "在终端中打开", exact: true });
  await expect(action).toBeVisible();
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(reveal).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "复制绝对路径", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(action).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "用 VS Code 打开", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "移除项目", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "用 VS Code 打开", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(action).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "复制绝对路径", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(reveal).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(menu).toHaveCount(0);
  const calls = await page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture"));
  expect(calls.hostCalls).toEqual([["terminal", { path: "/repo/codex-host" }]]);
  expect(calls.nativeCalls).toEqual([]);
});

for (const viewport of [
  { name: "desktop", width: 960, height: 700 },
  { name: "mobile", width: 390, height: 700 },
]) {
  test(`project action menu fits ${viewport.name}`, async ({ page }, testInfo) => {
    await setup(page, viewport);
    await page.getByRole("button", { name: "codex-host 项目操作", exact: true }).click();
    const menu = page.getByRole("menu");
    const terminal = menu.getByRole("menuitem", { name: "在终端中打开", exact: true });
    await expect(terminal).toBeVisible();
    const initialBounds = await terminal.boundingBox();
    await terminal.hover();
    expect(await terminal.boundingBox()).toEqual(initialBounds);
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(terminal).toBeFocused();
    const geometry = await menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const items = Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      return {
        insideViewport:
          bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
        overflowing: element.scrollWidth > element.clientWidth + 1,
        overlapping: items.some((item, index) => {
          const next = items[index + 1];
          return next && item.getBoundingClientRect().bottom > next.getBoundingClientRect().top + 1;
        }),
        textOverflow: items.some((item) => item.scrollWidth > item.clientWidth + 1),
      };
    });
    expect(geometry).toEqual({
      insideViewport: true,
      overflowing: false,
      overlapping: false,
      textOverflow: false,
    });
    await page.screenshot({ path: testInfo.outputPath(`project-actions-${viewport.name}.png`) });
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectActionsFixture").hostCalls))
      .toEqual([["terminal", { path: "/repo/codex-host" }]]);
  });
}
