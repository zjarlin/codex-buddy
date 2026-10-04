import createElement from "lucide/dist/esm/createElement.mjs";
import Archive from "lucide/dist/esm/icons/archive.mjs";
import Check from "lucide/dist/esm/icons/check.mjs";
import Eye from "lucide/dist/esm/icons/eye.mjs";
import X from "lucide/dist/esm/icons/x.mjs";

import { hostThreadIdSchema, type HostThreadId } from "@codexhost/shared-contracts";

import {
  PendingConfirmationsModel,
  type PendingConfirmationRecord,
} from "./pending-confirmations-state.js";
import type { RendererModelClient } from "./renderer-model-client.js";
import { openRendererThread } from "./renderer-fork-control.js";
import {
  SIDEBAR_THREAD_HOST_ID_ATTRIBUTE,
  SIDEBAR_THREAD_ROW_SELECTOR,
  threadIdFromSidebarRowElement,
} from "./renderer-sidebar-agent-icons.js";
import { appendMarkdownBlocks } from "./markdown-renderer.js";

type Locale = "zh-CN" | "en";
type NotificationManager = {
  addNotificationCallback(
    methods: string | readonly string[],
    listener: (notification: unknown) => void,
  ): () => void;
};

interface PendingConfirmationDomOptions {
  getClient(hostId: string): RendererModelClient | null;
  getManager(hostId: string): Partial<NotificationManager> | null;
  getHostIds(): string[];
  activeThread(): { hostId: string; threadId: string } | null;
  getLocale(): Locale;
  model?: PendingConfirmationsModel;
  openThread?(threadId: HostThreadId, options: { hostId: string }): Promise<void>;
  subscribeHosts?(listener: () => void): () => void;
}

interface HostSubscription {
  manager: NotificationManager | null;
  dispose: (() => void) | null;
  reconciledManager: NotificationManager | null;
}

const ACTIVE = "data-app-action-sidebar-thread-active";
const MODAL = "data-codexhost-pending-confirmations";
const PANEL = "data-codexhost-pending-confirmations-panel";
const QUEUE = "data-codexhost-pending-confirmations-queue";
const READ_DWELL_MS = 3_000;
const RECONCILE_LIMIT = 80;
const RECONCILE_CONCURRENCY = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nativeThreadId(hostId: string, value: string): string {
  const prefix = `${hostId}:`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function messages(locale: Locale) {
  return locale === "zh-CN"
    ? {
        title: "会话已完成",
        result: "最后一轮结果",
        more: (count: number) => `还有 ${count} 个待确认会话`,
        view: "查看结果",
        read: "标为已读",
        archive: "归档",
        close: "关闭",
        archiveFailed: "归档失败，已保留待确认状态。",
        openFailed: "无法打开该会话，请从侧栏重试。",
        unnamed: "未命名会话",
        completed: "已完成",
        failed: "执行失败",
        interrupted: "已中断",
      }
    : {
        title: "Conversation finished",
        result: "Latest result",
        more: (count: number) => `${count} more conversations await confirmation`,
        view: "View result",
        read: "Mark read",
        archive: "Archive",
        close: "Close",
        archiveFailed: "Archive failed. The confirmation was kept.",
        openFailed: "Could not open the conversation. Retry from the sidebar.",
        unnamed: "Untitled conversation",
        completed: "Completed",
        failed: "Failed",
        interrupted: "Interrupted",
      };
}

function statusLabel(locale: Locale, status: PendingConfirmationRecord["status"]): string {
  const value = messages(locale);
  return status === "completed"
    ? value.completed
    : status === "failed"
      ? value.failed
      : value.interrupted;
}

function isRateLimited(entry: PendingConfirmationRecord): boolean {
  if (entry.status !== "failed") return false;
  const text = `${entry.summary} ${entry.title}`.toLowerCase();
  return /429|rate[s-]*limit|quota|throttl|too many requests/i.test(text);
}

function statusTone(
  status: PendingConfirmationRecord["status"],
  rateLimited: boolean,
): "success" | "warning" | "error" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return rateLimited ? "warning" : "error";
  return "neutral";
}

