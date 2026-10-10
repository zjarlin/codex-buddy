import type {
  GitRepositories,
  GitRepositoriesParams,
  GitRepositoryDirectories,
  GitRepositoryDirectoriesParams,
  GitRepositoryLinkParams,
} from "@codexhost/shared-contracts";

import {
  gitTargetKey,
  gitTargetParams,
  hasGitTarget,
  type RendererGitTarget,
} from "./renderer-git-target.js";

export interface GitRepositoryClient {
  listGitRepositories(input: GitRepositoriesParams): Promise<GitRepositories>;
  listGitRepositoryDirectories?(
    input: GitRepositoryDirectoriesParams,
  ): Promise<GitRepositoryDirectories>;
  linkGitRepository(input: GitRepositoryLinkParams): Promise<GitRepositories>;
  unlinkGitRepository(input: GitRepositoryLinkParams): Promise<GitRepositories>;
}

interface Context extends RendererGitTarget {
  client: Partial<GitRepositoryClient> | null;
}

// 关联记录由仓库所在的 Host 保存，目录浏览同样必须由该 Host 执行。
export function createGitRepositorySelector(options: {
  getContext(): Context;
  onSelect(repository: string | undefined): void;
  onNotice(message: string): void;
  onRepositories?(repositories: GitRepositories): void;
}) {
  const root = document.createElement("div");
  root.className = "codexhost-git-repositories";
  root.innerHTML = `<style>
    .codexhost-git-repositories { padding:6px 9px 8px; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); font-size:11px; }
    .codexhost-git-repositories[hidden], .codexhost-git-repositories form[hidden], .codexhost-git-repositories .picker[hidden] { display:none; }
    .codexhost-git-repositories .repository-row, .codexhost-git-repositories form, .codexhost-git-repositories .picker-head, .codexhost-git-repositories .picker-path, .codexhost-git-repositories .picker-list { display:flex; gap:5px; align-items:center; }
    .codexhost-git-repositories form { margin-top:6px; }
    .codexhost-git-repositories .picker { display:grid; gap:6px; margin-top:7px; padding-top:7px; border-top:1px solid color-mix(in srgb,currentColor 10%,transparent); }
    .codexhost-git-repositories .picker-path { min-width:0; }
    .codexhost-git-repositories .picker-list { align-items:stretch; flex-direction:column; max-height:230px; overflow:auto; border:1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius:4px; }
    .codexhost-git-repositories .picker-entry { display:grid; grid-template-columns:16px minmax(0,1fr); align-items:center; gap:5px; width:100%; min-height:27px; padding:3px 6px; color:inherit; text-align:left; background:transparent; border:0; border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent); border-radius:0; }
    .codexhost-git-repositories .picker-entry:last-child { border-bottom:0; }
    .codexhost-git-repositories .picker-entry:hover:not(:disabled) { background:color-mix(in srgb,currentColor 8%,transparent); }
    .codexhost-git-repositories .picker-entry-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .codexhost-git-repositories .picker-icon { width:14px; height:14px; color:inherit; opacity:.75; }
    .codexhost-git-repositories select, .codexhost-git-repositories input { flex:1; min-width:0; width:0; }
    .codexhost-git-repositories button { flex:none; cursor:pointer; }
    .codexhost-git-repositories :is(button,select,input) { color:inherit; background:var(--bg-primary,Canvas); border:1px solid color-mix(in srgb,currentColor 18%,transparent); border-radius:4px; padding:4px 5px; font:inherit; }
    .codexhost-git-repositories .picker-entry { background:transparent; border:0; border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent); border-radius:0; }
    .codexhost-git-repositories :disabled { opacity:.5; cursor:default; }
  </style>`;
  const row = document.createElement("div");
  row.className = "repository-row";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "操作仓库");
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "关联仓库";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "解除";
  remove.setAttribute("aria-label", "解除仓库关联");
  remove.title = "仅移除关联，保留仓库文件";
  row.append(select, add, remove);

  const form = document.createElement("form");
  form.hidden = true;
  const input = document.createElement("input");
  input.setAttribute("aria-label", "Git 仓库绝对路径");
  input.placeholder = "目录绝对路径";
  input.title = "输入当前连接所在设备上的目录";
  input.required = true;
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "关联";
  form.append(input, submit);

  const picker = document.createElement("div");
  picker.className = "picker";
  picker.hidden = true;
  const pickerHead = document.createElement("div");
  pickerHead.className = "picker-head";
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "上一级";
  up.setAttribute("aria-label", "上一级目录");
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "刷新";
  refresh.setAttribute("aria-label", "刷新目录");
  const linkCurrent = document.createElement("button");
  linkCurrent.type = "button";
  linkCurrent.textContent = "关联当前目录";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "关闭";
  close.setAttribute("aria-label", "关闭目录选择");
  pickerHead.append(up, refresh, linkCurrent, close);
  const pickerPath = document.createElement("div");
  pickerPath.className = "picker-path";
  const pathInput = document.createElement("input");
  pathInput.setAttribute("aria-label", "目录路径");
  pathInput.placeholder = "输入目录绝对路径";
  pathInput.required = true;
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "前往";
  pickerPath.append(pathInput, go);
  const pickerList = document.createElement("div");
  pickerList.className = "picker-list";
  pickerList.setAttribute("role", "listbox");
  pickerList.setAttribute("aria-label", "目录列表");
  picker.append(pickerHead, pickerPath, pickerList);

  root.append(row, form, picker);
  root.hidden = true;
  let context: Context = { threadId: null, client: null };
  let data: GitRepositories | null = null;
  let directories: GitRepositoryDirectories | null = null;
  let selected = "";
  let generation = 0;
  let pickerGeneration = 0;
  let busy = false;
  let actionBusy = false;
  let pickerBusy = false;
  let disposed = false;

  const folderIcon = (): SVGSVGElement => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "picker-icon");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", "M3 6.5h6l1.5 2H21v9.5H3z");
    svg.append(shape);
    return svg;
  };

  const render = () => {
    select.replaceChildren(
      ...(data?.repositories ?? []).map((entry) => {
        const option = document.createElement("option");
        option.value = entry.primary ? "" : entry.path;
        const name = entry.path.split(/[/\\]/u).filter(Boolean).at(-1) ?? entry.path;
        option.textContent = `${name}${entry.primary ? "（会话项目）" : ""} — ${entry.path}`;
        return option;
      }),
    );
    select.value = selected;
    select.title = selected || data?.project || "";
    select.disabled = busy || actionBusy || pickerBusy || !data;
    add.disabled = busy || actionBusy || pickerBusy;
    remove.disabled = busy || actionBusy || pickerBusy || !selected;
    submit.disabled = busy || actionBusy || pickerBusy;
    submit.setAttribute("aria-busy", String(busy));
    remove.setAttribute("aria-busy", String(busy));
    submit.textContent = busy ? "处理中…" : "关联";
    pathInput.disabled = busy || pickerBusy || actionBusy;
    pickerList.replaceChildren();
    pickerList.hidden = false;
    if (directories) {
      for (const entry of directories.entries) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "picker-entry";
        item.setAttribute("role", "option");
        item.title = entry.path;
        item.disabled = busy || pickerBusy || actionBusy;
        const name = document.createElement("span");
        name.className = "picker-entry-name";
        name.textContent = entry.name;
        item.append(folderIcon(), name);
        item.addEventListener("click", () => void loadDirectories(entry.path));
        pickerList.append(item);
      }
      if (directories.truncated) {
        const truncated = document.createElement("div");
        truncated.className = "picker-entry";
        truncated.textContent = "目录过多，仅显示前 5000 项。";
        pickerList.append(truncated);
      }
    } else if (pickerBusy) {
      const loading = document.createElement("div");
      loading.className = "picker-entry";
      loading.textContent = "正在读取目录…";
      pickerList.append(loading);
    }
    up.disabled = busy || pickerBusy || actionBusy || !directories?.parent;
    refresh.disabled = busy || pickerBusy || actionBusy || !directories;
    go.disabled = busy || pickerBusy || actionBusy || !pathInput.value.trim();
    linkCurrent.disabled = busy || pickerBusy || actionBusy || !directories;
  };

  const resetPicker = () => {
    pickerGeneration += 1;
    directories = null;
    pickerBusy = false;
    picker.hidden = true;
  };

  const syncContext = () => {
    const next = options.getContext();
    if (
      disposed ||
      (gitTargetKey(context) === gitTargetKey(next) && context.client === next.client)
    ) {
      return;
    }
    context = next;
    const version = ++generation;
    selected = "";
    data = null;
    busy = false;
    form.hidden = true;
    input.value = "";
    resetPicker();
    const { client } = next;
    const list = client?.listGitRepositories;
    root.hidden =
      !hasGitTarget(next) || !list || !client?.linkGitRepository || !client.unlinkGitRepository;
    if (root.hidden || !hasGitTarget(next) || !list) {
      return;
    }
    busy = true;
    render();
    void Promise.resolve()
      .then(() => list.call(client, gitTargetParams(next)))
      .then((value) => {
        if (generation === version) {
          data = value;
          options.onRepositories?.(value);
        }
      })
      .catch((error) => {
        if (generation === version) {
          options.onNotice(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (generation !== version) return;
        busy = false;
        render();
      });
  };

  const mutate = async (repository: string, version = generation) => {
    if (busy || actionBusy || pickerBusy) return;
    const request = context;
    const method = request.client?.linkGitRepository;
    if (!hasGitTarget(request) || !method || !repository) return;
    const previous = new Set(data?.repositories.map((entry) => entry.path));
    busy = true;
    render();
    try {
      const value = await method.call(request.client, { ...gitTargetParams(request), repository });
      if (generation !== version) return;
      data = value;
      options.onRepositories?.(value);
      selected =
        value.repositories.find(
          (entry) => !entry.primary && (!previous.has(entry.path) || entry.path === repository),
        )?.path ?? selected;
      form.hidden = true;
      input.value = "";
      resetPicker();
      options.onSelect(selected || undefined);
      options.onNotice("已关联仓库。");
    } catch (error) {
      if (generation === version) {
        options.onNotice(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === version) {
        busy = false;
        render();
      }
    }
  };

  const unlink = async () => {
    if (busy || actionBusy || pickerBusy || !selected) return;
    const request = context;
    const method = request.client?.unlinkGitRepository;
    if (!hasGitTarget(request) || !method) return;
    const version = generation;
    busy = true;
    render();
    try {
      const value = await method.call(request.client, {
        ...gitTargetParams(request),
        repository: selected,
      });
      if (generation !== version) return;
      data = value;
      options.onRepositories?.(value);
      selected = "";
      options.onSelect(undefined);
      options.onNotice("已解除关联，仓库文件保留。");
    } catch (error) {
      if (generation === version) {
        options.onNotice(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === version) {
        busy = false;
        render();
      }
    }
  };

  const loadDirectories = async (pathValue?: string) => {
    if (busy || actionBusy || pickerBusy) return;
    const request = context;
    const method = request.client?.listGitRepositoryDirectories;
    if (!hasGitTarget(request) || !method) {
      options.onNotice("此 Host 尚未提供目录浏览。");
      return;
    }
    const version = generation;
    const requestVersion = ++pickerGeneration;
    pickerBusy = true;
    picker.hidden = false;
    render();
    try {
      const value = await method.call(request.client, {
        ...gitTargetParams(request),
        ...(pathValue?.trim() ? { path: pathValue.trim() } : {}),
      });
      if (generation !== version || pickerGeneration !== requestVersion) return;
      directories = value;
      input.value = value.path;
      pathInput.value = value.path;
      options.onNotice("");
    } catch (error) {
      if (generation === version && pickerGeneration === requestVersion) {
        options.onNotice(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === version && pickerGeneration === requestVersion) {
        pickerBusy = false;
        render();
      }
    }
  };

  select.addEventListener("change", () => {
    if (select.disabled) return;
    selected = select.value;
    options.onSelect(selected || undefined);
    render();
  });
  add.addEventListener("click", () => {
    if (picker.hidden) {
      form.hidden = true;
      picker.hidden = false;
      void loadDirectories(directories?.path ?? (input.value.trim() || undefined));
    } else {
      resetPicker();
      render();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void mutate(input.value.trim());
  });
  remove.addEventListener("click", () => void unlink());
  up.addEventListener("click", () => {
    if (directories?.parent) void loadDirectories(directories.parent);
  });
  refresh.addEventListener("click", () => void loadDirectories(directories?.path));
  go.addEventListener("click", () => void loadDirectories(pathInput.value));
  pathInput.addEventListener("input", render);
  pathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadDirectories(pathInput.value);
    }
  });
  linkCurrent.addEventListener("click", () => {
    if (directories) void mutate(directories.path);
  });
  close.addEventListener("click", () => {
    resetPicker();
    render();
  });
  return {
    root,
    syncContext,
    setBusy(value: boolean) {
      if (actionBusy !== value) {
        actionBusy = value;
        render();
      }
    },
    dispose() {
      disposed = true;
      generation++;
      pickerGeneration++;
      root.remove();
    },
  };
}
