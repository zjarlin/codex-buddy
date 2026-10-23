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
      import { installProjectTabs } from "./packages/renderer-extension/src/project-tabs/index.ts";
      import { installRendererProjectActions } from "./packages/renderer-extension/src/renderer-project-actions.ts";
      globalThis.setup = ({ dark = false, corrupt = false, failSave = false, persistentHost = false, initialConfig = null, recent = null, threads = false } = {}) => {
        document.documentElement.lang = "zh-CN";
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
        document.body.innerHTML = '<style>body{margin:0;font:14px/1.5 system-ui;background:light-dark(#fff,#202020);color:light-dark(#222,#eee)}aside{width:310px;padding:12px;background:light-dark(#fafafa,#252525);min-height:100vh;box-sizing:border-box}h2{font-size:14px;color:#888;margin:8px}button{color:inherit;cursor:pointer}section>div[role=listitem]{padding:10px 8px}.row{display:flex;gap:8px}.row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row button{border:0;background:transparent}.thread{margin:8px 0 4px 22px;color:#888}nav{display:flex;gap:5px;padding:8px}nav button{border:1px solid #8885;border-radius:5px;padding:4px 8px;background:transparent}[role=menu]{position:fixed;top:170px;left:100px;z-index:10;background:light-dark(#fff,#292929);padding:6px;border:1px solid #8884;border-radius:8px;min-width:180px;box-shadow:0 4px 18px #0002}[role=menuitem]{padding:5px 8px;border-radius:4px}[role=menuitem]:focus{background:#8883;outline:none}footer{padding:12px;display:flex;gap:4px;flex-wrap:wrap}</style><aside id="app-shell-sidebar"><h2>项目</h2><nav><button id="all">全部</button><button id="active">进行中</button></nav><section id="projects"></section><footer><button id="create" data-app-action-sidebar-project-create>创建项目</button><button id="rename">重命名公司项目</button><button id="rerender">重新渲染项目</button><button id="dispose">卸载扩展</button><button id="restart">重新安装扩展</button></footer></aside>';
        const projects = [
          { projectKind: "remote", hostId: "office", projectId: "one", label: "remote_company_okmy-scada" },
          { projectKind: "remote", hostId: "office", projectId: "two", label: "remote_zjarlin_codex-host" },
          { projectKind: "remote", hostId: "home", projectId: "one", label: "remote_company_official-app" },
          { projectKind: "local", projectId: "local", label: "other-project" },
        ];
        const fiber = (props, parent = null, key = null) => ({ memoizedProps: props, return: parent, key });
        const bind = (element, value) => Object.defineProperty(element, "__reactFiber$fixture", { enumerable: true, value });
        const render = (active = false) => {
          document.querySelectorAll('[data-sidebar-project-container-id]').forEach(el => el.remove());
          const projectsRoot = document.querySelector("#projects");
          if (!projectsRoot.querySelector(".project-spacer")) {
            const spacer = document.createElement("div");
            spacer.className = "project-spacer";
            spacer.style.height = "80px";
            projectsRoot.prepend(spacer);
          }
          for (const [index, project] of projects.entries()) {
            if (active && index !== 1) continue;
            const container = document.createElement("div");
            container.setAttribute("role", "listitem");
            container.setAttribute("aria-label", project.label);
            container.setAttribute("data-sidebar-project-kind", project.projectKind);
            container.setAttribute("data-sidebar-project-container-id", "project:" + project.projectId);
            const owner = fiber({ group: project });
            bind(container, fiber({}, owner));
            const header = document.createElement("div"); header.className = "row";
            const label = document.createElement("span"); label.textContent = project.label;
            const trigger = document.createElement("button"); trigger.textContent = "…"; trigger.setAttribute("aria-label", project.label + " 项目操作");
            trigger.onclick = () => {
              document.querySelector('[role=menu]')?.remove();
              const menu = document.createElement("div"); menu.setAttribute("role", "menu");
              const close = () => { menu.remove(); trigger.focus(); };
              const items = ["edit-project", ...(project.projectKind === "local" ? ["reveal-project-folder"] : []), "remove-project"];
              const projectValue = project.projectKind === "local" ? { ...project, path: "/workspace/" + project.projectId } : project;
              const menuOwner = fiber({ getContextMenuItems: () => items.map(id => ({id})), triggerAriaLabel: project.label, onOpenChange: close }, fiber({ project: projectValue }));
              for (const [i, id] of items.entries()) {
                const item = document.createElement("div"); item.setAttribute("role", "menuitem"); item.tabIndex = -1;
                item.textContent = ({"edit-project":"编辑", "reveal-project-folder":"在访达中显示", "remove-project":"移除项目"})[id];
                bind(item, fiber({}, fiber({}, menuOwner, id)));
                item.onclick = close; menu.append(item);
              }
              menu.onkeydown = event => {
                if (event.key === "Escape") close();
                const entries = [...menu.querySelectorAll('[role=menuitem]')].filter(el => !el.hasAttribute('data-codexhost-project-tab-move') && !el.hasAttribute('data-codexhost-project-actions'));
                const i = entries.indexOf(document.activeElement);
                if (event.key === "ArrowDown") { event.preventDefault(); entries[(i + 1) % entries.length]?.focus(); }
                if (event.key === "ArrowUp") { event.preventDefault(); entries[(i - 1 + entries.length) % entries.length]?.focus(); }
                if (event.key === "Enter") entries[i]?.click();
              };
              document.body.append(menu); menu.firstElementChild.focus();
            };
            header.append(label, trigger);
            const thread = document.createElement(threads ? "button" : "div"); thread.className = "thread"; thread.textContent = index === 1 ? "正在处理项目任务" : "暂无聊天";
            if (threads) {
              const threadHostId = project.hostId || "local";
              const threadId = "thread-" + index + "-" + project.projectId;
              const threadAttributes = {
                "data-app-action-sidebar-thread-row": "",
                "data-app-action-sidebar-thread-host-id": threadHostId,
                "data-app-action-sidebar-thread-id": threadHostId + ":" + threadId,
              };
              for (const [name, value] of Object.entries(threadAttributes)) thread.setAttribute(name, value);
              bind(thread, fiber({ conversationId: threadId, dataAttributes: threadAttributes }));
              thread.onclick = () => thread.setAttribute("data-app-action-sidebar-thread-active", "true");
            }
            container.append(header, thread); projectsRoot.append(container);
          }
        };
        if (initialConfig) localStorage.setItem("codexhost.project-tabs.v1", JSON.stringify(initialConfig));
        if (corrupt) localStorage.setItem("codexhost.project-tabs.v1", "broken");
        if (failSave) Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); };
        render();
        if (recent) {
          const sections = document.createElement("div");
          document.querySelector("#projects").after(sections);
          globalThis.nativeSectionCalls = [];
          const mount = (heading, label, collapsed = false) => {
            const section = document.createElement("section");
            section.setAttribute("data-app-action-sidebar-section", "");
            section.setAttribute("data-app-action-sidebar-section-heading", heading);
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.textContent = label;
            toggle.setAttribute("data-app-action-sidebar-section-toggle", "");
            const content = document.createElement("p");
            content.textContent = label + "会话列表";
            const renderState = () => {
              section.setAttribute("data-app-action-sidebar-section-collapsed", String(collapsed));
              toggle.setAttribute("aria-expanded", String(!collapsed));
              content.hidden = collapsed;
            };
            toggle.onclick = () => {
              collapsed = !collapsed;
              globalThis.nativeSectionCalls.push([heading, collapsed]);
              renderState();
            };
            renderState();
            section.append(toggle, content);
            sections.append(section);
          };
          mount("Pinned", "置顶");
          mount("Unreads", "未读");
          if (recent !== "late") mount("Recents", "最近", recent === "collapsed");
          const remount = document.createElement("button");
          remount.textContent = "加载最近分区";
          remount.onclick = () => {
            sections.querySelector('[data-app-action-sidebar-section-heading="Recents"]')?.remove();
            mount("Recents", "最近");
          };
          document.querySelector("footer").append(remount);
        }
        const actions = installRendererProjectActions({ getClient: () => ({}), getLocale: () => "zh-CN" });
        let hostConfig = null;
        let hostReads = 0;
        let hostReadError = null;
        let saveGate = null;
        let releaseSave = null;
        globalThis.pauseProjectTabSaves = () => {
          saveGate = new Promise(resolve => { releaseSave = resolve; });
        };
        globalThis.resumeProjectTabSaves = () => {
          saveGate = null;
          releaseSave?.();
        };
        const hostClient = {
          getProjectTabs: async () => {
            hostReads += 1;
            if (hostReadError) throw new Error(hostReadError);
            return { config: hostConfig };
          },
          setProjectTabs: async (config) => {
            if (saveGate) await saveGate;
            return { config: hostConfig = structuredClone(config) };
          },
        };
        globalThis.delayedHost = false;
        const projectTabsOptions = () => ({
          getLocale: () => "zh-CN",
          ...(persistentHost
            ? { getClient: () => (globalThis.delayedHost ? null : hostClient) }
            : {}),
        });
        let control = installProjectTabs(projectTabsOptions());
        globalThis.revealProjectThread = (input) => control.revealThread(input);
        globalThis.projectTabsHostState = () => structuredClone(hostConfig);
        globalThis.projectTabsHostReads = () => hostReads;
        globalThis.projectTabsHostError = (message) => { hostReadError = message; };
        globalThis.projectTabsConnectHost = () => control.refresh();
        let createdProjects = 0;
        document.querySelector("#create").onclick = () => {
          createdProjects += 1;
          projects.unshift({
            projectKind: "remote",
            hostId: "office",
            projectId: "created-" + createdProjects,
            label: "新建项目 " + createdProjects,
          });
          render();
        };
        globalThis.restartProjectTabs = (clearLocal = false) => {
          control.dispose();
          if (clearLocal) localStorage.removeItem("codexhost.project-tabs.v1");
          control = installProjectTabs(projectTabsOptions());
          globalThis.revealProjectThread = (input) => control.revealThread(input);
        };
        document.querySelector("#all").onclick = () => render(false);
        document.querySelector("#active").onclick = () => render(true);
        document.querySelector("#rerender").onclick = () => render();
        document.querySelector("#rename").onclick = () => { projects[0].label = "renamed-company"; render(); };
        document.querySelector("#dispose").onclick = () => { control.dispose(); actions.dispose(); };
        document.querySelector("#restart").onclick = () => globalThis.restartProjectTabs();
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
    throw new Error("Project tabs fixture bundle missing");
  }
  return source;
})();
async function setup(
  page: Page,
  options: {
    dark?: boolean;
    corrupt?: boolean;
    failSave?: boolean;
    persistentHost?: boolean;
    initialConfig?: unknown;
    width?: number;
    recent?: "expanded" | "collapsed" | "late";
    threads?: boolean;
  } = {},
) {
  await page.setViewportSize({ width: options.width ?? 960, height: 760 });
  await page.route("http://localhost/project-tabs-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto("http://localhost/project-tabs-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((options) => Reflect.get(globalThis, "setup")(options), options);
}
const rows = (page: Page) => page.locator('[role="listitem"]:visible');
const category = (page: Page, name: string) =>
  page.getByRole("group", { name: "项目 Tab 配置" }).getByRole("button", { name, exact: true });
const settings = (page: Page) => page.getByRole("button", { name: "配置项目 Tab", exact: true });

for (const recent of ["expanded", "collapsed"] as const) {
  test(`Recents starts collapsed and resets only when the selected category changes (${recent})`, async ({
    page,
  }, info) => {
    await setup(page, { recent, persistentHost: true });
    const toggle = page.getByRole("button", { name: "最近", exact: true });
    const content = page.getByText("最近会话列表", { exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(content).toBeHidden();
    expect(await page.evaluate(() => Reflect.get(globalThis, "nativeSectionCalls"))).toEqual(
      recent === "expanded" ? [["Recents", true]] : [],
    );
    await page.screenshot({ path: info.outputPath("recent-collapsed.png") });

    await toggle.click();
    await expect(content).toBeVisible();
    await page.getByRole("button", { name: "重新渲染项目", exact: true }).click();
    await category(page, "项目").click();
    await expect(content).toBeVisible();
    await page.screenshot({ path: info.outputPath("recent-expanded.png") });

    await category(page, "公司的项目").click();
    await expect(content).toBeHidden();
    await toggle.click();
    await expect(content).toBeVisible();
    await category(page, "个人的项目").click();
    await expect(content).toBeHidden();
    await page.screenshot({ path: info.outputPath("recent-after-tab.png") });

    await toggle.click();
    await page.getByRole("button", { name: "重新安装扩展", exact: true }).click();
    await expect(content).toBeHidden();
    await expect(page.getByRole("button", { name: "置顶", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("button", { name: "未读", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
}

test("reveals a completed conversation by switching to its project tab", async ({ page }) => {
  await setup(page, { threads: true });
  const company = category(page, "公司的项目");
  await category(page, "个人的项目").click();

  const project = page.locator(
    '[data-sidebar-project-container-id="project:one"][aria-label="remote_company_okmy-scada"]',
  );
  const thread = page.locator('[data-app-action-sidebar-thread-id="office:thread-0-one"]');
  await expect(project).toBeHidden();

  expect(
    await page.evaluate(() =>
      Reflect.get(
        globalThis,
        "revealProjectThread",
      )({
        hostId: "office",
        threadId: "thread-0-one",
        project: "remote_company_okmy-scada",
      }),
    ),
  ).toBe("remote_company_okmy-scada");
  await expect(company).toHaveAttribute("aria-pressed", "true");
  await expect(project).toBeVisible();
  await expect(thread).toBeVisible();

  // Thread 行尚未挂载时，提醒记录里的项目显示名仍足以切到正确 Tab。
  await category(page, "个人的项目").click();
  await thread.evaluate((element) => element.remove());
  expect(
    await page.evaluate(() =>
      Reflect.get(
        globalThis,
        "revealProjectThread",
      )({
        hostId: "office",
        threadId: "thread-0-one",
        project: "remote_company_okmy-scada",
      }),
    ),
  ).toBe("remote_company_okmy-scada");
  await expect(company).toHaveAttribute("aria-pressed", "true");
  await expect(project).toBeVisible();
});

test("Recents arriving after startup or remounting is collapsed; disposal stops the policy", async ({
  page,
}, info) => {
  await setup(page, { recent: "late" });
  const mount = page.getByRole("button", { name: "加载最近分区", exact: true });
  const toggle = page.getByRole("button", { name: "最近", exact: true });
  await expect(toggle).toHaveCount(0);
  await category(page, "公司的项目").click();
  await mount.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await mount.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: info.outputPath("recent-remounted.png") });

  await page.getByRole("button", { name: "卸载扩展", exact: true }).click();
  await mount.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: info.outputPath("recent-disposed.png") });
});

test("migrates local tabs to the Host and restores them without localStorage", async ({ page }) => {
  const initialConfig = {
    version: 2,
    tabs: [{ id: "custom", name: "自定义", prefixes: ["other"] }],
    assignments: {},
    selected: "custom",
  };
  await setup(page, { persistentHost: true, initialConfig });
  await expect(category(page, "自定义")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toEqual(initialConfig);

  await page.evaluate(() => Reflect.get(globalThis, "restartProjectTabs")(true));
  await expect(category(page, "自定义")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toContainText("other-project");
});

test("switches immediately during a blocked Host save and preserves the latest selection and button focus", async ({
  page,
}) => {
  await setup(page, { persistentHost: true });
  await page.evaluate(() => Reflect.get(globalThis, "pauseProjectTabSaves")());
  const company = category(page, "公司的项目");
  const companyButton = await company.elementHandle();
  await company.click();
  await expect(company).toHaveAttribute("aria-pressed", "true");
  await expect(company).toBeFocused();
  await expect(rows(page)).toHaveCount(2);
  await category(page, "个人的项目").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("remote_zjarlin_codex-host");
  await company.click();
  await expect(company).toHaveAttribute("aria-pressed", "true");
  expect(await companyButton?.evaluate((element) => element.isConnected)).toBe(true);
  const infrequent = category(page, "不常用");
  await infrequent.click();
  await expect(infrequent).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(0);
  await page.evaluate(() => Reflect.get(globalThis, "resumeProjectTabSaves")());
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()?.selected))
    .toBe("infrequent");
  await expect(infrequent).toBeFocused();
  await page.evaluate(() => Reflect.get(globalThis, "restartProjectTabs")(true));
  await expect(category(page, "不常用")).toHaveAttribute("aria-pressed", "true");
});

test("prefix tabs intersect native activity filters and survive row rerendering", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  await expect(category(page, "项目")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("other-project");
  await expect(
    page.locator("#projects > [data-codexhost-project-tabs] ~ .project-spacer"),
  ).toHaveCount(1);
  await category(page, "公司的项目").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("remote_company_okmy-scada");
  await page.getByRole("button", { name: "重新渲染项目", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "进行中", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("当前分类下没有项目");
  await category(page, "个人的项目").click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("filtered.png") });
  await category(page, "项目").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("other-project");
  expect(errors).toEqual([]);
});

test("creating a project while a custom tab is selected assigns it to that tab", async ({
  page,
}, info) => {
  await setup(page, { persistentHost: true });
  await category(page, "公司的项目").click();
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page)).toContainText("新建项目 1");
  await page.screenshot({ path: info.outputPath("created-in-tab.png") });

  await category(page, "项目").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).not.toContainText("新建项目 1");

  await page.getByRole("button", { name: "重新安装扩展", exact: true }).click();
  await category(page, "公司的项目").click();
  await expect(rows(page)).toContainText("新建项目 1");
});

test("searches project tabs by name and activates the chosen tab", async ({ page }, info) => {
  const initialConfig = {
    version: 2,
    tabs: [
      { id: "company", name: "remote_company_okmy_scada", prefixes: ["remote_company"] },
      { id: "personal", name: "remote_zjarlin_codex_host", prefixes: ["remote_zjarlin"] },
      { id: "infrequent", name: "不常用", prefixes: [] },
    ],
    assignments: {},
    selected: null,
  };
  await setup(page, { persistentHost: true, initialConfig });
  await expect(category(page, "项目")).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "搜索项目 Tab", exact: true }).click();
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  await expect(page.getByRole("option", { name: /remote_company_okmy_scada/ })).toBeVisible();

  await search.fill("codex_host");
  const match = page.getByRole("option", { name: /remote_zjarlin_codex_host/ });
  await expect(match).toBeVisible();
  await page.screenshot({ path: info.outputPath("tab-search.png") });
  await page.keyboard.press("Enter");

  await expect(category(page, "remote_zjarlin_codex_host")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(rows(page)).toContainText("remote_zjarlin_codex-host");

  await page.keyboard.press("/");
  await expect(page.getByRole("combobox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("slash opens tab search only inside the sidebar", async ({ page }) => {
  await setup(page);
  await page.locator("#rename").focus();
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("manual move overrides prefixes, survives rename/reinstall and restores automatic rules", async ({
  page,
}, info) => {
  await setup(page, { dark: true });
  await category(page, "公司的项目").click();
  await page
    .getByRole("button", { name: "remote_company_okmy-scada 项目操作", exact: true })
    .click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "移动到 Tab…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("move.png") });
  await dialog.getByRole("button", { name: "不常用", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("remote_company_official-app");
  await category(page, "项目").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("other-project");
  await category(page, "不常用").click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "重命名公司项目", exact: true }).click();
  await page.getByRole("button", { name: "重新安装扩展", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("renamed-company");
  await page.getByRole("button", { name: "renamed-company 项目操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "移动到 Tab…" }).click();
  await dialog.getByRole("button", { name: "按规则自动分类", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await category(page, "公司的项目").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("remote_company_official-app");
  await category(page, "项目").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("renamed-company");
});

test("moving a project hides it from Projects immediately and after reinstall", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  await expect(rows(page)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("projects-before.png") });
  await page.getByRole("button", { name: "other-project 项目操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "移动到 Tab…" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("project-menu.png") });
  await page.getByRole("menuitem", { name: "移动到 Tab…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("project-destinations.png") });
  await dialog.getByRole("button", { name: "不常用", exact: true }).click();
  await expect(category(page, "项目")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("当前分类下没有项目");
  await page.screenshot({ path: info.outputPath("projects-after-move.png") });
  await page.getByRole("button", { name: "重新安装扩展", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("status")).toBeVisible();
  await page.screenshot({ path: info.outputPath("projects-after-reinstall.png") });
  await category(page, "不常用").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("other-project");
  await page.screenshot({ path: info.outputPath("destination-tab.png") });
  await page.getByRole("button", { name: "other-project 项目操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "移动到 Tab…" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("restore-menu.png") });
  await page.getByRole("menuitem", { name: "移动到 Tab…" }).click();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("restore-destinations.png") });
  await dialog.getByRole("button", { name: "按规则自动分类", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("destination-after-restore.png") });
  await category(page, "项目").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("other-project");
  await expect(page.getByRole("status")).toBeHidden();
  await page.screenshot({ path: info.outputPath("projects-restored.png") });
  expect(errors).toEqual([]);
});

for (const dark of [false, true]) {
  test(`configuration adds, validates, cancels and deletes tabs (${dark ? "dark" : "light"})`, async ({
    page,
  }, info) => {
    await setup(page, { dark, width: 390 });
    await settings(page).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "添加 Tab", exact: true }).click();
    const added = dialog.locator("fieldset").last();
    await added.getByLabel("Tab 名称", { exact: true }).fill("其他项目");
    await added.getByLabel("项目名前缀", { exact: true }).fill("other\nextra_");
    await page.screenshot({ path: info.outputPath("settings.png") });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await category(page, "其他项目").click();
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "other-project 项目操作", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "在终端中打开" })).toBeVisible();
    await page.keyboard.press("Escape");
    await settings(page).click();
    await dialog
      .locator("fieldset")
      .first()
      .getByLabel("Tab 名称", { exact: true })
      .fill("其他项目");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(category(page, "公司的项目")).toBeVisible();
    await settings(page).click();
    await dialog
      .locator("fieldset")
      .last()
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(category(page, "项目")).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("other-project");
    await category(page, "公司的项目").click();
    await page.getByRole("button", { name: "卸载扩展", exact: true }).click();
    await expect(rows(page)).toHaveCount(4);
    await expect(settings(page)).toHaveCount(0);
  });
}

test("project tabs recover when the Host client arrives after a rejected local read", async ({
  page,
}, info) => {
  await setup(page, { corrupt: true, persistentHost: true });
  const alert = page.locator("[data-codexhost-project-tabs-error]");
  const state = () => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")());
  await expect.poll(state).toBeNull();
  await expect(alert).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("codexhost.project-tabs.v1")))
    .toBeNull();

  // 常驻 Host 客户端晚到不是失败：Tab 仍可切换，客户端到达后补写进 Host。
  await page.evaluate(() => {
    Reflect.set(globalThis, "delayedHost", true);
    Reflect.get(globalThis, "restartProjectTabs")();
  });
  await category(page, "个人的项目").click();
  await expect(category(page, "个人的项目")).toHaveAttribute("aria-pressed", "true");
  await expect(alert).toBeHidden();
  await expect.poll(state).toBeNull();
  await page.evaluate(() => {
    Reflect.set(globalThis, "delayedHost", false);
    Reflect.get(globalThis, "projectTabsConnectHost")();
  });
  await expect.poll(state).toMatchObject({ selected: "personal" });
  await expect(category(page, "个人的项目")).toHaveAttribute("aria-pressed", "true");
  await expect(alert).toBeHidden();
  await page.screenshot({ path: info.outputPath("late-host-flushed.png") });
});

test("a corrupt local mirror does not fail a successful empty Host read", async ({
  page,
}, info) => {
  await setup(page, { corrupt: true, persistentHost: true });
  const alert = page.locator("[data-codexhost-project-tabs-error]");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostReads")()))
    .toBeGreaterThan(0);
  // 损坏镜像不是已保存的配置：Host 成功返回空时回到预置 Tab，且不会再
  // 以“Host 为空 + 镜像损坏”报读写失败。
  await expect(alert).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toBeNull();
  await expect(category(page, "项目")).toHaveAttribute("aria-pressed", "true");
  // 默认配置未选中任何 Tab，因此只有不属于任何 Tab 的项目可见。
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("other-project");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("codexhost.project-tabs.v1")))
    .toBeNull();
  await page.screenshot({ path: info.outputPath("corrupt-mirror-recovered.png") });

  await category(page, "公司的项目").click();
  await expect(category(page, "公司的项目")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toMatchObject({ selected: "company" });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("codexhost.project-tabs.v1");
        return raw === null ? null : JSON.parse(raw).selected;
      }),
    )
    .toBe("company");
  await expect(alert).toBeHidden();
  await page.screenshot({ path: info.outputPath("corrupt-mirror-saved.png") });
});

test("a Host-backed mirror follows cross-window changes without surfacing their storage errors", async ({
  page,
}, info) => {
  await setup(page, { persistentHost: true });
  const alert = page.locator("[data-codexhost-project-tabs-error]");
  const reads = () => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostReads")());
  await expect.poll(reads).toBeGreaterThan(0);
  await expect(alert).toBeHidden();
  // 让出一次事件循环，确保首次读取的续体已经记录 loadedClient，再触发
  // storage 校正路径。
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toBeNull();
  const initialReads = await reads();

  await page.evaluate(() => {
    localStorage.setItem("codexhost.project-tabs.v1", "broken");
    window.dispatchEvent(new StorageEvent("storage", { key: "codexhost.project-tabs.v1" }));
  });
  await expect.poll(reads).toBeGreaterThan(initialReads);
  await expect(alert).toBeHidden();
  // 损坏镜像被静默忽略，Host 仍为空，界面保持预置分类。
  await expect(category(page, "项目")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toBeNull();

  await page.evaluate(() => {
    const next = {
      version: 2,
      tabs: [{ id: "work", name: "工作", prefixes: ["remote_company"] }],
      assignments: {},
      selected: "work",
    };
    localStorage.setItem("codexhost.project-tabs.v1", JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: "codexhost.project-tabs.v1" }));
  });
  await expect(alert).toBeHidden();
  await expect(category(page, "工作")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(2);
  // Host 为空而镜像有效时迁移进 Host，随后以 Host 结果为准。
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toMatchObject({ selected: "work" });
  await page.screenshot({ path: info.outputPath("host-mirror-synced.png") });

  await page.evaluate(() => Reflect.get(globalThis, "projectTabsHostError")("Host unavailable"));
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "codexhost.project-tabs.v1" }));
  });
  await expect(alert).toContainText("Host unavailable");
  await page.screenshot({ path: info.outputPath("host-error-after-storage.png") });
});

