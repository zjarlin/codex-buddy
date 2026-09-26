import type {
  GitRepositories,
  GitRepositoriesParams,
  GitRepositoryLinkParams,
} from "@codexhost/shared-contracts";

export interface GitRepositoryClient {
  listGitRepositories(input: GitRepositoriesParams): Promise<GitRepositories>;
  linkGitRepository(input: GitRepositoryLinkParams): Promise<GitRepositories>;
  unlinkGitRepository(input: GitRepositoryLinkParams): Promise<GitRepositories>;
}

interface Context {
  threadId: GitRepositoriesParams["threadId"] | null;
  client: Partial<GitRepositoryClient> | null;
}

// 关联记录由仓库所在的 Host 保存，选择仅影响当前提交面板，不改变聊天项目。
export function createGitRepositorySelector(options: {
  getContext(): Context;
  onSelect(repository: string | undefined): void;
  onNotice(message: string): void;
}) {
  const root = document.createElement("div");
  root.className = "codexhost-git-repositories";
  root.innerHTML = `<style>
    .codexhost-git-repositories { padding:6px 9px; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); font-size:11px; }
    .codexhost-git-repositories[hidden], .codexhost-git-repositories form[hidden] { display:none; }
    .codexhost-git-repositories .repository-row, .codexhost-git-repositories form { display:flex; gap:5px; align-items:center; }
    .codexhost-git-repositories form { margin-top:6px; }
    .codexhost-git-repositories select, .codexhost-git-repositories input { flex:1; min-width:0; width:0; }
    .codexhost-git-repositories button { flex:none; cursor:pointer; }
    .codexhost-git-repositories :is(button,select,input) { color:inherit; background:var(--bg-primary,Canvas); border:1px solid color-mix(in srgb,currentColor 18%,transparent); border-radius:4px; padding:4px 5px; font:inherit; }
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
  input.placeholder = "前端仓库的绝对路径";
  input.title = "输入当前连接所在设备上的 Git 仓库目录";
  input.required = true;
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "关联";
  form.append(input, submit);
  root.append(row, form);
  root.hidden = true;
  let context: Context = { threadId: null, client: null };
  let data: GitRepositories | null = null;
  let selected = "";
  let generation = 0;
  let busy = false;
  let actionBusy = false;
  let disposed = false;

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
    select.disabled = busy || actionBusy || !data;
    add.disabled = busy || actionBusy;
    remove.disabled = busy || actionBusy || !selected;
    submit.disabled = busy || actionBusy;
    submit.setAttribute("aria-busy", String(busy));
    remove.setAttribute("aria-busy", String(busy));
    submit.textContent = busy ? "处理中…" : "关联";
  };

  const syncContext = () => {
    const next = options.getContext();
    if (disposed || (context.threadId === next.threadId && context.client === next.client)) {
      return;
    }
    context = next;
    const version = ++generation;
    selected = "";
    data = null;
    busy = false;
    form.hidden = true;
    input.value = "";
    const { client, threadId } = next;
    const list = client?.listGitRepositories;
    root.hidden = !threadId || !list || !client?.linkGitRepository || !client.unlinkGitRepository;
    if (root.hidden || !threadId || !list) {
      return;
    }
    busy = true;
    render();
    void Promise.resolve()
      .then(() => list.call(client, { threadId }))
      .then((value) => {
        if (generation === version) {
          data = value;
        }
      })
      .catch((error) => {
        if (generation === version) {
          options.onNotice(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (generation !== version) {
          return;
        }
        busy = false;
        render();
      });
  };

  const mutate = async (unlink: boolean) => {
    if (busy || actionBusy) {
      return;
    }
    const request = context;
    const method = unlink ? request.client?.unlinkGitRepository : request.client?.linkGitRepository;
    if (!request.threadId || !method) {
      return;
    }
    const repository = unlink ? selected : input.value.trim();
    if (!repository) {
      return;
    }
    const version = generation;
    const previous = new Set(data?.repositories.map((entry) => entry.path));
    busy = true;
    render();
    try {
      const value = await method.call(request.client, { threadId: request.threadId, repository });
      if (generation !== version) {
        return;
      }
      data = value;
      selected = unlink
        ? ""
        : (value.repositories.find(
            (entry) => !entry.primary && (!previous.has(entry.path) || entry.path === repository),
          )?.path ?? selected);
      form.hidden = true;
      input.value = "";
      options.onSelect(selected || undefined);
      options.onNotice(unlink ? "已解除关联，仓库文件保留。" : "已关联仓库。");
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
  select.addEventListener("change", () => {
    if (select.disabled) {
      return;
    }
    selected = select.value;
    options.onSelect(selected || undefined);
    render();
  });
  add.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      input.focus();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void mutate(false);
  });
  remove.addEventListener("click", () => void mutate(true));
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
      root.remove();
    },
  };
}
