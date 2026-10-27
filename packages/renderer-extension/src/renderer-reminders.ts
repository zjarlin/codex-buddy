import createElement from "lucide/dist/esm/createElement.mjs";
import AlarmClock from "lucide/dist/esm/icons/alarm-clock.mjs";
import Check from "lucide/dist/esm/icons/check.mjs";
import Eye from "lucide/dist/esm/icons/eye.mjs";
import Timer from "lucide/dist/esm/icons/timer.mjs";
import Trash2 from "lucide/dist/esm/icons/trash-2.mjs";

import { appendMarkdownBlocks } from "./markdown-renderer.js";
import { createNotificationCard } from "./notification-card.js";
import { sidebarProjectLabelForThread } from "./renderer-titlebar-project-name.js";
import {
  THREAD_REMINDER_MIN_INTERVAL_MS,
  THREAD_REMINDER_PRESETS,
  ThreadRemindersModel,
  formatClock,
  reminderDueAt,
  reminderScheduleLabel,
  type ThreadReminderLocale,
  type ThreadReminderRecord,
  type ThreadReminderSchedule,
} from "./thread-reminders-state.js";

type Locale = ThreadReminderLocale;

const MODAL = "data-codexhost-reminder";
const PANEL = "data-codexhost-reminder-panel";
const QUEUE = "data-codexhost-reminder-queue";
const DIALOG = "data-codexhost-reminder-dialog";
const SNOOZE_MS = 10 * 60_000;
/** 定时器单次最长睡眠；更远的到期时间在醒来后重新计算。 */
const MAX_TIMER_DELAY_MS = 60_000;
const PLACEHOLDER_TITLE = /^[\s.…·•]+$/u;
/** 周期下拉的默认档位：30 分钟。档位表被裁剪时回落到最小间隔。 */
const DEFAULT_INTERVAL_MS = THREAD_REMINDER_PRESETS[1] ?? THREAD_REMINDER_MIN_INTERVAL_MS;

export interface RendererRemindersOptions {
  getLocale(): Locale;
  openThread(threadId: string, options: { hostId: string; project?: string }): Promise<void>;
  model?: ThreadRemindersModel;
  now?(): number;
}

function messages(locale: Locale) {
  return locale === "zh-CN"
    ? {
        title: "会话提醒",
        more: (count: number) => `还有 ${count} 个提醒`,
        open: "打开会话",
        snooze: "稍后 10 分钟",
        dismiss: "知道了",
        close: "关闭",
        openFailed: "无法打开该会话，请从侧栏重试。",
        repeat: "周期提醒",
        once: "一次性提醒",
        menu: "提醒…",
        menuScheduled: (label: string) => `提醒：${label}`,
        dialogTitle: "会话提醒",
        dialogHint: "到点后在本窗口弹出提醒卡片，不会发送消息或改动会话。",
        message: "提醒内容",
        messagePlaceholder: "例如：clouddev 迁 macmini 做了嘛",
        mode: "提醒方式",
        modeOnce: "一次性",
        modeRepeat: "周期性",
        when: "提醒时间",
        every: "重复间隔",
        save: "保存提醒",
        cancel: "取消",
        existing: "该会话的提醒",
        none: "还没有提醒。",
        remove: "删除",
        invalidMessage: "请填写提醒内容。",
        invalidTime: "请选择晚于当前时间的提醒时刻。",
        unnamed: "未命名会话",
        due: "提醒时间",
        unit: { minute: "分钟", hour: "小时", day: "天" },
      }
    : {
        title: "Reminder",
        more: (count: number) => `${count} more reminders`,
        open: "Open conversation",
        snooze: "In 10 minutes",
        dismiss: "Got it",
        close: "Close",
        openFailed: "Could not open the conversation. Retry from the sidebar.",
        repeat: "Repeating reminder",
        once: "One-time reminder",
        menu: "Remind me…",
        menuScheduled: (label: string) => `Reminder: ${label}`,
        dialogTitle: "Conversation reminder",
        dialogHint: "Pops a card in this window at the due time; it sends no message.",
        message: "Message",
        messagePlaceholder: "e.g. Did the macmini migration land?",
        mode: "Repeat",
        modeOnce: "One time",
        modeRepeat: "Periodic",
        when: "Remind at",
        every: "Interval",
        save: "Save reminder",
        cancel: "Cancel",
        existing: "Reminders for this conversation",
        none: "No reminders yet.",
        remove: "Delete",
        invalidMessage: "Enter the reminder text.",
        invalidTime: "Pick a time later than now.",
        unnamed: "Untitled conversation",
        due: "Due",
        unit: { minute: "min", hour: "h", day: "d" },
      };
}

