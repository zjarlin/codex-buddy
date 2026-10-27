import { describe, expect, it } from "vitest";

import {
  THREAD_REMINDERS_LIMIT,
  THREAD_REMINDERS_STORAGE_KEY,
  ThreadRemindersModel,
  reminderDueAt,
  reminderScheduleLabel,
  sortThreadReminders,
  type ThreadReminderStore,
} from "../src/thread-reminders-state.js";

function memoryStorage(initial?: string): ThreadReminderStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) {
      return key === THREAD_REMINDERS_STORAGE_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === THREAD_REMINDERS_STORAGE_KEY) this.value = value;
    },
  };
}

const HOUR = 60 * 60_000;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

function createModel(start = 1_000_000) {
  const clock = { now: start };
  const storage = memoryStorage();
  const model = new ThreadRemindersModel(storage, () => clock.now);
  return { clock, storage, model };
}

function saveOnce(model: ThreadRemindersModel, at: number, message = "clouddev 迁 macmini 做了嘛") {
  return model.save({
    hostId: "local",
    threadId: "thread-a",
    title: "Task A",
    project: "Project",
    message,
    schedule: { kind: "once", at },
  });
}

describe("thread reminder state", () => {
  it("persists reminders and restores them for the same thread", () => {
    const { model, storage } = createModel();
    const saved = saveOnce(model, 1_000_000 + HOUR);
    expect(saved?.id).toBeTruthy();
    const restored = new ThreadRemindersModel(storage);
    expect(restored.forThread("local", "thread-a")).toHaveLength(1);
    expect(restored.forThread("local", "thread-a")[0]).toMatchObject({
      title: "Task A",
      project: "Project",
      message: "clouddev 迁 macmini 做了嘛",
      enabled: true,
    });
  });

  it("keeps several reminders on the same thread instead of folding them", () => {
    const { model } = createModel();
    required(saveOnce(model, 1_000_000 + HOUR, "第一条"));
    required(saveOnce(model, 1_000_000 + 2 * HOUR, "第二条"));
    expect(model.forThread("local", "thread-a")).toHaveLength(2);
  });

  it("reports a one-time reminder as due at its moment and stops it after firing", () => {
    const { model, clock } = createModel();
    const at = 1_000_000 + HOUR;
    const saved = required(saveOnce(model, at));
    expect(model.due()).toHaveLength(0);
    clock.now = at;
    expect(model.due().map((entry) => entry.id)).toEqual([saved.id]);
    model.markFired(saved.id);
    expect(model.due()).toHaveLength(0);
    expect(model.get(saved.id)).toMatchObject({ enabled: false, firedAt: at });
  });

  it("advances a repeating reminder once even after several missed periods", () => {
    const { model, clock } = createModel();
    const start = 1_000_000;
    const saved = required(
      model.save({
        hostId: "local",
        threadId: "thread-a",
        title: "Task A",
        message: "每日复查",
        schedule: { kind: "interval", everyMs: HOUR, nextAt: start + HOUR },
      }),
    );
    // 应用离线了三个周期：补弹一次后直接推进到下一个未来周期。
    clock.now = start + 3.5 * HOUR;
    expect(model.due()).toHaveLength(1);
    const fired = required(model.markFired(saved.id));
    expect(fired.enabled).toBe(true);
    expect(reminderDueAt(fired.schedule)).toBe(start + 4 * HOUR);
    expect(model.due()).toHaveLength(0);
  });

  it("snoozes the visible reminder without changing the repeating interval", () => {
    const { model, clock } = createModel();
    const start = 1_000_000;
    const saved = required(
      model.save({
        hostId: "local",
        threadId: "thread-a",
        title: "Task A",
        message: "每小时看一次",
        schedule: { kind: "interval", everyMs: HOUR, nextAt: start + HOUR },
      }),
    );
    clock.now = start + HOUR;
    const snoozed = required(model.snooze(saved.id, 10 * 60_000));
    expect(snoozed.enabled).toBe(true);
    expect(reminderDueAt(snoozed.schedule)).toBe(start + HOUR + 10 * 60_000);
    expect(snoozed.schedule).toMatchObject({ everyMs: HOUR });
    expect(model.due()).toHaveLength(0);
  });

  it("pushes an expired one-time reminder forward when it is re-enabled", () => {
    const { model, clock } = createModel();
    const at = 1_000_000 + HOUR;
    const saved = required(saveOnce(model, at));
    clock.now = at;
    model.markFired(saved.id);
    clock.now = at + 5 * HOUR;
    model.setEnabled(saved.id, true);
    const entry = required(model.get(saved.id));
    expect(entry.enabled).toBe(true);
    expect(reminderDueAt(entry.schedule)).toBeGreaterThan(clock.now);
    expect(model.due()).toHaveLength(0);
  });

  it("drops removed reminders and reloads changes made by another window", () => {
    const { model, storage } = createModel();
    const first = required(saveOnce(model, 1_000_000 + HOUR, "保留"));
    const second = required(saveOnce(model, 1_000_000 + 2 * HOUR, "删除"));
    expect(model.remove(second.id)).toBe(true);
    expect(model.remove(second.id)).toBe(false);
    expect(model.list().map((entry) => entry.id)).toEqual([first.id]);

    const other = new ThreadRemindersModel(storage);
    other.remove(first.id);
    expect(model.reload()).toBe(true);
    expect(model.list()).toHaveLength(0);
    expect(model.reload()).toBe(false);
  });

  it("ignores corrupt or foreign storage instead of throwing", () => {
    expect(new ThreadRemindersModel(memoryStorage("{oops")).list()).toEqual([]);
    expect(
      new ThreadRemindersModel(memoryStorage(JSON.stringify({ version: 2, entries: [] }))).list(),
    ).toEqual([]);
    const partial = new ThreadRemindersModel(
      memoryStorage(
        JSON.stringify({
          version: 1,
          entries: [
            {
              id: "a",
              hostId: "local",
              threadId: "t",
              message: "ok",
              schedule: { kind: "once", at: 5 },
            },
            {
              id: "",
              hostId: "local",
              threadId: "t",
              message: "bad id",
              schedule: { kind: "once", at: 5 },
            },
            {
              id: "c",
              hostId: "local",
              threadId: "t",
              message: "  ",
              schedule: { kind: "once", at: 5 },
            },
            {
              id: "d",
              hostId: "local",
              threadId: "t",
              message: "too short interval",
              schedule: { kind: "interval", everyMs: 1_000, nextAt: 5 },
            },
          ],
        }),
      ),
    );
    expect(partial.list().map((entry) => entry.id)).toEqual(["a"]);
  });

  it("keeps the newest reminders inside the storage limit", () => {
    const { model } = createModel();
    for (let index = 0; index < THREAD_REMINDERS_LIMIT + 5; index += 1) {
      required(saveOnce(model, 1_000_000 + index * 60_000, `第 ${index} 条`));
    }
    expect(model.list()).toHaveLength(THREAD_REMINDERS_LIMIT);
    const sorted = sortThreadReminders(model.list());
    expect(required(sorted[0]).message).toBe("第 0 条");
  });

  it("labels repeating schedules by their interval and next run", () => {
    const now = 1_000_000;
    expect(reminderScheduleLabel({ kind: "once", at: now }, "zh-CN", now)).toBe("一次性");
    expect(
      reminderScheduleLabel(
        { kind: "interval", everyMs: 30 * 60_000, nextAt: now + HOUR },
        "zh-CN",
        now,
      ),
    ).toContain("每 30 分钟");
    expect(
      reminderScheduleLabel(
        { kind: "interval", everyMs: 24 * HOUR, nextAt: now + HOUR },
        "en",
        now,
      ),
    ).toContain("Every 1 d");
  });
});
