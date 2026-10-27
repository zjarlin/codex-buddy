import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import type { RendererModelClient, RendererThreadTurnState } from "../renderer-model-client.js";
import { assertNativeCodexThread, isMissingNativeThreadError } from "../renderer-native-thread.js";

export const INTERRUPTED_QUEUE_STORAGE_KEY = "codexhost.interrupted-queue.v1";

/** 会话在 Host 上已不存在（被删除或 rollout 丢失），既不能恢复也不能归档。 */
export class InterruptedEntryGoneError extends Error {
  readonly threadId: string;

  constructor(threadId: string) {
    super("会话已不存在，已移出中断队列。");
    this.name = "InterruptedEntryGoneError";
    this.threadId = threadId;
  }
}
type Status = BuddyInterrupted["threads"][number]["status"];
export interface InterruptedQueueEntry {
  hostId: string;
  threadId: string;
  turnId: string;
  title: string;
  status: Status;
}
type SettledStatus = "active" | "completed" | "archived" | "vanished";
interface QueueRecord extends Omit<InterruptedQueueEntry, "status"> {
  status: Status | SettledStatus;
  updatedAt: number;
  previousTurnIds?: string[];
}
interface NotificationManager {
  addNotificationCallback(
    methods: string | readonly string[],
    listener: (event: unknown) => void,
  ): () => void;
}
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const keyFor = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const interrupted = (status: unknown): status is Status =>
  status === "failed" || status === "interrupted" || status === "cancelled";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// 队列只消费通知。历史扫描仅由用户主动补录触发，启动与连接重绑都不读取历史。