function formatTime(value: number, locale: Locale): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function entryKey(
  entry: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">,
): string {
  return `${entry.hostId}\u0000${entry.threadId}\u0000${entry.turnId}`;
}

function sameEntry(
  left: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">,
  right: Pick<PendingConfirmationRecord, "hostId" | "threadId" | "turnId">,
): boolean {
  return (
    left.hostId === right.hostId && left.threadId === right.threadId && left.turnId === right.turnId
  );
}

function threadTitle(row: HTMLElement): string | null {
  const title = row.querySelector<HTMLElement>("[data-thread-title]");
  return title?.textContent?.trim() || null;
}

function activeThreadFromDom(): { hostId: string; threadId: string } | null {
  const rows = [...document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].filter(
    (row) => row.getAttribute(ACTIVE) === "true",
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row) return null;
  const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
  const value = threadIdFromSidebarRowElement(row);
  return hostId && value ? { hostId, threadId: nativeThreadId(hostId, value) } : null;
}

function itemSummary(threadId: string, title: string, hostId: string): string {
  return JSON.stringify([threadId, title, hostId]);
}

export function installRendererPendingConfirmations(options: PendingConfirmationDomOptions): {
  refresh(): void;
  dispose(): void;
} {
  const model = options.model ?? new PendingConfirmationsModel(window.localStorage);
  const hosts = new Map<string, HostSubscription>();
  const style = document.createElement("style");
  const modal = document.createElement("div");
  const panel = document.createElement("section");
  const heading = document.createElement("header");
  const headingText = document.createElement("div");
  const title = document.createElement("h2");
  const queue = document.createElement("button");
  const body = document.createElement("div");
  const kind = document.createElement("span");
  const conversation = document.createElement("h3");
  const summary = document.createElement("div");
  const time = document.createElement("time");
  const actions = document.createElement("footer");
  const view = document.createElement("button");
  const read = document.createElement("button");
  const archive = document.createElement("button");
  const close = document.createElement("button");
  const notice = document.createElement("p");
  let disposed = false;
  let renderedKey = "";
  let expanded = true;
  let visibleEntry: PendingConfirmationRecord | null = null;
  let dismissedEntryKey: string | null = null;
  const silentEntries = new Set<string>();
  let reading: { hostId: string; threadId: string; turnId: string; since: number } | null = null;
  let readTimer: number | null = null;
  let locale: Locale = options.getLocale();

  style.textContent = `
[${MODAL}]{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:color-mix(in srgb, CanvasText 14%, transparent);pointer-events:none;font:13px/1.5 system-ui,sans-serif}
[${MODAL}][hidden]{display:none}
[${PANEL}]{display:flex;flex-direction:column;box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 48px));overflow:hidden;border:1px solid color-mix(in srgb, CanvasText 18%, transparent);border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 18px 60px rgb(0 0 0 / 24%);pointer-events:auto}
[${MODAL}] header{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid color-mix(in srgb, CanvasText 12%, transparent)}
[${MODAL}] header h2{min-width:0;margin:0;font-size:15px;line-height:22px}
[${MODAL}] header > div{min-width:0;flex:1}
[${QUEUE}]{display:inline-flex;align-items:center;min-height:24px;margin-top:2px;padding:2px 7px;border:0;border-radius:999px;background:color-mix(in srgb, Highlight 14%, transparent);color:CanvasText;font:12px/18px inherit;cursor:pointer}
[${QUEUE}]:focus-visible,[${MODAL}] button:focus-visible{outline:2px solid Highlight;outline-offset:1px}
[${MODAL}] .codexhost-pending-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:CanvasText;cursor:pointer}
[${MODAL}] .codexhost-pending-close:hover{background:color-mix(in srgb,CanvasText 10%,transparent)}
[${MODAL}] .codexhost-pending-body{min-height:0;overflow:auto;padding:16px}
[${MODAL}] .codexhost-pending-kind{display:inline-flex;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,CanvasText 9%,transparent);font-size:12px}
[${MODAL}] .codexhost-pending-body h3{margin:10px 0 6px;font-size:17px;line-height:24px;overflow-wrap:anywhere}
[${MODAL}] .codexhost-pending-summary{max-height:240px;margin:0;overflow:auto;overflow-wrap:anywhere;color:color-mix(in srgb,CanvasText 84%,transparent);font-size:13px;line-height:20px}
[${MODAL}] .codexhost-pending-summary>:first-child{margin-top:0}
[${MODAL}] .codexhost-pending-summary>:last-child{margin-bottom:0}
[${MODAL}] .codexhost-pending-summary p,[${MODAL}] .codexhost-pending-summary ul,[${MODAL}] .codexhost-pending-summary ol,[${MODAL}] .codexhost-pending-summary pre,[${MODAL}] .codexhost-pending-summary blockquote{margin:6px 0}
[${MODAL}] .codexhost-pending-summary ul,[${MODAL}] .codexhost-pending-summary ol{padding-left:20px}
[${MODAL}] .codexhost-pending-summary li+li{margin-top:4px}
[${MODAL}] .codexhost-pending-summary blockquote{padding:6px 10px;border-left:3px solid color-mix(in srgb,CanvasText 24%,transparent);background:color-mix(in srgb,CanvasText 6%,transparent)}
[${MODAL}] .codexhost-pending-summary pre{padding:8px 10px;border-radius:4px;background:color-mix(in srgb,CanvasText 8%,transparent);overflow-x:auto}
[${MODAL}] .codexhost-pending-summary code{font-family:ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:12px}
[${MODAL}] .codexhost-pending-summary :not(pre)>code{padding:1px 4px;border-radius:3px;background:color-mix(in srgb,CanvasText 10%,transparent)}
[${MODAL}] .codexhost-pending-summary strong{font-weight:600;color:CanvasText}
[${MODAL}] .codexhost-pending-summary a{color:Highlight;text-decoration:none}
[${MODAL}] .codexhost-pending-summary a:hover{text-decoration:underline}
[${MODAL}] .codexhost-pending-summary hr{border:0;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent);margin:8px 0}
[${MODAL}] .codexhost-pending-time{display:block;margin-top:10px;color:GrayText;font-size:12px}
[${MODAL}] .codexhost-pending-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent);flex-wrap:wrap}
[${MODAL}] .codexhost-pending-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:6px 11px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:6px;background:transparent;color:CanvasText;font:inherit;cursor:pointer}
[${MODAL}] .codexhost-pending-actions button[data-primary="true"]{border-color:Highlight;background:Highlight;color:HighlightText}
[${MODAL}] .codexhost-pending-actions button:disabled{opacity:.55;cursor:wait}
[${MODAL}] .codexhost-pending-notice{min-height:18px;margin:-6px 16px 0;color:#c2410c;font-size:12px;overflow-wrap:anywhere}
[${MODAL}] .codexhost-pending-notice:empty{visibility:hidden}
@media (max-width:520px){[${MODAL}]{padding:8px}[${PANEL}]{width:calc(100vw - 16px);max-height:calc(100vh - 16px)}[${MODAL}] .codexhost-pending-actions button{flex:1 1 auto}}
`;
  title.textContent = "";
  queue.type = "button";
  queue.hidden = true;
  headingText.append(title, queue);
  close.type = "button";
  close.className = "codexhost-pending-close";
  close.append(createElement(X, { width: 17, height: 17, "aria-hidden": "true" }));
  heading.append(headingText, close);
  body.className = "codexhost-pending-body";
  kind.className = "codexhost-pending-kind";
  conversation.className = "codexhost-pending-conversation";
  summary.className = "codexhost-pending-summary";
  time.className = "codexhost-pending-time";
  body.append(kind, conversation, summary, time);
  view.type = read.type = archive.type = "button";
  view.dataset.primary = "true";
  view.append(createElement(Eye, { width: 15, height: 15, "aria-hidden": "true" }));
  read.append(createElement(Check, { width: 15, height: 15, "aria-hidden": "true" }));
  archive.append(createElement(Archive, { width: 15, height: 15, "aria-hidden": "true" }));
  actions.className = "codexhost-pending-actions";
  actions.append(view, read, archive);
  notice.className = "codexhost-pending-notice";
  notice.setAttribute("role", "alert");
  panel.append(heading, body, notice, actions);
  modal.setAttribute(MODAL, "");
  panel.setAttribute(PANEL, "");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "false");
  modal.append(panel);
  document.head.append(style);
  document.body.append(modal);

  const clearReadTimer = (): void => {
    if (readTimer !== null) window.clearTimeout(readTimer);
    readTimer = null;
    reading = null;
  };

  const confirm = (entry: PendingConfirmationRecord): boolean => {
    clearReadTimer();
    const changed = model.confirm(entry);
    silentEntries.delete(entryKey(entry));
    if (
      changed &&
      visibleEntry?.turnId === entry.turnId &&
      visibleEntry.threadId === entry.threadId
    ) {
      visibleEntry = null;
      expanded = false;
      dismissedEntryKey = null;
    }
    render();
    return changed;
  };

  const closeModal = (): void => {
    const latest = model.latestPending();
    dismissedEntryKey = visibleEntry ? entryKey(visibleEntry) : latest ? entryKey(latest) : null;
    expanded = false;
    visibleEntry = null;
    clearReadTimer();
    render();
  };

  const render = (): void => {
    if (disposed) return;
    locale = options.getLocale();
    const copy = messages(locale);
    const entries = model.pending();
    const latest = entries[0] ?? null;
    const active = options.activeThread() ?? activeThreadFromDom();
    const visible = visibleEntry;
    if (visible && !entries.some((entry) => sameEntry(entry, visible))) {
      visibleEntry = null;
    }
    if (
      !expanded ||
      !latest ||
      !document.hasFocus() ||
      document.hidden ||
      silentEntries.has(entryKey(latest)) ||
      dismissedEntryKey === entryKey(latest) ||
      (active?.hostId === latest.hostId && active.threadId === latest.threadId)
    ) {
      renderedKey = "";
      modal.hidden = true;
      return;
    }
    const entry = visibleEntry ?? latest;
    visibleEntry = entry;
    const key = [
      locale,
      entry.hostId,
      entry.threadId,
      entry.turnId,
      entry.status,
      entry.summary,
      entries.length,
      notice.textContent,
    ].join("\u0000");
    if (key === renderedKey && !modal.hidden) return;
    renderedKey = key;
    title.textContent = copy.title;
    queue.hidden = entries.length <= 1;
    queue.textContent = entries.length > 1 ? copy.more(entries.length - 1) : "";
    kind.textContent = statusLabel(locale, entry.status);
    kind.dataset.tone = statusTone(entry.status, isRateLimited(entry));
    conversation.textContent = entry.title || copy.unnamed;
    summary.replaceChildren();
    appendMarkdownBlocks(document, summary, entry.summary ?? "");
    time.textContent = formatTime(entry.completedAt, locale);
    view.textContent = copy.view;
    read.textContent = copy.read;
    archive.textContent = copy.archive;
    close.title = copy.close;
    close.setAttribute("aria-label", copy.close);
    notice.textContent = "";
    view.disabled = read.disabled = archive.disabled = false;
    modal.hidden = false;
  };

  const reconcileHost = async (hostId: string, client: RendererModelClient): Promise<void> => {
    const requestThreadProjection = client.requestThreadProjection;
    if (!requestThreadProjection) return;
    let turnsPaginationSupported = true;
    let list: unknown;
    try {
      list = await requestThreadProjection("thread/list", {
        limit: RECONCILE_LIMIT,
        archived: false,
        sortKey: "updated_at",
        sortDirection: "desc",
      });
    } catch {
      return;
    }
    const listRecord = record(list);
    const rows = Array.isArray(listRecord?.data) ? (listRecord.data as unknown[]) : [];
    let offset = 0;
    while (offset < rows.length) {
      const batch = rows.slice(offset, offset + RECONCILE_CONCURRENCY);
      offset += RECONCILE_CONCURRENCY;
      await Promise.all(
        batch.map(async (value) => {
          const row = record(value);
          if (!row || typeof row.id !== "string" || !row.id || !row.cwd) return;
          if (record(row.status)?.type === "active") return;
          let result: unknown;
          try {
            if (turnsPaginationSupported) {
              try {
                result = await requestThreadProjection("thread/turns/list", {
                  threadId: row.id,
                  limit: 1,
                  sortDirection: "desc",
                  itemsView: "full",
                });
              } catch {
                turnsPaginationSupported = false;
                result = await requestThreadProjection("thread/read", {
                  threadId: row.id,
                  includeTurns: true,
                });
              }
            } else {
              result = await requestThreadProjection("thread/read", {
                threadId: row.id,
                includeTurns: true,
              });
            }
          } catch {
            return;
          }
          const page = record(result);
          const thread = record(page?.thread);
          const turns = Array.isArray(page?.data)
            ? (page.data as unknown[])
            : Array.isArray(thread?.turns)
              ? (thread.turns as unknown[])
              : [];
          const latest = thread ? turns.at(-1) : turns[0];
          const turn = record(latest);
          if (!turn || typeof turn.id !== "string" || !turn.id) return;
          const terminal =
            turn.status === "completed" ||
            turn.status === "succeeded" ||
            turn.status === "failed" ||
            turn.status === "interrupted" ||
            turn.status === "cancelled";
          if (!terminal) return;
          if (
            model
              .entries()
              .some(
                (entry) =>
                  entry.hostId === hostId && entry.threadId === row.id && entry.turnId === turn.id,
              )
          )
            return;
          const restored = model.upsert({
            hostId,
            threadId: row.id,
            title: text(row.name) || text(row.title) || text(row.preview) || "未命名会话",
            turnId: turn.id,
            status: turn.status,
            items: turn.items,
            completedAt: turn.completedAt,
            error: turn.error,
          });
          if (restored) silentEntries.add(entryKey(restored));
        }),
      );
    }
  };

  const connect = (hostId: string): void => {
    let state = hosts.get(hostId);
    if (!state) {
      state = { manager: null, dispose: null, reconciledManager: null };
      hosts.set(hostId, state);
    }
    const discovered = options.getManager(hostId);
    const manager = discovered?.addNotificationCallback
      ? (discovered as NotificationManager)
      : null;
    if (state.manager !== manager) {
      state.dispose?.();
      state.dispose = null;
      state.manager = manager;
      if (manager?.addNotificationCallback) {
        const current = state;
        try {
          current.dispose = manager.addNotificationCallback(
            ["turn/started", "turn/completed"],
            (notification) => {
              if (disposed || current.manager !== manager || options.getManager(hostId) !== manager)
                return;
              const event = record(notification);
              const params = record(event?.params);
              const turn = record(params?.turn);
              const threadId = text(params?.threadId);
              const turnId = text(turn?.id);
              if (!threadId || !turnId) return;
              if (event?.method === "turn/started") {
                model.startTurn(hostId, threadId, turnId);
                return;
              }
              if (event?.method !== "turn/completed") return;
              const active = options.activeThread() ?? activeThreadFromDom();
              if (active?.hostId === hostId && active.threadId === threadId) {
                silentEntries.add(`${hostId}\u0000${threadId}\u0000${turnId}`);
              }
              const row =
                [...document.querySelectorAll<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)].find(
                  (candidate) =>
                    candidate.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE) === hostId &&
                    nativeThreadId(hostId, threadIdFromSidebarRowElement(candidate) ?? "") ===
                      threadId,
                ) ?? null;
              const title = row ? threadTitle(row) : null;
              const entry = model.link({
                hostId,
                threadId,
                title: title || undefined,
                turn: turn ?? {},
              });
              if (entry && !silentEntries.has(entryKey(entry))) {
                expanded = true;
                visibleEntry = entry;
                dismissedEntryKey = null;
              }
              render();
            },
          );
        } catch (error) {
          console.warn("[codexhost] Pending confirmation notifications unavailable", error);
          current.manager = null;
        }
      }
    }
    if (manager && state.reconciledManager !== manager) {
      state.reconciledManager = manager;
      const client = options.getClient(hostId);
      if (client) void reconcileHost(hostId, client).then(render, () => undefined);
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    for (const hostId of options.getHostIds()) connect(hostId);
    syncReading();
    render();
  };

  const open = async (entry: PendingConfirmationRecord): Promise<void> => {
    notice.textContent = "";
    try {
      await (options.openThread ?? openRendererThread)(hostThreadIdSchema.parse(entry.threadId), {
        hostId: entry.hostId,
      });
      visibleEntry = null;
      expanded = false;
      clearReadTimer();
      render();
    } catch {
      notice.textContent = messages(locale).openFailed;
    }
  };

  const archiveEntry = async (entry: PendingConfirmationRecord): Promise<void> => {
    const client = options.getClient(entry.hostId);
    if (!client?.requestThreadProjection) {
      notice.textContent = messages(locale).archiveFailed;
      return;
    }
    view.disabled = read.disabled = archive.disabled = true;
    notice.textContent = "";
    try {
      await client.requestThreadProjection("thread/archive", { threadId: entry.threadId });
      confirm(entry);
    } catch {
      notice.textContent = messages(locale).archiveFailed;
      view.disabled = read.disabled = archive.disabled = false;
    }
  };

  const syncReading = (): void => {
    if (disposed) return;
    const active = options.activeThread() ?? activeThreadFromDom();
    const visible = !document.hidden && document.hasFocus();
    const target = active
      ? (model
          .pending()
          .find((entry) => entry.hostId === active.hostId && entry.threadId === active.threadId) ??
        null)
      : null;
    if (!visible || !target) {
      clearReadTimer();
      render();
      return;
    }
    const now = performance.now();
    if (
      !reading ||
      reading.hostId !== target.hostId ||
      reading.threadId !== target.threadId ||
      reading.turnId !== target.turnId
    ) {
      clearReadTimer();
      reading = {
        hostId: target.hostId,
        threadId: target.threadId,
        turnId: target.turnId,
        since: now,
      };
    }
    const remaining = READ_DWELL_MS - (now - reading.since);
    if (remaining <= 0) {
      confirm(target);
      return;
    }
    if (readTimer === null) {
      readTimer = window.setTimeout(() => {
        readTimer = null;
        syncReading();
      }, remaining);
    }
  };

  queue.addEventListener("click", () => {
    const entries = model.pending();
    if (entries.length < 2) return;
    expanded = true;
    const currentIndex = visibleEntry
      ? entries.findIndex(
          (entry) =>
            entry.hostId === visibleEntry?.hostId &&
            entry.threadId === visibleEntry.threadId &&
            entry.turnId === visibleEntry.turnId,
        )
      : -1;
    visibleEntry = entries[(currentIndex + 1) % entries.length] ?? entries[0] ?? null;
    dismissedEntryKey = null;
    renderedKey = "";
    render();
  });
  close.addEventListener("click", closeModal);
  view.addEventListener("click", () => {
    if (visibleEntry) void open(visibleEntry);
  });
  read.addEventListener("click", () => {
    if (visibleEntry) confirm(visibleEntry);
  });
  archive.addEventListener("click", () => {
    if (visibleEntry) void archiveEntry(visibleEntry);
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || modal.hidden) return;
    event.preventDefault();
    closeModal();
  };
  const onFocus = (): void => {
    syncReading();
    refresh();
  };
  const onBlur = (): void => {
    clearReadTimer();
    render();
  };
  const onStorage = (): void => {
    renderedKey = "";
    render();
  };
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onBlur);
  window.addEventListener("storage", onStorage);
  const unsubscribeModel = model.subscribe(() => {
    renderedKey = "";
    render();
  });
  const unsubscribeHosts = options.subscribeHosts?.(refresh) ?? (() => undefined);
  const observer = new MutationObserver(() => {
    if (!modal.hidden) render();
    syncReading();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ACTIVE],
  });
  refresh();

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearReadTimer();
      observer.disconnect();
      unsubscribeModel();
      unsubscribeHosts();
      for (const state of hosts.values()) state.dispose?.();
      hosts.clear();
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
      window.removeEventListener("storage", onStorage);
      modal.remove();
      style.remove();
    },
  };
}

export function pendingConfirmationRowKey(row: HTMLElement): string | null {
  const hostId = row.getAttribute(SIDEBAR_THREAD_HOST_ID_ATTRIBUTE);
  const value = threadIdFromSidebarRowElement(row);
  if (!hostId || !value) return null;
  const title = threadTitle(row) || "未命名会话";
  return itemSummary(nativeThreadId(hostId, value), title, hostId);
}
