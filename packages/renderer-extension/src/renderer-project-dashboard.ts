import createElement from "lucide/dist/esm/createElement.mjs";
import ChartGantt from "lucide/dist/esm/icons/chart-gantt.mjs";
import RefreshCw from "lucide/dist/esm/icons/refresh-cw.mjs";
import MessageSquare from "lucide/dist/esm/icons/message-square.mjs";
import X from "lucide/dist/esm/icons/x.mjs";
import {
  readProjectDashboard,
  type ProjectDashboardProject,
  type ProjectDashboardSnapshot,
  type ProjectDashboardThread,
  type ProjectDashboardTurnSummary,
  type ProjectDashboardMethod,
} from "./renderer-project-dashboard-state.js";
import { createVisiblePoll } from "./renderer-visible-poll.js";

export const PROJECT_DASHBOARD_ATTRIBUTE = "data-codexhost-project-dashboard";
export const PROJECT_DASHBOARD_TRIGGER_ATTRIBUTE = "data-codexhost-project-dashboard-trigger";
const DASHBOARD_SURFACE_ATTRIBUTE = "data-codexhost-project-dashboard-surface";

const MAIN_SURFACE_SELECTOR = '[data-app-shell-main-surface="default"]';
const APP_HEADER_SELECTOR = 'header[data-pip-obstacle="app-shell-header"]';
const HEADER_ACTION_GROUP_SELECTOR = '[data-app-shell-header-obstacle="true"]';
const SIDEBAR_THREAD_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
const REFRESH_MS = 30_000;