test("a selection made before the Host client arrives is flushed before Host is read", async ({
  page,
}, info) => {
  await setup(page, { persistentHost: true });
  const alert = page.locator("[data-codexhost-project-tabs-error]");
  await expect(alert).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostReads")()))
    .toBeGreaterThan(0);

  // 模拟常驻 Host 客户端晚到：选择与配置都只落在本地镜像，不能报读写失败。
  await page.evaluate(() => {
    Reflect.set(globalThis, "delayedHost", true);
    const next = {
      version: 2,
      tabs: [
        { id: "company", name: "公司的项目", prefixes: ["remote_company"] },
        { id: "personal", name: "个人的项目", prefixes: ["remote_zjarlin"] },
      ],
      assignments: {},
      selected: "personal",
    };
    localStorage.setItem("codexhost.project-tabs.v1", JSON.stringify(next));
    Reflect.get(globalThis, "restartProjectTabs")();
  });
  await expect(category(page, "个人的项目")).toHaveAttribute("aria-pressed", "true");
  await category(page, "公司的项目").click();
  await expect(category(page, "公司的项目")).toHaveAttribute("aria-pressed", "true");
  await expect(alert).toBeHidden();
  // 客户端尚未到达时，Host 不能被读取或写入。
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toBeNull();
  const readsBeforeConnect = await page.evaluate(() =>
    Reflect.get(globalThis, "projectTabsHostReads")(),
  );

  await page.evaluate(() => {
    Reflect.set(globalThis, "delayedHost", false);
    Reflect.get(globalThis, "projectTabsConnectHost")();
  });
  // 客户端到达后先补写本地选择，读取结果不得把界面退回旧配置。
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostState")()))
    .toMatchObject({ selected: "company" });
  await expect(category(page, "公司的项目")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "projectTabsHostReads")()))
    .toBeGreaterThan(readsBeforeConnect);
  await expect(alert).toBeHidden();
  await page.screenshot({ path: info.outputPath("delayed-host-flushed.png") });
});

test("storage errors are visible and failed saves keep the form open", async ({ page }, info) => {
  await setup(page, { corrupt: true, failSave: true });
  await expect(page.getByRole("alert")).toContainText("项目 Tab 配置读写失败");
  await settings(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Storage unavailable");
  await page.screenshot({ path: info.outputPath("storage-error.png") });
  await expect(dialog).toBeVisible();
});