/** datetime-local 需要本地墙钟格式，不能用 toISOString（会按 UTC 偏移）。 */
function localInputValue(value: number): string {
  const date = new Date(value);
  const pad = (input: number): string => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 默认提醒时间：下一个 5 分钟刻度之后 30 分钟，避免默认值落在当下。 */
function defaultDueTime(now: number): number {
  const step = 5 * 60_000;
  const nextMark = Math.floor(now / step) * step + step;
  return nextMark + 30 * 60_000;
}

function intervalLabel(everyMs: number, locale: Locale): string {
  const unit = messages(locale).unit;
  if (everyMs % (24 * 60 * 60_000) === 0) return `${everyMs / (24 * 60 * 60_000)} ${unit.day}`;
  if (everyMs % (60 * 60_000) === 0) return `${everyMs / (60 * 60_000)} ${unit.hour}`;
  return `${everyMs / 60_000} ${unit.minute}`;
}

function parseInterval(value: string): number | null {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.max(THREAD_REMINDER_MIN_INTERVAL_MS, Math.round(minutes) * 60_000);
}

function rowTitle(row: HTMLElement, locale: Locale): string {
  const value = (row.querySelector<HTMLElement>("[data-thread-title]")?.textContent ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!value || (value.length <= 3 && PLACEHOLDER_TITLE.test(value))) {
    return locale === "zh-CN" ? "未命名会话" : "Untitled conversation";
  }
  return value;
}

export function installRendererReminders(options: RendererRemindersOptions): {
  refresh(): void;
  dispose(): void;
  /** 供侧栏行操作菜单注入“提醒…”入口。 */
  decorate(
    menu: HTMLElement,
    row: HTMLElement,
    hostId: string,
    threadId: string,
    close: () => void,
  ): void;
} {
  const now = options.now ?? (() => Date.now());
  const model = options.model ?? new ThreadRemindersModel(window.localStorage, now);
  let locale: Locale = options.getLocale();
  const card = createNotificationCard({
    attribute: MODAL,
    panelAttribute: PANEL,
    queueAttribute: QUEUE,
    closeLabel: () => messages(locale).close,
  });
  const kind = document.createElement("span");
  kind.className = "codexhost-reminder-kind";
  const project = document.createElement("div");
  project.className = "codexhost-reminder-project";
  const conversation = document.createElement("h3");
  conversation.className = "codexhost-reminder-conversation";
  const bodyText = document.createElement("div");
  bodyText.className = "codexhost-reminder-summary";
  const time = document.createElement("time");
  time.className = "codexhost-reminder-time";
  card.body.append(kind, project, conversation, bodyText, time);

  const open = document.createElement("button");
  open.dataset.primary = "true";
  open.append(createElement(Eye, { width: 15, height: 15, "aria-hidden": "true" }));
  const snooze = document.createElement("button");
  snooze.append(createElement(Timer, { width: 15, height: 15, "aria-hidden": "true" }));
  const dismiss = document.createElement("button");
  dismiss.append(createElement(Check, { width: 15, height: 15, "aria-hidden": "true" }));
  const actions = document.createElement("div");
  actions.className = "codexhost-reminder-actions";
  actions.append(open, snooze, dismiss);
  card.actions.append(actions);

  const style = document.createElement("style");
  style.textContent = `
[${MODAL}] .codexhost-reminder-kind{display:inline-flex;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,CanvasText 9%,transparent);font-size:12px}
[${MODAL}] .codexhost-reminder-project{font-size:12px;color:GrayText;overflow-wrap:anywhere;margin:6px 0 2px}
[${MODAL}] .codexhost-reminder-conversation{margin:6px 0;font-size:17px;line-height:24px;overflow-wrap:anywhere}
[${MODAL}] .codexhost-reminder-summary{flex:1 1 auto;min-height:0;overflow:auto;overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px;color:color-mix(in srgb,CanvasText 84%,transparent)}
[${MODAL}] .codexhost-reminder-time{display:block;margin-top:10px;color:GrayText;font-size:12px}
[${MODAL}] .codexhost-reminder-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
[${MODAL}] .codexhost-reminder-actions button{border-color:color-mix(in srgb,Highlight 45%,transparent)}
[${DIALOG}]{box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid var(--color-border,#8884);border-radius:10px;background:var(--color-token-dropdown-background,light-dark(#fff,#24262c));color:var(--color-token-text-primary,light-dark(#202020,#eee));box-shadow:0 12px 48px #0004;font:13px/1.5 system-ui,sans-serif;color-scheme:inherit}
[${DIALOG}]::backdrop{background:#0005}
[${DIALOG}] h2{font-size:15px;margin:0 0 6px}
[${DIALOG}] p{margin:0 0 10px;color:GrayText;overflow-wrap:anywhere}
[${DIALOG}] label{display:block;margin:0 0 8px}
[${DIALOG}] label>span{display:block;font-size:12px;color:GrayText;margin-bottom:3px}
[${DIALOG}] textarea,[${DIALOG}] input,[${DIALOG}] select{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #8886;border-radius:6px;background:transparent;color:inherit;font:inherit}
[${DIALOG}] textarea{min-height:64px;resize:vertical}
[${DIALOG}] .codexhost-reminder-row{display:flex;gap:8px;flex-wrap:wrap}
[${DIALOG}] .codexhost-reminder-row>label{flex:1 1 150px}
[${DIALOG}] .codexhost-reminder-error{color:#c2410c;font-size:12px;min-height:16px;margin:0 0 6px}
[${DIALOG}] .codexhost-reminder-error:empty{visibility:hidden}
[${DIALOG}] .codexhost-reminder-list{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:180px;overflow:auto}
[${DIALOG}] .codexhost-reminder-list li{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #8884;border-radius:6px}
[${DIALOG}] .codexhost-reminder-list li>span{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
[${DIALOG}] .codexhost-reminder-buttons{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}
[${DIALOG}] button{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid #8884;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
[${DIALOG}] button:hover:not(:disabled){background:color-mix(in srgb,currentColor 8%,transparent)}
[${DIALOG}] button[data-primary="true"]{border-color:Highlight;background:Highlight;color:HighlightText}
`;
  document.head.append(style);

  let visible: ThreadReminderRecord | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let dialog: HTMLDialogElement | null = null;

  const scheduleNext = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (disposed) return;
    // 已经到点的提醒由卡片呈现，不再参与计时：否则会以 0 延迟反复唤醒自己。
    const current = now();
    const next = model
      .list()
      .filter((entry) => entry.enabled)
      .reduce<number | null>((soonest, entry) => {
        const due = reminderDueAt(entry.schedule);
        if (due <= current) return soonest;
        return soonest === null || due < soonest ? due : soonest;
      }, null);
    if (next === null) return;
    const delay = Math.min(Math.max(next - current, 0), MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      timer = null;
      render();
      scheduleNext();
    }, delay);
  };

  const markFired = (entry: ThreadReminderRecord): void => {
    model.markFired(entry.id);
    if (visible && visible.id === entry.id) visible = null;
  };

  const render = (): void => {
    if (disposed) return;
    locale = options.getLocale();
    const copy = messages(locale);
    card.close.title = copy.close;
    card.close.setAttribute("aria-label", copy.close);
    const due = model.due();
    const entry = due[0] ?? null;
    visible = entry;
    if (!entry || document.hidden || !document.hasFocus() || (dialog !== null && dialog.open)) {
      card.modal.hidden = true;
      return;
    }
    const projectLabel =
      sidebarProjectLabelForThread(document, entry) ||
      entry.project ||
      (locale === "zh-CN" ? "项目待识别" : "Project unavailable");
    card.title.textContent = copy.title;
    card.queue.hidden = due.length <= 1;
    card.queue.textContent = due.length > 1 ? copy.more(due.length - 1) : "";
    kind.textContent =
      entry.schedule.kind === "once"
        ? copy.once
        : `${copy.repeat} · ${reminderScheduleLabel(entry.schedule, locale, now())}`;
    project.textContent = `${entry.hostId} › ${projectLabel}`;
    project.title = projectLabel;
    conversation.textContent = entry.title || copy.unnamed;
    bodyText.replaceChildren();
    appendMarkdownBlocks(document, bodyText, entry.message);
    time.textContent = `${copy.due} ${formatClock(reminderDueAt(entry.schedule), locale)}`;
    open.textContent = copy.open;
    snooze.textContent = copy.snooze;
    dismiss.textContent = copy.dismiss;
    card.modal.hidden = false;
  };

  const openEntry = async (entry: ThreadReminderRecord): Promise<void> => {
    const projectLabel = sidebarProjectLabelForThread(document, entry) ?? entry.project;
    try {
      await options.openThread(
        entry.threadId,
        projectLabel ? { hostId: entry.hostId, project: projectLabel } : { hostId: entry.hostId },
      );
      markFired(entry);
    } catch {
      card.notice.textContent = messages(locale).openFailed;
      render();
      return;
    }
    card.notice.textContent = "";
    render();
    scheduleNext();
  };

  const openDialog = (target: {
    hostId: string;
    threadId: string;
    title: string;
    project: string;
  }): void => {
    locale = options.getLocale();
    const copy = messages(locale);
    const element = document.createElement("dialog");
    element.setAttribute(DIALOG, "");
    element.setAttribute("aria-label", copy.dialogTitle);
    const heading = document.createElement("h2");
    heading.textContent = copy.dialogTitle;
    const hint = document.createElement("p");
    hint.textContent = `${target.title} · ${copy.dialogHint}`;
    const form = document.createElement("form");
    form.method = "dialog";

    const modeRow = document.createElement("div");
    modeRow.className = "codexhost-reminder-row";
    const modeLabel = document.createElement("label");
    const modeText = document.createElement("span");
    modeText.textContent = copy.mode;
    const mode = document.createElement("select");
    const onceOption = document.createElement("option");
    onceOption.value = "once";
    onceOption.textContent = copy.modeOnce;
    const repeatOption = document.createElement("option");
    repeatOption.value = "interval";
    repeatOption.textContent = copy.modeRepeat;
    mode.append(onceOption, repeatOption);
    modeLabel.append(modeText, mode);

    const everyLabel = document.createElement("label");
    const everyText = document.createElement("span");
    everyText.textContent = copy.every;
    const every = document.createElement("select");
    for (const preset of THREAD_REMINDER_PRESETS) {
      const option = document.createElement("option");
      option.value = String(preset / 60_000);
      option.textContent = intervalLabel(preset, locale);
      every.append(option);
    }
    every.value = String(DEFAULT_INTERVAL_MS / 60_000);
    everyLabel.append(everyText, every);
    everyLabel.hidden = true;
    modeRow.append(modeLabel, everyLabel);

    const whenLabel = document.createElement("label");
    const whenText = document.createElement("span");
    whenText.textContent = copy.when;
    const when = document.createElement("input");
    when.type = "datetime-local";
    when.value = localInputValue(defaultDueTime(now()));
    whenLabel.append(whenText, when);

    const messageLabel = document.createElement("label");
    const messageText = document.createElement("span");
    messageText.textContent = copy.message;
    const message = document.createElement("textarea");
    message.placeholder = copy.messagePlaceholder;
    messageLabel.append(messageText, message);

    const error = document.createElement("p");
    error.className = "codexhost-reminder-error";
    error.setAttribute("role", "alert");

    const list = document.createElement("ul");
    list.className = "codexhost-reminder-list";
    const listTitle = document.createElement("p");
    listTitle.style.margin = "10px 0 0";
    listTitle.textContent = copy.existing;
    const renderExisting = (): void => {
      const entries = model.forThread(target.hostId, target.threadId);
      list.replaceChildren();
      listTitle.textContent = copy.existing;
      if (entries.length === 0) {
        const empty = document.createElement("li");
        empty.style.border = "0";
        empty.textContent = copy.none;
        list.append(empty);
        return;
      }
      for (const entry of entries) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `${reminderScheduleLabel(entry.schedule, locale, now())} · ${entry.message}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.append(createElement(Trash2, { width: 13, height: 13, "aria-hidden": "true" }));
        remove.append(copy.remove);
        remove.addEventListener("click", () => {
          model.remove(entry.id);
          renderExisting();
          render();
          scheduleNext();
        });
        item.append(label, remove);
        list.append(item);
      }
    };

    const buttons = document.createElement("div");
    buttons.className = "codexhost-reminder-buttons";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = copy.cancel;
    cancel.addEventListener("click", () => element.close());
    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.primary = "true";
    save.append(createElement(AlarmClock, { width: 14, height: 14, "aria-hidden": "true" }));
    save.append(copy.save);
    buttons.append(cancel, save);
    form.append(modeRow, whenLabel, messageLabel, error, buttons);

    mode.addEventListener("change", () => {
      everyLabel.hidden = mode.value !== "interval";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = message.value.trim();
      if (!text) {
        error.textContent = copy.invalidMessage;
        message.focus();
        return;
      }
      const at = when.valueAsNumber;
      if (!Number.isFinite(at)) {
        error.textContent = copy.invalidTime;
        return;
      }
      const schedule: ThreadReminderSchedule =
        mode.value === "interval"
          ? {
              kind: "interval",
              everyMs: parseInterval(every.value) ?? DEFAULT_INTERVAL_MS,
              nextAt: at,
            }
          : { kind: "once", at };
      if (reminderDueAt(schedule) <= now()) {
        error.textContent = copy.invalidTime;
        return;
      }
      model.save({
        hostId: target.hostId,
        threadId: target.threadId,
        title: target.title,
        project: target.project,
        message: text,
        schedule,
      });
      element.close();
      render();
      scheduleNext();
    });

    element.append(heading, hint, form, listTitle, list);
    document.body.append(element);
    dialog = element;
    renderExisting();
    element.addEventListener("close", () => {
      dialog = null;
      element.remove();
      render();
      scheduleNext();
    });
    element.showModal();
  };

  const unsubscribe = model.subscribe(() => {
    render();
    scheduleNext();
  });
  const onFocus = (): void => {
    render();
    scheduleNext();
  };
  const onBlur = (): void => render();
  const onVisibility = (): void => render();
  const onStorage = (event: StorageEvent): void => {
    if (event.key && !event.key.startsWith("codexhost.thread-reminders")) return;
    model.reload();
  };
  const onCardClose = (): void => {
    if (!visible) return;
    markFired(visible);
    render();
    scheduleNext();
  };
  const onOpen = (): void => {
    if (visible) void openEntry(visible);
  };
  const onSnooze = (): void => {
    if (!visible) return;
    model.snooze(visible.id, SNOOZE_MS);
    visible = null;
    render();
    scheduleNext();
  };
  const onDismiss = (): void => onCardClose();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || card.modal.hidden) return;
    event.preventDefault();
    onCardClose();
  };

  card.close.addEventListener("click", onCardClose);
  open.addEventListener("click", onOpen);
  snooze.addEventListener("click", onSnooze);
  dismiss.addEventListener("click", onDismiss);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("storage", onStorage);

  render();
  scheduleNext();

  return {
    refresh(): void {
      render();
      scheduleNext();
    },
    decorate(menu, row, hostId, threadId, close): void {
      locale = options.getLocale();
      const copy = messages(locale);
      const entries = model.forThread(hostId, threadId).filter((entry) => entry.enabled);
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-codexhost-thread-reminder", "");
      const label =
        entries.length > 0 && entries[0]
          ? copy.menuScheduled(reminderScheduleLabel(entries[0].schedule, locale, now()))
          : copy.menu;
      item.title = label;
      item.setAttribute("aria-label", label);
      const icon = document.createElement("span");
      icon.style.display = "inline-flex";
      icon.style.alignItems = "center";
      icon.append(createElement(AlarmClock, { width: 15, height: 15, "aria-hidden": "true" }));
      const text = document.createElement("span");
      text.textContent = label;
      item.append(icon, text);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        openDialog({
          hostId,
          threadId,
          title: rowTitle(row, locale),
          project: sidebarProjectLabelForThread(document, { hostId, threadId }) ?? "",
        });
      });
      menu.append(item);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe();
      dialog?.close();
      dialog = null;
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      card.dispose();
      style.remove();
    },
  };
}