const style = `
  :host{display:block;position:fixed;z-index:50;color:var(--text-primary,inherit);background:var(--surface-primary,#fff);pointer-events:auto;font:12px/1.45 system-ui,sans-serif}
  :host([hidden]){display:none}
  *{box-sizing:border-box}
  button{color:inherit;font:inherit}
  .shell{display:grid;height:100%;min-width:0;min-height:0;grid-template-rows:auto auto 1fr}
  .top{display:flex;min-width:0;align-items:center;gap:12px;padding:14px 18px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
  .title{display:flex;min-width:0;align-items:center;gap:9px}
  .title svg{flex:none;opacity:.72}
  h2{margin:0;font-size:15px;line-height:1.3;font-weight:650;letter-spacing:0}
  .subtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary,currentColor);font-size:11px;opacity:.62}
  .grow{min-width:0;flex:1}
  .actions{display:flex;flex:none;align-items:center;gap:6px}
  .icon-button,.refresh{display:inline-flex;min-height:30px;align-items:center;justify-content:center;gap:6px;padding:0 9px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:7px;background:transparent;cursor:pointer}
  .icon-button{width:30px;padding:0}
  .chat{color:inherit;background:color-mix(in srgb,currentColor 5%,transparent)}
  .icon-button:hover,.refresh:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
  .icon-button:focus-visible,.refresh:focus-visible,.task:focus-visible{outline:2px solid #4c8df6;outline-offset:1px}
  .refresh[aria-busy="true"] svg{animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .summary{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:1px;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent);background:color-mix(in srgb,currentColor 8%,transparent)}
  .metric{display:flex;min-width:0;align-items:baseline;gap:7px;padding:10px 18px;background:var(--surface-primary,#fff)}
  .metric strong{font-size:18px;line-height:1;font-variant-numeric:tabular-nums}
  .metric span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary,currentColor);font-size:10px;opacity:.66}
  .body{min-width:0;min-height:0;overflow:auto;padding:14px 18px 28px}
  .board{display:grid;min-width:860px;gap:12px}
  .project{overflow:hidden;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:8px;background:var(--surface-secondary,color-mix(in srgb,currentColor 2%,transparent))}
  .project-head{display:flex;min-width:0;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 9%,transparent)}
  .project-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
  .project-path{min-width:0;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary,currentColor);font-size:10px;opacity:.54}
  .project-meta{display:flex;flex:none;align-items:center;gap:6px;margin-left:auto;color:var(--text-secondary,currentColor);font-size:10px;opacity:.68}
  .pill{padding:2px 7px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:999px;background:color-mix(in srgb,currentColor 5%,transparent);white-space:nowrap}
  .rows{padding:4px 0}
  .thread{display:grid;min-width:0;grid-template-columns:minmax(210px,260px) 1fr;gap:12px;padding:8px 12px;border-top:1px solid color-mix(in srgb,currentColor 7%,transparent)}
  .thread:first-child{border-top:0}
  .thread-name{display:flex;min-width:0;align-items:flex-start;gap:7px;padding-top:7px}
  .dot{width:7px;height:7px;flex:none;margin-top:5px;border-radius:50%;background:color-mix(in srgb,currentColor 24%,transparent)}
  .thread[data-active="true"] .dot{background:#3b82f6;box-shadow:0 0 0 3px color-mix(in srgb,#3b82f6 16%,transparent)}
  .thread-copy{min-width:0}
  .thread-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600}
  .thread-copy small{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary,currentColor);font-size:9px;opacity:.55}
  .turns{display:grid;min-width:0;gap:5px}
  .task{display:grid;min-width:0;grid-template-columns:minmax(40px,1fr) auto;align-items:center;gap:8px;padding:7px 8px;border:1px solid color-mix(in srgb,currentColor 9%,transparent);border-radius:6px;background:color-mix(in srgb,currentColor 2%,transparent);text-align:left;cursor:pointer}
  .task:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
  .task-main{min-width:0}
  .task-line{display:flex;min-width:0;align-items:center;gap:6px}
  .task-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:550}
  .task-summary{margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary,currentColor);font-size:10px;opacity:.68}
  .task-data{display:flex;flex:none;align-items:center;gap:5px;color:var(--text-secondary,currentColor);font-size:9px;opacity:.72;font-variant-numeric:tabular-nums}
  .status{width:7px;height:7px;flex:none;border-radius:50%;background:#20a67a}
  .status[data-status="running"]{background:#3b82f6;animation:pulse 1.6s ease-in-out infinite}
  .status[data-status="failed"]{background:#e05252}.status[data-status="interrupted"]{background:#d59a2b}
  @keyframes pulse{50%{opacity:.38}}
  .empty,.error{display:flex;min-height:180px;align-items:center;justify-content:center;padding:24px;color:var(--text-secondary,currentColor);text-align:center;opacity:.72}
  .error{margin-top:10px;border:1px solid color-mix(in srgb,#e05252 30%,transparent);border-radius:7px;color:#d14d4d}
  [hidden]{display:none!important}
  @media (max-width:900px){.thread{grid-template-columns:1fr}.thread-name{padding-top:0}.summary{grid-template-columns:repeat(2,minmax(110px,1fr))}}
`;

function iconButton(document: Document, label: string, icon: Parameters<typeof createElement>[0]) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createElement(icon, { width: 15, height: 15, "aria-hidden": "true" }));
  return button;
}

