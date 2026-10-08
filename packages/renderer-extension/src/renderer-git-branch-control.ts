import type { GitWorkspaceStatus, HostThreadId } from "@codexhost/shared-contracts";
import type { RendererGitCache } from "./renderer-git-cache.js";
import type { RendererGitClient } from "./renderer-git-sidebar.js";
import { createVisiblePoll } from "./renderer-visible-poll.js";
import { createRendererSettingsIcon } from "./settings/icons.js";
import type { RendererSettingsLocale } from "./settings/localization.js";

interface Context {
  anchor: Element;
  threadId: HostThreadId;
  projectCwd?: string | undefined;
  hostId: string | null;
  client: RendererGitClient;
}

const messages = {
  "zh-CN": { branch: "Git 分支", loading: "正在读取分支…", unavailable: "Git 分支不可用" },
  en: { branch: "Git branch", loading: "Reading branch…", unavailable: "Git branch unavailable" },
};

// 只展示会话主工作区的分支；关联仓库的选择不改变会话的执行目录。
export function installRendererGitBranchControl(options: {
  getContext(): Context | null;
  getLocale(): RendererSettingsLocale;
  cache: RendererGitCache;
}) {
  const root = document.createElement("div");
  root.dataset.codexhostGitBranch = "";
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { display:flex; min-width:0; margin:4px 0; color:var(--text-secondary,inherit); font:11px/1.5 var(--font-sans,system-ui); }
    .branch { display:flex; align-items:center; gap:5px; min-width:0; max-width:100%; opacity:.75; }
    svg { width:13px; height:13px; flex:none; }
    span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  `;
  const row = document.createElement("div");
  row.className = "branch";
  row.setAttribute("role", "status");
  const label = document.createElement("span");
  row.append(createRendererSettingsIcon("git"), label);
  shadow.append(style, row);
  let context: Context | null = null;
  let status: GitWorkspaceStatus | null = null;
  let error: string | null = null;
  let generation = 0;
  let reading = false;
  let disposed = false;

  const render = (): void => {
    const text = messages[options.getLocale() === "zh-CN" ? "zh-CN" : "en"];
    const branch = status?.detached
      ? `HEAD${status.head ? ` · ${status.head.slice(0, 7)}` : ""}`
      : status?.branch;
    const value = branch ?? (error || status ? text.unavailable : text.loading);
    const title = status ? `${status.workspace}\n${text.branch}: ${value}` : (error ?? value);
    if (label.textContent !== value) {
      label.textContent = value;
    }
    if (row.title !== title) {
      row.title = title;
    }
    const description = `${text.branch}: ${value}`;
    if (row.getAttribute("aria-label") !== description) {
      row.setAttribute("aria-label", description);
    }
  };

  const sameContext = (next: Context | null): boolean =>
    context?.threadId === next?.threadId &&
    context?.projectCwd === next?.projectCwd &&
    context?.hostId === next?.hostId &&
    context?.client === next?.client;

  const refreshContext = (): void => {
    const next = disposed ? null : options.getContext();
    const changed = !sameContext(next);
    if (changed) {
      generation++;
      reading = false;
      error = null;
      status = next ? options.cache.peekStatus(next.client, next) : null;
    }
    context = next;
    poll.setActive(Boolean(next));
    if (!next) {
      root.remove();
      return;
    }
    if (root.parentElement !== next.anchor.parentElement) {
      next.anchor.before(root);
    }
    render();
    if (changed) {
      void refresh();
    }
  };

  const refresh = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    refreshContext();
    const request = context;
    const version = generation;
    if (!request || reading || document.hidden) {
      return;
    }
    reading = true;
    const isCurrent = (): boolean =>
      !disposed && generation === version && sameContext(options.getContext());
    try {
      const value = await options.cache.status(request.client, request);
      if (isCurrent()) {
        status = value;
        error = null;
      }
    } catch (cause) {
      if (isCurrent()) {
        status = null;
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (generation === version) {
        reading = false;
      }
      if (isCurrent()) {
        render();
      }
    }
  };

  const poll = createVisiblePoll(document, 30_000, () => void refresh());
  const onFocus = (): void => void refresh();
  window.addEventListener("focus", onFocus);
  refreshContext();
  return {
    refreshContext,
    dispose() {
      disposed = true;
      generation++;
      poll.dispose();
      window.removeEventListener("focus", onFocus);
      root.remove();
    },
  };
}