export function createInterruptedQueue(options: {
  getHostIds(): string[];
  getManager(hostId: string): Partial<NotificationManager> | null;
  getClient(hostId: string): RendererModelClient | null;
  storage?: Storage;
}) {
  const entries = new Map<string, QueueRecord>();
  const listeners = new Set<() => void>();
  const bindings = new Map<string, { manager: NotificationManager; stop(): void }>();
  const excluded = new Set<string>();
  const pending = new Set<string>();
  const errors = new Map<string, string>();
  const subscriptionErrors = new Map<string, string>();
  let storageError = "";
  let disposed = false;
  const emit = () => {
    for (const listener of listeners) listener();
  };

  function readStorage(): void {
    try {
      const saved: unknown = JSON.parse(
        options.storage?.getItem(INTERRUPTED_QUEUE_STORAGE_KEY) ?? "[]",
      );
      if (!Array.isArray(saved)) throw new Error("Invalid interrupted queue data");
      for (const value of saved) {
        const entry = record(value);
        if (
          !text(entry.hostId) ||
          !text(entry.threadId) ||
          !text(entry.turnId) ||
          typeof entry.title !== "string" ||
          typeof entry.updatedAt !== "number" ||
          !Number.isFinite(entry.updatedAt) ||
          !(
            interrupted(entry.status) ||
            ["active", "completed", "archived", "vanished"].includes(text(entry.status))
          )
        )
          continue;
        const key = keyFor(entry.hostId as string, entry.threadId as string);
        if ((entries.get(key)?.updatedAt ?? -1) < entry.updatedAt)
          entries.set(key, {
            ...entry,
            previousTurnIds: Array.isArray(entry.previousTurnIds)
              ? entry.previousTurnIds
                  .filter((id): id is string => typeof id === "string")
                  .slice(-64)
              : [],
          } as unknown as QueueRecord);
      }
    } catch (failure) {
      storageError = `中断队列读取失败：${message(failure)}`;
    }
  }
  readStorage();

  function put(entry: Omit<QueueRecord, "updatedAt">): QueueRecord {
    readStorage();
    const key = keyFor(entry.hostId, entry.threadId);
    const previous = entries.get(key);
    const previousTurnIds = new Set(previous?.previousTurnIds ?? []);
    if (previous && previous.turnId !== entry.turnId) previousTurnIds.add(previous.turnId);
    const next = {
      ...entry,
      previousTurnIds: [...previousTurnIds].slice(-64),
      updatedAt: Math.max(Date.now(), (entries.get(key)?.updatedAt ?? 0) + 1),
    };
    entries.set(key, next);
    // 已处理回合保留有限的墓碑，防止迟到通知和其他窗口的旧状态重新入队。
    const settled = [...entries.entries()]
      .filter(([, value]) => !interrupted(value.status))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    for (const [oldKey] of settled.slice(1000)) entries.delete(oldKey);
    try {
      options.storage?.setItem(
        INTERRUPTED_QUEUE_STORAGE_KEY,
        JSON.stringify([...entries.values()]),
      );
      storageError = options.storage ? "" : "中断队列无法持久保存，请检查本机存储权限。";
    } catch (failure) {
      storageError = `中断队列保存失败：${message(failure)}`;
    }
    emit();
    return next;
  }
  const same = (entry: InterruptedQueueEntry | QueueRecord) => {
    readStorage();
    const current = entries.get(keyFor(entry.hostId, entry.threadId));
    return current?.turnId === entry.turnId && interrupted(current.status);
  };
  const remove = (entry: InterruptedQueueEntry | QueueRecord, status: SettledStatus) => {
    if (same(entry)) put({ ...entry, status });
  };
  // 会话已被删除或 rollout 丢失时无法再恢复或归档；保留墓碑，避免迟到通知重新入队。
  // 用户主动操作时由面板展示清理结果，后台核对时在这里留下原因。
  function vanished(
    entry: InterruptedQueueEntry | QueueRecord,
    report = false,
  ): InterruptedEntryGoneError {
    remove(entry, "vanished");
    if (report) errors.set(entry.hostId, `会话已不存在，已移出中断队列：${entry.title}`);
    emit();
    return new InterruptedEntryGoneError(entry.title || entry.threadId);
  }
  // 恢复与归档都不能无限等待：连接卡住时让用户看到失败并可重试。
  async function bounded<T>(operation: Promise<T>, timeoutMs: number, timeout: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeout)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const readMetadata = <T>(operation: Promise<T>) =>
    bounded(operation, 20_000, "会话读取超时，请检查连接后重试。");

  async function enrich(entry: QueueRecord, manager: NotificationManager): Promise<void> {
    const client = options.getClient(entry.hostId);
    if (!client?.requestThreadProjection) return;
    const key = keyFor(entry.hostId, entry.threadId);
    try {
      const value = record(
        await readMetadata(
          client.requestThreadProjection("thread/read", {
            threadId: entry.threadId,
            includeTurns: false,
          }),
        ),
      );
      readStorage();
      if (
        disposed ||
        bindings.get(entry.hostId)?.manager !== manager ||
        options.getManager(entry.hostId) !== manager ||
        options.getClient(entry.hostId) !== client ||
        entries.get(key) !== entry
      )
        return;
      const thread = record(value.thread);
      if (
        thread.ephemeral === true ||
        thread.threadSource === "thread_title" ||
        thread.modelProvider === "codexhost" ||
        thread.cliVersion === "codexhost"
      ) {
        excluded.add(key);
        put({ ...entry, status: "completed" });
        return;
      }
      assertNativeCodexThread(thread, entry.threadId);
      errors.delete(entry.hostId);
      put({
        ...entry,
        title: (text(thread.name) || text(thread.preview) || entry.title).slice(0, 160),
      });
    } catch (failure) {
      if (
        !disposed &&
        entries.get(key) === entry &&
        bindings.get(entry.hostId)?.manager === manager &&
        options.getManager(entry.hostId) === manager &&
        options.getClient(entry.hostId) === client
      ) {
        // 只有确定不存在才移出队列；超时、断连等读取失败仍保留供重试。
        if (isMissingNativeThreadError(failure)) vanished(entry, true);
        else {
          errors.set(entry.hostId, `会话信息暂不可读：${message(failure)}`);
          emit();
        }
      }
    }
  }

  function receive(hostId: string, manager: NotificationManager, notification: unknown): void {
    if (
      disposed ||
      bindings.get(hostId)?.manager !== manager ||
      options.getManager(hostId) !== manager
    )
      return;
    const event = record(notification);
    const params = record(event.params);
    const thread = record(params.thread);
    const threadId = text(params.threadId) || text(thread.id);
    if (!threadId) return;
    const key = keyFor(hostId, threadId);
    readStorage();
    const previous = entries.get(key);
    if (event.method === "thread/started") {
      if (
        thread.ephemeral === true ||
        thread.threadSource === "thread_title" ||
        thread.modelProvider === "codexhost" ||
        thread.cliVersion === "codexhost"
      ) {
        excluded.add(key);
        if (previous) put({ ...previous, status: "completed" });
      }
      return;
    }
    if (event.method === "thread/archived") {
      put({
        hostId,
        threadId,
        turnId: previous?.turnId ?? "archived",
        title: previous?.title ?? threadId,
        status: "archived",
      });
      return;
    }
    if (excluded.has(key)) return;
    const turn = record(params.turn);
    const turnId = text(turn.id);
    if (!turnId || previous?.previousTurnIds?.includes(turnId)) return;
    const base = { hostId, threadId, turnId, title: previous?.title || threadId };
    if (event.method === "turn/started") {
      if (previous?.turnId === turnId) return;
      put({ ...base, status: "active" });
    } else if (event.method === "turn/completed") {
      // 新回合开始后的旧终态，以及已经处理的同回合通知，都不能重新入队。
      if (
        previous?.status === "archived" ||
        (previous?.status === "active" && previous.turnId !== turnId) ||
        (previous?.turnId === turnId && previous.status !== "active")
      )
        return;
      if (!interrupted(turn.status) && turn.status !== "completed" && turn.status !== "succeeded")
        return;
      const next = put({ ...base, status: interrupted(turn.status) ? turn.status : "completed" });
      if (interrupted(next.status)) void enrich(next, manager);
    }
  }

  function refresh(): void {
    if (disposed) return;
    const hostIds = new Set(options.getHostIds());
    for (const [hostId, binding] of bindings) {
      if (!hostIds.has(hostId) || options.getManager(hostId) !== binding.manager) {
        binding.stop();
        bindings.delete(hostId);
      }
    }
    for (const hostId of hostIds) {
      const manager = options.getManager(hostId);
      if (bindings.has(hostId) || !manager?.addNotificationCallback) continue;
      const typed = manager as NotificationManager;
      const binding = { manager: typed, stop: () => {} };
      bindings.set(hostId, binding);
      try {
        binding.stop = typed.addNotificationCallback(
          ["thread/started", "turn/started", "turn/completed", "thread/archived"],
          (event) => receive(hostId, typed, event),
        );
        if (subscriptionErrors.delete(hostId)) emit();
      } catch (failure) {
        bindings.delete(hostId);
        subscriptionErrors.set(hostId, `中断事件订阅失败：${message(failure)}`);
        emit();
      }
    }
  }

  async function act(
    entry: InterruptedQueueEntry,
    action: "resume" | "archive",
    model?: string,
  ): Promise<void> {
    const key = keyFor(entry.hostId, entry.threadId);
    if (!same(entry)) throw new Error("队列中的会话状态已改变。");
    if (pending.has(key)) throw new Error("该会话正在处理中，请勿重复操作。");
    const client = options.getClient(entry.hostId);
    if (
      !client?.requestThreadProjection ||
      !client.readThreadTurnState ||
      (action === "resume" && !client.buddyContinue)
    ) {
      throw new Error("当前连接无法处理该会话。");
    }
    const ensureCurrent = () => {
      if (disposed || options.getClient(entry.hostId) !== client || !same(entry))
        throw new Error("连接或会话状态已改变。");
    };
    // 用户重新发起操作时，之前那次读取或清理的提示不再有意义。
    errors.delete(entry.hostId);
    pending.add(key);
    emit();
    try {
      let value: Record<string, unknown>;
      let state: RendererThreadTurnState;
      try {
        value = record(
          await readMetadata(
            client.requestThreadProjection("thread/read", {
              threadId: entry.threadId,
              includeTurns: false,
            }),
          ),
        );
        ensureCurrent();
        assertNativeCodexThread(value.thread, entry.threadId);
        state = await readMetadata(client.readThreadTurnState(entry.threadId));
      } catch (failure) {
        if (isMissingNativeThreadError(failure)) throw vanished(entry);
        throw failure;
      }
      ensureCurrent();
      if (state.running || state.turnId !== entry.turnId || !interrupted(state.status)) {
        remove(entry, "completed");
        throw new Error("会话已运行或最新回合已改变，已移出中断队列。");
      }
      // 提交步骤超时只代表结果未知：保留条目，由用户查看会话后决定是否重试。
      const submit = (operation: Promise<void>) =>
        bounded(operation, 60_000, "提交结果未知，请先查看该会话状态后再重试。");
      if (action === "archive") {
        await submit(
          Promise.resolve(
            client.requestThreadProjection("thread/archive", { threadId: entry.threadId }),
          ).then(() => undefined),
        );
      } else {
        await submit(
          model
            ? (client.buddyContinue?.(entry.threadId, entry.turnId, model) ?? Promise.resolve())
            : (client.buddyContinue?.(entry.threadId, entry.turnId) ?? Promise.resolve()),
        );
      }
      if (!disposed && options.getClient(entry.hostId) === client)
        remove(entry, action === "archive" ? "archived" : "completed");
    } finally {
      pending.delete(key);
      emit();
    }
  }

  return {
    refresh,
    list(hostId: string): InterruptedQueueEntry[] {
      return [...entries.values()]
        .filter(
          (entry): entry is QueueRecord & { status: Status } =>
            entry.hostId === hostId && interrupted(entry.status),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    problem: (hostId: string) =>
      storageError || subscriptionErrors.get(hostId) || errors.get(hostId) || "",
    isPending: (entry: InterruptedQueueEntry) => pending.has(keyFor(entry.hostId, entry.threadId)),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncStorage() {
      readStorage();
      emit();
    },
    resume: (entry: InterruptedQueueEntry, model?: string) => act(entry, "resume", model),
    archive: (entry: InterruptedQueueEntry) => act(entry, "archive"),
    async importHistory(hostId: string): Promise<number> {
      const client = options.getClient(hostId);
      if (!client?.buddyInterrupted) throw new Error("当前连接无法补录历史中断。");
      readStorage();
      const before = new Map(entries);
      const result = await client.buddyInterrupted();
      if (disposed || options.getClient(hostId) !== client) return 0;
      readStorage();
      const running = new Set(result.runningThreadIds);
      for (const entry of result.threads) {
        const key = keyFor(hostId, entry.threadId);
        if (
          entry.owner !== "codex" ||
          running.has(entry.threadId) ||
          excluded.has(key) ||
          entries.get(key) !== before.get(key)
        )
          continue;
        const previous = entries.get(key);
        if (
          previous?.status === "archived" ||
          previous?.status === "vanished" ||
          previous?.previousTurnIds?.includes(entry.turnId) ||
          (previous?.turnId === entry.turnId && previous.status === "completed")
        )
          continue;
        put({ ...entry, hostId });
      }
      return result.unreadable;
    },
    dispose() {
      disposed = true;
      for (const binding of bindings.values()) binding.stop();
      bindings.clear();
      listeners.clear();
    },
  };
}
export type InterruptedQueue = ReturnType<typeof createInterruptedQueue>;