function formatTime(value: number | null): string {
  if (value === null) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatDuration(value: number | null): string {
  if (value === null || value < 0) return "";
  if (value < 60_000) return `${Math.max(1, Math.round(value / 1000))} 秒`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} 分钟`;
  return `${(value / 3_600_000).toFixed(1)} 小时`;
}

function turnLabel(turn: ProjectDashboardTurnSummary): string {
  if (turn.status === "running") return "进行中";
  if (turn.status === "failed") return "失败";
  if (turn.status === "interrupted") return "已中断";
  return "已完成";
}

function threadLatest(thread: ProjectDashboardThread): number {
  return Math.max(thread.updatedAt ?? 0, ...thread.turns.map((turn) => turn.completedAt ?? 0));
}

function renderTurn(
  document: Document,
  turn: ProjectDashboardTurnSummary,
  open: () => void,
): HTMLButtonElement {
  const task = document.createElement("button");
  task.type = "button";
  task.className = "task";
  task.dataset.status = turn.status;
  task.title = [turn.prompt, turn.summary].filter(Boolean).join("\n");
  const main = document.createElement("span");
  main.className = "task-main";
  const line = document.createElement("span");
  line.className = "task-line";
  const status = document.createElement("span");
  status.className = "status";
  status.dataset.status = turn.status;
  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = turn.prompt || turnLabel(turn);
  line.append(status, title);
  const summary = document.createElement("span");
  summary.className = "task-summary";
  summary.textContent =
    turn.summary || (turn.status === "running" ? "正在执行，完成后显示结果" : "没有可显示的总结");
  main.append(line, summary);
  const data = document.createElement("span");
  data.className = "task-data";
  const parts = [turnLabel(turn), formatDuration(turn.durationMs)];
  if (turn.changedFiles > 0) {
    parts.push(`${turn.changedFiles} 文件`);
    parts.push(`+${turn.additions} -${turn.deletions}`);
  } else if (turn.status === "completed") {
    parts.push("无文件变更");
  }
  data.textContent = parts.filter(Boolean).join(" · ");
  task.append(main, data);
  task.addEventListener("click", open);
  return task;
}

function renderThread(
  document: Document,
  thread: ProjectDashboardThread,
  open: (threadId: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "thread";
  row.dataset.active = String(thread.active);
  const name = document.createElement("div");
  name.className = "thread-name";
  const dot = document.createElement("span");
  dot.className = "dot";
  const copy = document.createElement("span");
  copy.className = "thread-copy";
  const title = document.createElement("strong");
  title.textContent = thread.title;
  title.title = thread.title;
  const meta = document.createElement("small");
  meta.textContent = `${thread.active ? "运行中" : "空闲"} · 更新 ${formatTime(threadLatest(thread) || null)}`;
  copy.append(title, meta);
  name.append(dot, copy);
  const turns = document.createElement("div");
  turns.className = "turns";
  if (thread.turns.length === 0) {
    const empty = document.createElement("div");
    empty.className = "task-summary";
    empty.textContent = thread.error ? `结果读取失败：${thread.error}` : "还没有结果回合";
    turns.append(empty);
  } else {
    for (const turn of thread.turns) {
      turns.append(renderTurn(document, turn, () => open(thread.id)));
    }
  }
  row.append(name, turns);
  return row;
}

function renderProject(
  document: Document,
  project: ProjectDashboardProject,
  open: (threadId: string) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "project";
  const head = document.createElement("header");
  head.className = "project-head";
  const name = document.createElement("strong");
  name.className = "project-name";
  name.textContent = project.label;
  const path = document.createElement("span");
  path.className = "project-path";
  path.textContent = project.cwd ?? "";
  path.title = project.cwd ?? "";
  const meta = document.createElement("span");
  meta.className = "project-meta";
  const active = document.createElement("span");
  active.className = "pill";
  active.textContent = `${project.activeCount} 运行中`;
  const completed = document.createElement("span");
  completed.className = "pill";
  completed.textContent = `${project.completedCount} 个最新结果`;
  const changes = document.createElement("span");
  changes.textContent = project.changedFiles
    ? `${project.changedFiles} 文件 · +${project.additions} -${project.deletions}`
    : "无文件变更";
  meta.append(active, completed, changes);
  head.append(name, path, meta);
  const rows = document.createElement("div");
  rows.className = "rows";
  for (const thread of project.threads) rows.append(renderThread(document, thread, open));
  section.append(head, rows);
  return section;
}

function mountDashboard(
  host: HTMLElement,
  options: { onOpenThread(threadId: string): void; onRefresh(): void; onChat(): void },
): {
  root: HTMLElement;
  update(snapshot: ProjectDashboardSnapshot | null, error: unknown | string): void;
  setBusy(busy: boolean): void;
  dispose(): void;
} {
  const shadow = host.attachShadow({ mode: "open" });
  const styles = document.createElement("style");
  styles.textContent = style;
  const shell = document.createElement("div");
  shell.className = "shell";
  const top = document.createElement("header");
  top.className = "top";
  const title = document.createElement("div");
  title.className = "title";
  title.append(createElement(ChartGantt, { width: 18, height: 18, "aria-hidden": "true" }));
  const heading = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = "项目态势";
  const subtitle = document.createElement("div");
  subtitle.className = "subtitle";
  subtitle.textContent = "只看项目结果、完成回合和文件变更";
  heading.append(h2, subtitle);
  title.append(heading);
  const grow = document.createElement("div");
  grow.className = "grow";
  const actions = document.createElement("div");
  actions.className = "actions";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh";
  refresh.append(createElement(RefreshCw, { width: 14, height: 14, "aria-hidden": "true" }));
  const refreshLabel = document.createElement("span");
  refreshLabel.textContent = "刷新";
  refresh.append(refreshLabel);
  const chat = document.createElement("button");
  chat.type = "button";
  chat.className = "refresh chat";
  chat.append(createElement(MessageSquare, { width: 14, height: 14, "aria-hidden": "true" }));
  const chatLabel = document.createElement("span");
  chatLabel.textContent = "切换到聊天";
  chat.append(chatLabel);
  const close = iconButton(document, "关闭项目态势", X);
  actions.append(chat, refresh, close);
  top.append(title, grow, actions);

  const summary = document.createElement("section");
  summary.className = "summary";
  const body = document.createElement("main");
  body.className = "body";
  const board = document.createElement("div");
  board.className = "board";
  body.append(board);
  shell.append(top, summary, body);
  shadow.append(styles, shell);

  let snapshot: ProjectDashboardSnapshot | null = null;
  let failure: unknown | string = null;
  let renderedKey = "";
  let disposed = false;
  const render = (): void => {
    const key = JSON.stringify([snapshot, String(failure)]);
    if (key === renderedKey) return;
    renderedKey = key;
    summary.replaceChildren();
    board.replaceChildren();
    if (failure) {
      const pending = typeof failure === "string";
      const error = document.createElement("div");
      error.className = pending ? "empty" : "error";
      error.textContent = pending
        ? String(failure)
        : `项目态势读取失败：${failure instanceof Error ? failure.message : String(failure)}`;
      board.append(error);
    }
    if (snapshot) {
      const totals = snapshot.projects.reduce(
        (value, project) => ({
          active: value.active + project.activeCount,
          completed: value.completed + project.completedCount,
          files: value.files + project.changedFiles,
          projects: value.projects + 1,
        }),
        { active: 0, completed: 0, files: 0, projects: 0 },
      );
      const metrics: Array<[string, string]> = [
        [String(totals.projects), "项目"],
        [String(totals.active), "运行中的会话"],
        [String(totals.completed), "最新完成结果"],
        [String(totals.files), "涉及文件"],
      ];
      for (const [value, label] of metrics) {
        const metric = document.createElement("div");
        metric.className = "metric";
        const strong = document.createElement("strong");
        strong.textContent = value;
        const text = document.createElement("span");
        text.textContent = label;
        metric.append(strong, text);
        summary.append(metric);
      }
      subtitle.textContent = `更新于 ${formatTime(snapshot.refreshedAt)} · 只汇总结果与文件变更`;
      if (snapshot.projects.length === 0 && !failure) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "没有可展示的项目会话";
        board.append(empty);
      } else {
        for (const project of snapshot.projects) {
          board.append(renderProject(document, project, options.onOpenThread));
        }
      }
      if (snapshot.errors.length) {
        const error = document.createElement("div");
        error.className = "error";
        error.textContent = `部分结果读取失败：${snapshot.errors.join("；")}`;
        board.append(error);
      }
    }
  };
  const onChat = (): void => options.onChat();
  const onClose = (): void => options.onChat();
  chat.addEventListener("click", onChat);
  refresh.addEventListener("click", options.onRefresh);
  close.addEventListener("click", onClose);
  render();
  return {
    root: host,
    update(next, error) {
      if (disposed) return;
      snapshot = next;
      failure = error;
      render();
    },
    setBusy(busy) {
      if (disposed) return;
      refresh.disabled = busy;
      refresh.setAttribute("aria-busy", String(busy));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      chat.removeEventListener("click", onChat);
      refresh.removeEventListener("click", options.onRefresh);
      close.removeEventListener("click", onClose);
      host.remove();
    },
  };
}

export function installRendererProjectDashboard(options: {
  getRequest(
    hostId: string,
  ): ((method: ProjectDashboardMethod, params: unknown) => Promise<unknown>) | null;
  getHostIds(): string[];
  onOpenThread(threadId: string, hostId: string): void;
}): { refresh(): void; dispose(): void } {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.setAttribute(PROJECT_DASHBOARD_TRIGGER_ATTRIBUTE, "v1");
  trigger.setAttribute("aria-label", "打开项目态势");
  trigger.title = "项目态势";
  trigger.style.cssText =
    "display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;opacity:.72";
  trigger.append(createElement(ChartGantt, { width: 17, height: 17, "aria-hidden": "true" }));
  const host = document.createElement("div");
  host.setAttribute(PROJECT_DASHBOARD_ATTRIBUTE, "v1");
  host.hidden = true;
  let dashboard: ReturnType<typeof mountDashboard> | null = null;
  let surface: HTMLElement | null = null;
  let disposed = false;
  let requestGeneration = 0;
  let open = false;
  let loading = false;
  let snapshot: ProjectDashboardSnapshot | null = null;
  let failure: unknown = null;
  let automatic = true;
  let resizeObserver: ResizeObserver | null = null;

  const dashboardSurface = (): HTMLElement =>
    document.querySelector<HTMLElement>(MAIN_SURFACE_SELECTOR) ??
    document.body ??
    document.documentElement;

  const syncSurfaceBounds = (): void => {
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const hasBounds = bounds.width > 0 && bounds.height > 0;
    const headerBottom = document
      .querySelector<HTMLElement>(APP_HEADER_SELECTOR)
      ?.getBoundingClientRect().bottom;
    const left = hasBounds ? Math.max(0, bounds.left) : 0;
    const top = hasBounds
      ? Math.max(0, bounds.top)
      : Math.max(0, Math.min(headerBottom ?? 0, viewportHeight));
    const width = hasBounds
      ? Math.max(0, Math.min(bounds.width, viewportWidth - left))
      : viewportWidth;
    const height = hasBounds
      ? Math.max(0, Math.min(bounds.height, viewportHeight - top))
      : Math.max(0, viewportHeight - top);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  };

  const observeSurface = (next: HTMLElement): void => {
    if (typeof ResizeObserver === "undefined") return;
    resizeObserver ??= new ResizeObserver(() => syncSurfaceBounds());
    resizeObserver.disconnect();
    resizeObserver.observe(next);
  };

  const switchToChat = (): void => {
    automatic = false;
    if (!open) return;
    open = false;
    host.hidden = true;
    dashboard?.update(null, null);
  };
  const refresh = (): void => {
    if (!open || disposed) return;
    const generation = ++requestGeneration;
    loading = true;
    dashboard?.setBusy(true);
    const hostIds = [...new Set(options.getHostIds())].filter(Boolean);
    void Promise.all(
      hostIds.map(async (hostId) => {
        const request = options.getRequest(hostId);
        if (!request) return { hostId, snapshot: null, error: null, pending: true };
        try {
          return {
            hostId,
            snapshot: await readProjectDashboard(request),
            error: null,
            pending: false,
          };
        } catch (error) {
          return { hostId, snapshot: null, error, pending: false };
        }
      }),
    )
      .then((results) => {
        if (disposed || generation !== requestGeneration) return;
        loading = false;
        dashboard?.setBusy(false);
        const projects = results.flatMap(({ snapshot: next, hostId }) =>
          (next?.projects ?? []).map((project) => ({
            ...project,
            hostId,
            key: `${hostId}:${project.key}`,
          })),
        );
        const errors = results.flatMap(({ error }) => (error ? [String(error)] : []));
        const pending = results.some(({ pending: value }) => value);
        snapshot = {
          projects,
          threads: results.flatMap(({ snapshot: next }) => next?.threads ?? []),
          errors: [...results.flatMap(({ snapshot: next }) => next?.errors ?? []), ...errors],
          refreshedAt: Date.now(),
        };
        failure = null;
        dashboard?.update(snapshot, pending ? "正在连接 Host…" : null);
      })
      .catch((error) => {
        if (disposed || generation !== requestGeneration) return;
        loading = false;
        dashboard?.setBusy(false);
        failure = error;
        dashboard?.update(snapshot, failure);
      });
  };
  const show = (): void => {
    if (disposed) return;
    const nextSurface = dashboardSurface();
    if (surface && surface !== nextSurface) surface.removeAttribute(DASHBOARD_SURFACE_ATTRIBUTE);
    surface = nextSurface;
    surface.setAttribute(DASHBOARD_SURFACE_ATTRIBUTE, "v1");
    if (!dashboard) {
      dashboard = mountDashboard(host, {
        onOpenThread(threadId) {
          const project = snapshot?.projects.find((candidate) =>
            candidate.threads.some((thread) => thread.id === threadId),
          );
          options.onOpenThread(threadId, project?.hostId ?? "local");
          switchToChat();
        },
        onRefresh() {
          refresh();
        },
        onChat() {
          if (loading) {
            requestGeneration += 1;
            loading = false;
            dashboard?.setBusy(false);
          }
          switchToChat();
        },
      });
    }
    if (host.parentElement !== surface) surface.append(host);
    host.hidden = false;
    syncSurfaceBounds();
    observeSurface(surface);
    open = true;
    dashboard?.update(snapshot, failure);
    refresh();
    poll.setActive(true);
  };

  const onclick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    automatic = true;
    show();
  };
  const position = (): void => {
    const header = document.querySelector<HTMLElement>(APP_HEADER_SELECTOR);
    const group = header?.querySelector<HTMLElement>(HEADER_ACTION_GROUP_SELECTOR);
    if (!group || group === trigger.parentElement) return;
    group.prepend(trigger);
  };
  const onSidebarThreadClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (open && target?.closest(SIDEBAR_THREAD_ROW_SELECTOR)) switchToChat();
  };
  trigger.addEventListener("click", onclick);
  document.addEventListener("click", onSidebarThreadClick, true);
  position();
  const poll = createVisiblePoll(document, REFRESH_MS, () => refresh());
  poll.setActive(false);
  const observer = new MutationObserver(() => {
    position();
    const nextSurface = dashboardSurface();
    if (open && surface && !surface.isConnected) {
      open = false;
      if (automatic) show();
    } else if (open && surface !== nextSurface) {
      show();
    } else if (open) {
      syncSurfaceBounds();
    } else if (automatic) {
      show();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (automatic) show();
  return {
    refresh() {
      position();
      poll.setActive(open);
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      requestGeneration += 1;
      observer.disconnect();
      poll.dispose();
      trigger.removeEventListener("click", onclick);
      document.removeEventListener("click", onSidebarThreadClick, true);
      resizeObserver?.disconnect();
      resizeObserver = null;
      trigger.remove();
      surface?.removeAttribute(DASHBOARD_SURFACE_ATTRIBUTE);
      dashboard?.dispose();
      dashboard = null;
      host.remove();
    },
  };
}
