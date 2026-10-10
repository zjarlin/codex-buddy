import type { GitWorkspaceStatus } from "@codexhost/shared-contracts";

type Change = GitWorkspaceStatus["changes"][number];

export const gitScmStyles = `
  [hidden] { display:none !important; }
  .codexhost-git-workspace { overflow:auto; }
  .codexhost-git-primary { flex:none; min-width:0; }
  .codexhost-git-repository-groups { overflow:visible; max-height:none; border:0; }
  .codexhost-git-repository-bar { display:flex; min-width:0; align-items:center; height:30px; border-top:1px solid var(--border-default,color-mix(in srgb,currentColor 12%,transparent)); }
  .codexhost-git-repository-header { flex:1; min-width:0; padding:0 6px; gap:5px; min-height:30px; }
  .codexhost-git-repository-header .codexhost-git-repository-meta { overflow:hidden; text-overflow:ellipsis; max-width:45%; }
  .codexhost-git-repository-toolbar { display:flex; flex:none; gap:1px; padding-right:4px; }
  .codexhost-git-repository-toolbar button { display:grid; place-items:center; width:23px; height:24px; padding:2px; color:inherit; border:0; background:transparent; cursor:pointer; }
  .codexhost-git-repository-toolbar svg { width:15px; height:15px; }
  .codexhost-git-repository-toolbar button:hover { background:color-mix(in srgb,currentColor 10%,transparent); }
  .codexhost-git-repository-toolbar button:disabled { opacity:.35; cursor:default; }
  .codexhost-git-repository-icon { width:14px; height:14px; flex:none; }
  .codexhost-git-repository-body[hidden], .codexhost-git-change-section[hidden], .codexhost-git-change-list[hidden] { display:none; }
  .codexhost-git-list { flex:none; overflow:visible; border:0; }
  .codexhost-git-change-section { min-width:0; }
  .codexhost-git-change-heading { display:flex; align-items:center; height:27px; padding:0 6px; gap:3px; }
  .codexhost-git-change-heading > button:first-child { display:flex; align-items:center; gap:5px; flex:1; min-width:0; height:27px; padding:0; color:inherit; background:transparent; border:0; font:inherit; font-size:11px; font-weight:600; text-align:left; cursor:pointer; }
  .codexhost-git-change-count { flex:none; min-width:16px; padding:0 4px; border-radius:9px; text-align:center; font-size:10px; background:color-mix(in srgb,currentColor 12%,transparent); }
  .codexhost-git-change-heading > button:not(:first-child) { width:22px; height:22px; padding:2px; border:0; color:inherit; background:transparent; cursor:pointer; }
  .codexhost-git-change-heading svg { width:15px; height:15px; }
  .codexhost-git-change-list { display:flex; flex-direction:column; }
  .codexhost-git-change { display:flex; align-items:center; gap:5px; height:24px; padding:0 7px 0 12px; min-width:0; }
  .codexhost-git-file-icon { display:grid; place-items:center; width:15px; height:16px; flex:none; font:700 9px ui-monospace,monospace; }
  .codexhost-git-file-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:0 1 auto; }
  .codexhost-git-file-directory { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.52; font-size:10px; }
  .codexhost-git-status { margin-left:auto; flex:none; }
  .codexhost-git-row-actions { display:flex; flex:none; }
  .codexhost-git-change-action { width:20px; height:20px; }
  .codexhost-git-change-action svg { width:14px; height:14px; }
  .codexhost-git-row-actions, .codexhost-git-change-heading > button:not(:first-child), .codexhost-git-repository-toolbar { opacity:0; }
  .codexhost-git-change:hover .codexhost-git-row-actions, .codexhost-git-change:focus-within .codexhost-git-row-actions,
  .codexhost-git-change-heading:hover > button, .codexhost-git-change-heading:focus-within > button,
  .codexhost-git-repository-bar:hover .codexhost-git-repository-toolbar, .codexhost-git-repository-bar:focus-within .codexhost-git-repository-toolbar { opacity:1; }
  @media (hover:none) { .codexhost-git-row-actions, .codexhost-git-change-heading > button:not(:first-child), .codexhost-git-repository-toolbar { opacity:1; } }
  .codexhost-git-change:focus-visible, .codexhost-git-directory:focus-visible, .codexhost-git-repository-header:focus-visible { outline:1px solid var(--text-link,#007acc); outline-offset:-1px; }
  .codexhost-git-message { min-height:38px; padding:5px 7px; font:inherit; font-size:11px; line-height:1.5; }
  .codexhost-git-repository-commit { order:-1; border:0; padding:7px 9px; }
  .codexhost-git-commit-actions { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .codexhost-git-commit-actions button[data-primary="true"] { grid-column:1 / -1; }
  .codexhost-git-commit-actions button:not([data-primary="true"]) { min-height:23px; padding:2px; }
  .codexhost-git-commit-box { padding:7px 9px; }
  .codexhost-git-commit-model { font-size:10px; }
  .codexhost-git-commit-model select { padding:2px 4px; }
  .codexhost-git-commit-model button { min-height:23px; padding:2px 5px; }
  .codexhost-git-history { flex:none; max-height:45%; border-top:1px solid var(--border-default,color-mix(in srgb,currentColor 18%,transparent)); }
  .codexhost-git-history-title { display:flex; align-items:center; gap:5px; padding:4px 8px; min-height:29px; }
  .codexhost-git-history-title select { min-width:0; flex:1; color:inherit; font:inherit; border:0; background:var(--surface-primary,Canvas); }
  .codexhost-git-history-row { height:28px; }
  .codexhost-git-history-body { flex-direction:row; align-items:center; gap:5px; }
  .codexhost-git-history-body strong { flex:1; min-width:0; }
  .codexhost-git-history-body span { flex:none; max-width:35%; }
  .codexhost-git-ref { padding:1px 4px; color:#8cc6ff; background:color-mix(in srgb,#339cff 20%,transparent); border-radius:3px; }
  .codexhost-git-message-row { position:relative; min-width:0; }
  .codexhost-git-message-row textarea { padding-right:30px; }
  .codexhost-git-generate-inline { position:absolute; top:3px; right:3px; width:24px; height:24px; padding:3px; color:inherit; background:transparent; border:0; cursor:pointer; }
  .codexhost-git-generate-inline svg { width:16px; height:16px; }
  .codexhost-git-generate-inline:disabled { opacity:.35; cursor:default; }
  .codexhost-git-model-options { font-size:10px; opacity:.7; }
  .codexhost-git-model-options summary { cursor:pointer; }
  .codexhost-git-model-options[open] { opacity:1; }
  .codexhost-git-commit-actions button:disabled { opacity:.45; cursor:default; }
  .codexhost-git-commit-actions.codexhost-git-split { display:flex; gap:0; position:relative; }
  .codexhost-git-split > button[data-primary="true"] { flex:1; min-width:0; border-radius:2px 0 0 2px; }
  .codexhost-git-commit-options { flex:none; }
  .codexhost-git-commit-options > summary { display:grid; place-items:center; width:27px; height:28px; box-sizing:border-box; color:white; background:#007acc; border:1px solid #007acc; border-left-color:#ffffff45; cursor:pointer; list-style:none; border-radius:0 2px 2px 0; }
  .codexhost-git-commit-options > summary::-webkit-details-marker { display:none; }
  .codexhost-git-commit-menu { position:absolute; top:100%; right:0; left:0; z-index:5; display:grid; padding:4px; gap:2px; border:1px solid var(--border-default,#555); background:var(--surface-primary,Canvas); box-shadow:0 4px 12px #0005; }
  .codexhost-git-commit-menu button { display:flex; justify-content:flex-start; gap:8px; width:100%; height:27px; padding:3px 6px; text-align:left; }
`;

