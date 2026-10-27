export const THREAD_REMINDERS_STORAGE_KEY = "codexhost.thread-reminders.v1";
export const THREAD_REMINDERS_LIMIT = 200;

/** 一次性提醒在指定时刻触发一次；周期性提醒按固定间隔从上次时刻继续累积。 */
export interface ThreadReminderOnce {
  kind: "once";
  at: number;
}

export interface ThreadReminderInterval {
  kind: "interval";
  everyMs: number;
  nextAt: number;
}

export type ThreadReminderSchedule = ThreadReminderOnce | ThreadReminderInterval;

export interface ThreadReminderRecord {
  id: string;
  hostId: string;
  threadId: string;
  title: string;
  project: string;
  message: string;
  schedule: ThreadReminderSchedule;
  enabled: boolean;
  createdAt: number;
  firedAt: number | null;
}

export interface ThreadReminderStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredThreadRemindersV1 {
  version: 1;
  entries: ThreadReminderRecord[];
}

/** 周期预设：界面只提供这几个档位，间隔以毫秒保存。 */
export const THREAD_REMINDER_PRESETS = [
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export const THREAD_REMINDER_MIN_INTERVAL_MS = 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

/** 提醒正文保留换行，只去掉行尾空白与多余空行。 */
function body(value: string, limit: number): string {
  const kept: string[] = [];
  let blank = true;
  for (const raw of value.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = raw.replace(/[ \t]+$/u, "");
    if (line.length === 0) {
      if (blank) continue;
      blank = true;
    } else {
      blank = false;
    }
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  const normalized = kept.join("\n").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function normalizeSchedule(value: unknown): ThreadReminderSchedule | null {
  const schedule = record(value);
  if (!schedule) return null;
  const at = finiteNumber(schedule.at);
  const nextAt = finiteNumber(schedule.nextAt);
  const everyMs = finiteNumber(schedule.everyMs);
  if (schedule.kind === "once") return at === null ? null : { kind: "once", at };
  if (schedule.kind === "interval") {
    if (nextAt === null || everyMs === null || everyMs < THREAD_REMINDER_MIN_INTERVAL_MS)
      return null;
    return { kind: "interval", everyMs, nextAt };
  }
  return null;
}

function normalizeStored(value: unknown): ThreadReminderRecord | null {
  const entry = record(value);
  if (!entry) return null;
  const id = text(entry.id);
  const hostId = text(entry.hostId);
  const threadId = text(entry.threadId);
  const schedule = normalizeSchedule(entry.schedule);
  if (!id || !hostId || !threadId || !schedule) return null;
  const message = body(text(entry.message), 2_000);
  if (!message) return null;
  return {
    id,
    hostId,
    threadId,
    title: compact(text(entry.title), 300) || "未命名会话",
    project: text(entry.project),
    message,
    schedule,
    enabled: entry.enabled !== false,
    createdAt: finiteNumber(entry.createdAt) ?? 0,
    firedAt: finiteNumber(entry.firedAt),
  };
}

export function reminderDueAt(schedule: ThreadReminderSchedule): number {
  return schedule.kind === "once" ? schedule.at : schedule.nextAt;
}

/** 到期判定只看启用状态与下一次时刻；停用的提醒保留在列表里供用户重新开启。 */
export function reminderIsDue(entry: ThreadReminderRecord, now: number): boolean {
  return entry.enabled && reminderDueAt(entry.schedule) <= now;
}

export function sortThreadReminders(
  entries: readonly ThreadReminderRecord[],
): ThreadReminderRecord[] {
  return [...entries].sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return reminderDueAt(left.schedule) - reminderDueAt(right.schedule);
  });
}

export function pruneThreadReminders(
  entries: readonly ThreadReminderRecord[],
  limit = THREAD_REMINDERS_LIMIT,
): ThreadReminderRecord[] {
  return sortThreadReminders(entries).slice(0, limit);
}

export type ThreadReminderLocale = "zh-CN" | "en";

/** 列表与卡片共用的周期描述，避免两处各写一套。 */
export function reminderScheduleLabel(
  schedule: ThreadReminderSchedule,
  locale: ThreadReminderLocale,
  now: number,
): string {
  const zh = locale === "zh-CN";
  if (schedule.kind === "once") return zh ? "一次性" : "One time";
  const minutes = Math.round(schedule.everyMs / 60_000);
  const every =
    minutes % (24 * 60) === 0
      ? zh
        ? `每 ${minutes / (24 * 60)} 天`
        : `Every ${minutes / (24 * 60)} d`
      : minutes % 60 === 0
        ? zh
          ? `每 ${minutes / 60} 小时`
          : `Every ${minutes / 60} h`
        : zh
          ? `每 ${minutes} 分钟`
          : `Every ${minutes} min`;
  const due = reminderDueAt(schedule);
  return due <= now ? every : `${every} · ${formatClock(due, locale)}`;
}

export function formatClock(value: number, locale: ThreadReminderLocale): string {
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

export class ThreadRemindersModel {
  #entries: ThreadReminderRecord[];
  readonly #listeners = new Set<() => void>();

  constructor(
    readonly storage: ThreadReminderStore | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#entries = this.#read();
  }

  #read(): ThreadReminderRecord[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(THREAD_REMINDERS_STORAGE_KEY);
      if (!raw) return [];
      const value = record(JSON.parse(raw));
      if (value?.version !== 1 || !Array.isArray(value.entries)) return [];
      return pruneThreadReminders(
        value.entries
          .map(normalizeStored)
          .filter((entry): entry is ThreadReminderRecord => entry !== null),
      );
    } catch {
      return [];
    }
  }

  #write(): void {
    if (!this.storage) return;
    try {
      const value: StoredThreadRemindersV1 = { version: 1, entries: this.#entries };
      this.storage.setItem(THREAD_REMINDERS_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // 存储失败不阻塞本窗口的提醒调度。
    }
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  list(): ThreadReminderRecord[] {
    return sortThreadReminders(this.#entries);
  }

  forThread(hostId: string, threadId: string): ThreadReminderRecord[] {
    return sortThreadReminders(
      this.#entries.filter((entry) => entry.hostId === hostId && entry.threadId === threadId),
    );
  }

  get(id: string): ThreadReminderRecord | null {
    return this.#entries.find((entry) => entry.id === id) ?? null;
  }

  /** 同一 Thread 可有多条提醒，因此身份用独立 id，不按会话折叠。 */
  save(input: {
    id?: string;
    hostId: string;
    threadId: string;
    title: string;
    project?: string;
    message: string;
    schedule: ThreadReminderSchedule;
  }): ThreadReminderRecord | null {
    const hostId = input.hostId.trim();
    const threadId = input.threadId.trim();
    const message = body(input.message, 2_000);
    const schedule = normalizeSchedule(input.schedule);
    if (!hostId || !threadId || !message || !schedule) return null;
    const existing = input.id ? this.get(input.id) : null;
    const next: ThreadReminderRecord = {
      id: existing?.id ?? newId(),
      hostId,
      threadId,
      title: compact(input.title, 300) || "未命名会话",
      project: input.project ?? "",
      message,
      schedule,
      enabled: true,
      createdAt: existing?.createdAt ?? this.now(),
      firedAt: existing?.firedAt ?? null,
    };
    this.#entries = pruneThreadReminders([
      ...this.#entries.filter((entry) => entry.id !== next.id),
      next,
    ]);
    this.#write();
    this.#publish();
    return next;
  }

  remove(id: string): boolean {
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((entry) => entry.id !== id);
    if (this.#entries.length === before) return false;
    this.#write();
    this.#publish();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const index = this.#entries.findIndex((entry) => entry.id === id);
    const current = index < 0 ? undefined : this.#entries[index];
    if (!current || current.enabled === enabled) return false;
    // 重新启用一个已过期的提醒时，把时刻推到现在之后，避免立刻补弹。
    let schedule = current.schedule;
    if (enabled && reminderDueAt(schedule) <= this.now()) {
      const now = this.now();
      schedule =
        schedule.kind === "once"
          ? { kind: "once", at: now + THREAD_REMINDER_MIN_INTERVAL_MS }
          : { kind: "interval", everyMs: schedule.everyMs, nextAt: now + schedule.everyMs };
    }
    this.#entries[index] = { ...current, enabled, schedule };
    this.#write();
    this.#publish();
    return true;
  }

  due(now: number = this.now()): ThreadReminderRecord[] {
    return sortThreadReminders(this.#entries.filter((entry) => reminderIsDue(entry, now)));
  }

  /**
   * 记一次触发：一次性提醒随后停用，周期性提醒把下一次时刻推进到 `now` 之后。
   * 应用长时间未运行导致的多次错过只补一次，避免重开后连续弹同一提醒。
   */
  markFired(id: string, now: number = this.now()): ThreadReminderRecord | null {
    const index = this.#entries.findIndex((entry) => entry.id === id);
    const current = index < 0 ? undefined : this.#entries[index];
    if (!current) return null;
    const next: ThreadReminderRecord =
      current.schedule.kind === "once"
        ? { ...current, enabled: false, firedAt: now }
        : {
            ...current,
            firedAt: now,
            schedule: {
              kind: "interval",
              everyMs: current.schedule.everyMs,
              nextAt: nextOccurrence(current.schedule, now),
            },
          };
    this.#entries[index] = next;
    this.#write();
    this.#publish();
    return next;
  }

  /** 稍后提醒：一次性顺延触发时刻，周期性只把这一次推到稍后，周期不变。 */
  snooze(id: string, delayMs: number, now: number = this.now()): ThreadReminderRecord | null {
    const index = this.#entries.findIndex((entry) => entry.id === id);
    const current = index < 0 ? undefined : this.#entries[index];
    if (!current) return null;
    const target = now + Math.max(THREAD_REMINDER_MIN_INTERVAL_MS, delayMs);
    const schedule: ThreadReminderSchedule =
      current.schedule.kind === "once"
        ? { kind: "once", at: target }
        : { kind: "interval", everyMs: current.schedule.everyMs, nextAt: target };
    const next: ThreadReminderRecord = { ...current, enabled: true, schedule };
    this.#entries[index] = next;
    this.#write();
    this.#publish();
    return next;
  }

  /** 其他窗口增删后重新读取存储，避免本窗口旧快照覆盖。 */
  reload(): boolean {
    if (!this.storage) return false;
    const next = this.#read();
    if (sameEntries(this.#entries, next)) return false;
    this.#entries = next;
    this.#publish();
    return true;
  }
}

function nextOccurrence(schedule: ThreadReminderInterval, now: number): number {
  const every = schedule.everyMs;
  if (schedule.nextAt > now) return schedule.nextAt;
  const skipped = Math.floor((now - schedule.nextAt) / every) + 1;
  return schedule.nextAt + skipped * every;
}

function sameEntries(
  left: readonly ThreadReminderRecord[],
  right: readonly ThreadReminderRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && JSON.stringify(entry) === JSON.stringify(other);
  });
}

function newId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? `reminder-${random}`
    : `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
