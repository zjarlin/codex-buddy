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
      globalThis.setup = ({ dark = false, corrupt = false, failSave = false, persistentHost = false, initialConfig = null, recent = null } = {}) => {
        document.documentElement.lang = "zh-CN";
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
        document.body.innerHTML = '<style>body{margin:0;font:14px/1.5 system-ui;background:light-dark(#fff,#202020);color:light-dark(#222,#eee)}aside{width:310px;padding:12px;background:light-dark(#fafafa,#252525);min-height:100vh;box-sizing:border-box}h2{font-size:14px;color:#888;margin:8px}button{color:inherit;cursor:pointer}section>div[role=listitem]{padding:10px 8px}.row{display:flex;gap:8px}.row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row button{border:0;background:transparent}.thread{margin:8px 0 4px 22px;color:#888}nav{display:flex;gap:5px;padding:8px}nav button{border:1px solid #8885;border-radius:5px;padding:4px 8px;background:transparent}[role=menu]{position:fixed;top:170px;left:100px;z-index:10;background:light-dark(#fff,#292929);padding:6px;border:1px solid #8884;border-radius:8px;min-width:180px;box-shadow:0 4px 18px #0002}[role=menuitem]{padding:5px 8px;border-radius:4px}[role=menuitem]:focus{background:#8883;outline:none}footer{padding:12px;display:flex;gap:4px;flex-wrap:wrap}</style><aside id="app-shell-sidebar"><h2>项目</h2><nav><button id="all">全部</button><button id="active">进行中</button></nav><section id="projects"></section><footer><button id="rename">重命名公司项目</button><button id="rerender">重新渲染项目</button><button id="dispose">卸载扩展</button><button id="restart">重新安装扩展</button></footer></aside>';
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
              const menuOwner = fiber({ getContextMenuItems: () => items.map(id => ({id})), triggerAriaLabel: project.label, onOpenChange: close }, fiber({ project }));
              for (const [i, id] of items.entries()) {
                const item = document.createElement("div"); item.setAttribute("role", "menuitem"); item.tabIndex = -1;
                item.textContent = ({"edit-project":"编辑", "reveal-project-folder":"在访达中显示", "remove-project":"移除项目"})[id];
                bind(item, fiber({}, fiber({}, menuOwner, id)));
                item.onclick = close; menu.append(item);
              }
              menu.onkeydown = event => {
                if (event.key === "Escape") close();
                const entries = [...menu.querySelectorAll('[role=menuitem]')].filter(el => !el.hasAttribute('data-codexhost-project-tab-move') && !el.hasAttribute('data-codexhost-project-actions-open-doubao'));
                const i = entries.indexOf(document.activeElement);
                if (event.key === "ArrowDown") { event.preventDefault(); entries[(i + 1) % entries.length]?.focus(); }
                if (event.key === "ArrowUp") { event.preventDefault(); entries[(i - 1 + entries.length) % entries.length]?.focus(); }
                if (event.key === "Enter") entries[i]?.click();
              };
              document.body.append(menu); menu.firstElementChild.focus();
            };
            header.append(label, trigger);
            const thread = document.createElement("div"); thread.className = "thread"; thread.textContent = index === 1 ? "正在处理项目任务" : "暂无聊天";
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
        const actions = installRendererProjectActions({ getClient: () => ({openDoubao: async () => ({opened:true})}), getLocale: () => "zh-CN" });
        let hostConfig = null;
        const hostClient = {
          getProjectTabs: async () => ({ config: hostConfig }),
          setProjectTabs: async (config) => ({ config: hostConfig = structuredClone(config) }),
        };
        const projectTabsOptions = () => ({
          getLocale: () => "zh-CN",
          ...(persistentHost ? { getClient: () => hostClient } : {}),
        });
        let control = installProjectTabs(projectTabsOptions());
        globalThis.projectTabsHostState = () => structuredClone(hostConfig);
        globalThis.restartProjectTabs = (clearLocal = false) => {
          control.dispose();
          if (clearLocal) localStorage.removeItem("codexhost.project-tabs.v1");
          control = installProjectTabs(projectTabsOptions());
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
    await expect(page.getByRole("menuitem", { name: "在 Doubao 中打开" })).toBeVisible();
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