export function gitCommitMenu(
  document: Document,
  root: HTMLElement,
  primary: HTMLButtonElement,
  commands: HTMLButtonElement[],
) {
  root.classList.add("codexhost-git-split");
  const details = document.createElement("details");
  details.className = "codexhost-git-commit-options";
  const summary = document.createElement("summary");
  summary.textContent = "⌄";
  summary.setAttribute("aria-label", "更多提交操作");
  const menu = document.createElement("div");
  menu.className = "codexhost-git-commit-menu";
  for (const button of commands) {
    const label = document.createElement("span");
    label.textContent = button.getAttribute("aria-label") ?? button.textContent;
    button.append(label);
    button.addEventListener("click", () => {
      details.open = false;
    });
    menu.append(button);
  }
  details.append(summary, menu);
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      details.open = false;
      summary.focus();
    }
  });
  details.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && !details.contains(event.relatedTarget))
      details.open = false;
  });
  root.replaceChildren(primary, details);
  return details;
}

export function gitIconButton(document: Document, label: string, path: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  })) {
    svg.setAttribute(name, value);
  }
  const shape = document.createElementNS(svg.namespaceURI, "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  button.append(svg);
  return button;
}

export function gitRepositoryIcon(document: Document): Element {
  const button = gitIconButton(document, "仓库", "M4 3h16v18H4zM8 3v18M12 8h4M12 12h4");
  const icon = button.firstElementChild;
  if (!icon) throw new Error("仓库图标未创建。");
  icon.classList.add("codexhost-git-repository-icon");
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function gitRepositoryBranch(status: GitWorkspaceStatus | null): string {
  if (!status) return "";
  const branch = status.detached
    ? `HEAD ${status.head?.slice(0, 7) ?? ""}`
    : (status.branch ?? "未创建分支");
  return `${branch}${status.changes.length ? "*" : ""}${status.ahead ? ` ${status.ahead}↑` : ""}${status.behind ? ` ${status.behind}↓` : ""}`;
}

export function gitMessagePlaceholder(status: GitWorkspaceStatus | null): string {
  const shortcut = /Mac/iu.test(globalThis.navigator?.platform ?? "") ? "⌘Enter" : "Ctrl+Enter";
  return `消息 (${shortcut} 在 "${status?.branch ?? "HEAD"}" 提交)`;
}

function changeStatus(change: Change, staged: boolean) {
  if (change.conflicted) return { code: "!", label: "冲突", color: "#f48771" };
  if (change.untracked) return { code: "U", label: "未跟踪", color: "#73c991" };
  const code = (staged ? change.indexStatus : change.workTreeStatus).trim() || "M";
  const label =
    ({ A: "新增", D: "删除", M: "已修改", R: "重命名", C: "复制" } as Record<string, string>)[
      code
    ] ?? code;
  const color =
    (
      { A: "#73c991", D: "#f48771", M: "#e2c08d", R: "#73c991", C: "#73c991" } as Record<
        string,
        string
      >
    )[code] ?? "inherit";
  return { code, label: staged ? `已暂存 · ${label}` : label, color };
}

function fileIcon(document: Document, change: Change): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "codexhost-git-file-icon";
  icon.setAttribute("aria-hidden", "true");
  const extension = change.path.split(".").at(-1)?.toLowerCase() ?? "";
  const types: Record<string, [string, string]> = {
    ts: ["TS", "#519aba"],
    tsx: ["TS", "#519aba"],
    js: ["JS", "#e5c07b"],
    jsx: ["JS", "#e5c07b"],
    json: ["{}", "#e5c07b"],
    vue: ["V", "#41b883"],
    kt: ["K", "#c78be8"],
    rs: ["R", "#dea584"],
    py: ["Py", "#e5c07b"],
    sql: ["▤", "#d16d9e"],
    md: ["ⓘ", "#519aba"],
    css: ["#", "#519aba"],
    html: ["◇", "#e37933"],
    yml: ["≡", "#cbcb41"],
    yaml: ["≡", "#cbcb41"],
  };
  const [label, color] = change.submodule
    ? ["⑂", "#8cc6ff"]
    : (types[extension] ?? ["◇", "#a8adb4"]);
  icon.textContent = label;
  icon.style.color = color;
  return icon;
}

// 主仓库与子模块共用暂存区语义，部分暂存文件同时出现在两组。
export function renderGitChanges(
  document: Document,
  options: {
    root: HTMLElement;
    status: GitWorkspaceStatus | null;
    repository?: string | undefined;
    primary?: boolean;
    tree: boolean;
    expandedDirectories: Set<string>;
    collapsedSections: Set<string>;
    stageAll?: HTMLButtonElement;
    unstageAll?: HTMLButtonElement;
    isBusy(): boolean;
    onToggle(): void;
    onOpen(path: string, staged: boolean): void;
    onStage(path: string, staged: boolean): void;
  },
) {
  const { root, status } = options;
  root.replaceChildren();
  const workspace = options.repository ?? status?.workspace ?? "";
  const changes = status?.changes ?? [];
  for (const staged of [true, false]) {
    const entries = changes.filter((change) =>
      staged ? change.staged : !change.staged || change.unstaged,
    );
    if (staged && !entries.length) continue;
    const section = document.createElement("section");
    section.className = "codexhost-git-change-section";
    section.dataset.changeGroup = staged ? "staged" : "changes";
    const key = JSON.stringify([workspace, staged]);
    const collapsed = options.collapsedSections.has(key);
    const heading = document.createElement("div");
    heading.className = "codexhost-git-change-heading";
    const toggle = document.createElement("button");
    toggle.type = "button";
    const label = staged ? "暂存的更改" : "更改";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (options.primary)
      toggle.setAttribute(`data-codexhost-git-sidebar-${staged ? "staged" : "changes"}-tab`, "v1");
    toggle.textContent = `${collapsed ? "▸" : "▾"} ${label}`;
    toggle.addEventListener("click", () => {
      if (collapsed) options.collapsedSections.delete(key);
      else options.collapsedSections.add(key);
      options.onToggle();
    });
    const count = document.createElement("span");
    count.className = "codexhost-git-change-count";
    count.textContent = String(entries.length);
    const all = staged ? options.unstageAll : options.stageAll;
    heading.append(toggle, count);
    if (all) heading.append(all);
    const list = document.createElement("div");
    list.className = "codexhost-git-change-list";
    list.hidden = collapsed;
    const row = (change: Change, depth = 0) => {
      const item = document.createElement("div");
      item.className = `codexhost-git-change${options.primary ? "" : " codexhost-git-repository-change"}`;
      item.dataset.path = change.path;
      item.dataset.repository = workspace;
      item.dataset.staged = String(staged);
      item.title = change.originalPath ? `${change.originalPath} → ${change.path}` : change.path;
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      if (depth) item.style.paddingLeft = `${12 + depth * 12}px`;
      const name = document.createElement("span");
      name.className = "codexhost-git-file-name";
      const parts = change.path.split("/");
      name.textContent = parts.pop() ?? change.path;
      const directory = document.createElement("span");
      directory.className = "codexhost-git-file-directory";
      directory.textContent = options.tree ? "" : parts.join("/");
      const info = changeStatus(change, staged);
      const status = document.createElement("span");
      status.className = "codexhost-git-status";
      status.textContent = info.code;
      status.style.color = info.color;
      status.title = info.label;
      status.setAttribute("aria-label", info.label);
      const actions = document.createElement("div");
      actions.className = "codexhost-git-row-actions";
      const action = staged ? "unstage" : "stage";
      const button = gitIconButton(
        document,
        staged ? "取消暂存" : "暂存",
        staged ? "M5 12h14" : "M12 5v14M5 12h14",
      );
      button.className = "codexhost-git-change-action";
      button.dataset.action = action;
      button.dataset.gitAction = `${action}:${change.path}`;
      button.disabled = options.isBusy();
      if (options.primary) button.setAttribute(`data-codexhost-git-sidebar-${action}`, "v1");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onStage(change.path, !staged);
      });
      actions.append(button);
      item.append(fileIcon(document, change), name, directory, actions, status);
      item.addEventListener("click", () => options.onOpen(change.path, staged));
      item.addEventListener("keydown", (event) => {
        if (event.target === item && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          options.onOpen(change.path, staged);
        }
      });
      return item;
    };
    const tree = (entries: Change[], prefix = "", depth = 0) => {
      const folders = new Map<string, Change[]>();
      const files: Change[] = [];
      for (const change of entries) {
        const relative = change.path.slice(prefix.length);
        const slash = relative.indexOf("/");
        if (slash < 0) files.push(change);
        else {
          const folder = relative.slice(0, slash);
          const contents = folders.get(folder) ?? [];
          contents.push(change);
          folders.set(folder, contents);
        }
      }
      for (const [name, entries] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
        const path = `${prefix}${name}`;
        const key = JSON.stringify([workspace, staged, path]);
        const expanded = options.expandedDirectories.has(key);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "codexhost-git-directory";
        button.title = path;
        button.style.paddingLeft = `${8 + depth * 12}px`;
        button.setAttribute("aria-expanded", String(expanded));
        button.textContent = `${expanded ? "▾" : "▸"} ${name}`;
        const count = document.createElement("span");
        count.className = "codexhost-git-directory-count";
        count.textContent = String(entries.length);
        button.append(count);
        button.addEventListener("click", () => {
          if (expanded) options.expandedDirectories.delete(key);
          else options.expandedDirectories.add(key);
          options.onToggle();
        });
        list.append(button);
        if (expanded) tree(entries, `${path}/`, depth + 1);
      }
      for (const file of files) list.append(row(file, depth));
    };
    if (options.tree) tree(entries);
    else if (entries.length > 300) {
      // 大量文件只创建当前可见行，滚动时仍保留完整 Git 路径与操作语义。
      list.style.height = "min(360px,45vh)";
      list.style.overflow = "auto";
      let renderedStart = -1;
      const renderWindow = () => {
        const count = 24;
        const start = Math.min(
          Math.max(0, Math.floor(list.scrollTop / 24) - 4),
          entries.length - count,
        );
        if (start === renderedStart) return;
        renderedStart = start;
        const before = document.createElement("div");
        before.style.cssText = `flex:none;height:${start * 24}px`;
        const after = document.createElement("div");
        after.style.cssText = `flex:none;height:${(entries.length - start - count) * 24}px`;
        list.replaceChildren(
          before,
          ...entries.slice(start, start + count).map((entry) => row(entry)),
          after,
        );
      };
      list.addEventListener("scroll", renderWindow, { passive: true });
      renderWindow();
    } else for (const entry of entries) list.append(row(entry));
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "codexhost-git-empty";
      empty.textContent = "没有待提交的更改";
      list.append(empty);
    }
    section.append(heading, list);
    root.append(section);
  }
}
