import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import type { RendererModelClient, RendererThreadTurnState } from "../renderer-model-client.js";
import { assertNativeCodexThread, isMissingNativeThreadError } from "../renderer-native-thread.js";

export const INTERRUPTED_QUEUE_STORAGE_KEY = "codexhost.interrupted-queue.v1";
export const AUTO_RESUME_MAX_ATTEMPTS = 3;
/** 后台发现全量中断的最短间隔；手动补录不受此限制。 */
export const INTERRUPTED_DISCOVERY_INTERVAL_MS = 120_000;
const DISCOVERY_RETRY_MS = 30_000;
// 发现轮询与限流间隔不是整数倍关系，定时器也可能比整点早几毫秒触发；
// 留一点容差，免得多轮扫描都卡在“还差几毫秒”上被整轮丢弃。
const DISCOVERY_CLOCK_TOLERANCE_MS = 5_000;
/** 打开会话时的核对间隔：迟到的终态通知要尽快补上。 */
export const INTERRUPTED_RECONCILE_INTERVAL_MS = 30_000;
/** 侧栏后台核对间隔：没有打开会话时也要发现停下且可继续的会话。 */
export const INTERRUPTED_BACKGROUND_RECONCILE_INTERVAL_MS = 180_000;

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
  /** 自动续接已提交的次数；手动恢复不增加。达到上限后只保留手动入口。 */
  autoResumeAttempts?: number;
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

// 队列消费通知，并由可见窗口低频全量发现补上漏掉终态通知的会话；
// 打开会话时另有单会话核对。启动和连接重绑本身不扫描历史。
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
            autoResumeAttempts:
              typeof entry.autoResumeAttempts === "number" &&
              Number.isFinite(entry.autoResumeAttempts) &&
              entry.autoResumeAttempts >= 0
                ? Math.floor(entry.autoResumeAttempts)
                : undefined,
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

  // 核对单个会话，补偿客户端闪退或重连期间错过的终态通知。调用方只传入界面上
  // 已经渲染的原生会话，从不遍历 thread/list 历史；打开会话用较短间隔，
  // 侧栏后台轮询用较长间隔，避免对每个可见行反复读取。
  const reconciling = new Set<string>();
  // 每个会话最近一次核对的时间；间隔由调用方按界面信号选择。
  const reconciledAt = new Map<string, number>();
  // 后台发现按 Host 限流：一次全量核对会读取多个会话并可能调用 Laya，
  // 不能因为窗口重绘或存储事件被反复触发。
  const discovering = new Set<string>();
  const discoveredAt = new Map<string, number>();
  const RECONCILE_RETRY_MS = 10_000;

  async function reconcile(
    hostId: string,
    threadId: string,
    optionsForCall: { intervalMs?: number } = {},
  ): Promise<void> {
    if (disposed) return;
    const key = keyFor(hostId, threadId);
    const client = options.getClient(hostId);
    if (!client?.requestThreadProjection || !client.readThreadTurnState) return;
    if (excluded.has(key) || reconciling.has(key)) return;
    const intervalMs = optionsForCall.intervalMs ?? INTERRUPTED_RECONCILE_INTERVAL_MS;
    const checkedAt = reconciledAt.get(key);
    const now = Date.now();
    if (checkedAt !== undefined && now - checkedAt < intervalMs) return;
    // 高频界面扫描只做内存限流；到点后才解析持久化队列。
    readStorage();
    reconciledAt.set(key, now);
    reconciling.add(key);
    try {
      // 先读最新回合：健康会话只产生这一次读取，只有确实需要补录时才读取标题和归属。
      const state = await readMetadata(client.readThreadTurnState(threadId));
      if (disposed || options.getClient(hostId) !== client) return;
      readStorage();
      const previous = entries.get(key);
      // 记录过的中断已经继续运行：漏掉 turn/started 时，打开会话按原生状态清掉旧记录。
      if (state.running) {
        if (previous && interrupted(previous.status)) remove(previous, "completed");
        return;
      }
      if (!state.turnId) return;
      // 同一回合已有记录：原生 completed 不代表已经交付，保留原有的中断判断。
      if (previous && interrupted(previous.status) && previous.turnId === state.turnId) return;
      // 会话已经进入新回合，旧回合的中断记录不再可恢复。
      const stale = previous && interrupted(previous.status) ? previous : null;
      const dropStale = () => {
        if (stale) remove(stale, "completed");
      };
      let status = interrupted(state.status) ? state.status : null;
      if (!status) {
        // 官方把“以命令或错误收尾、没有 Assistant 交付”的回合标为 completed，界面却仍显示可继续；
        // 这类回合交给 Host 的单会话扫描用 Laya 复核，确认中断后才补入队列。
        if (
          (state.turnStatus !== "completed" && state.turnStatus !== "succeeded") ||
          !client.buddyInterrupted
        ) {
          dropStale();
          return;
        }
        const scan = await client.buddyInterrupted(threadId);
        if (disposed || options.getClient(hostId) !== client) return;
        status = scan.runningThreadIds.includes(threadId)
          ? null
          : (scan.threads.find(
              (entry) => entry.threadId === threadId && entry.turnId === state.turnId,
            )?.status ?? null);
        if (!status) {
          dropStale();
          return;
        }
      }
      const value = record(
        await readMetadata(
          client.requestThreadProjection("thread/read", {
            threadId,
            includeTurns: false,
          }),
        ),
      );
      if (disposed || options.getClient(hostId) !== client) return;
      const thread = record(value.thread);
      // 读取标题期间会话可能已经开始新回合：原生状态已经变化时不再补入旧回合。
      if (record(thread.status).type === "active") {
        dropStale();
        return;
      }
      const latest =
        Array.isArray(thread.turns) && thread.turns.length > 0 ? record(thread.turns.at(-1)) : null;
      if (latest && typeof latest.id === "string" && latest.id !== state.turnId) {
        dropStale();
        return;
      }
      if (
        thread.ephemeral === true ||
        thread.threadSource === "thread_title" ||
        thread.modelProvider === "codexhost" ||
        thread.cliVersion === "codexhost"
      ) {
        excluded.add(key);
        dropStale();
        return;
      }
      assertNativeCodexThread(thread, threadId);
      readStorage();
      const current = entries.get(key);
      if (
        current?.status === "archived" ||
        current?.status === "vanished" ||
        current?.previousTurnIds?.includes(state.turnId) ||
        (current?.turnId === state.turnId && current.status !== "active") ||
        (current?.status === "active" && current.turnId !== state.turnId)
      )
        return;
      put({
        hostId,
        threadId,
        turnId: state.turnId,
        title: (text(thread.name) || text(thread.preview) || threadId).slice(0, 160),
        status,
      });
    } catch {
      // 浏览会话时的读取失败不写入队列；连接或会话稍后可用时再重试。
      reconciledAt.set(key, Date.now() - intervalMs + RECONCILE_RETRY_MS);
    } finally {
      reconciling.delete(key);
    }
  }

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

  // 全量发现只用来补“事件和界面都看不到”的会话：跳过运行中、外部 Harness、
  // 已处理回合和本轮扫描期间被其他窗口改过的记录，不覆盖更新的事件状态。
  async function importInterrupted(hostId: string, client: RendererModelClient): Promise<number> {
    const scan = client.buddyInterrupted;
    if (!scan) throw new Error("当前连接无法补录历史中断。");
    readStorage();
    const before = new Map(entries);
    const result = await scan.call(client);
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
  }

  async function act(
    entry: InterruptedQueueEntry,
    action: "resume" | "archive",
    model?: string,
    source: "manual" | "auto" = "manual",
  ): Promise<void> {
    const key = keyFor(entry.hostId, entry.threadId);
    if (!same(entry)) throw new Error("队列中的会话状态已改变。");
    if (source === "auto" && action === "resume") {
      readStorage();
      const current = entries.get(key);
      if (!current || current.turnId !== entry.turnId || !interrupted(current.status))
        throw new Error("队列中的会话状态已改变。");
      if ((current.autoResumeAttempts ?? 0) >= AUTO_RESUME_MAX_ATTEMPTS)
        throw new Error("自动续接次数已达上限，请手动恢复。");
    }
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
      // Laya 补录的条目在原生状态下可能仍是 completed（结尾没有 Assistant 交付）；
      // 是否真的完成由 Host 续接时再次核对，这里只排除识别不到状态或已换回合的条目。
      const settled =
        (state.turnStatus === undefined && state.status === null) ||
        (state.status !== null && !interrupted(state.status));
      if (state.running || state.turnId !== entry.turnId || settled) {
        remove(entry, "completed");
        throw new Error("会话已运行或最新回合已改变，已移出中断队列。");
      }
      if (source === "auto" && action === "resume") {
        readStorage();
        const current = entries.get(key);
        if (!current || current.turnId !== entry.turnId || !interrupted(current.status))
          throw new Error("队列中的会话状态已改变。");
        put({ ...current, autoResumeAttempts: (current.autoResumeAttempts ?? 0) + 1 });
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
    reconcile,
    hosts(): string[] {
      return [...new Set(options.getHostIds())];
    },
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
    resume: (entry: InterruptedQueueEntry, model?: string, options?: { auto?: boolean }) =>
      act(entry, "resume", model, options?.auto ? "auto" : "manual"),
    archive: (entry: InterruptedQueueEntry) => act(entry, "archive"),
    async importHistory(hostId: string): Promise<number> {
      const client = options.getClient(hostId);
      if (!client?.buddyInterrupted) throw new Error("当前连接无法补录历史中断。");
      return importInterrupted(hostId, client);
    },
    /**
     * 后台发现：与手动补录共享同一套幂等规则，但按 Host 限流且吞掉失败。
     * 未渲染、未打开、也没收到终态通知的会话只能靠这条路径补进队列。
     */
    async discover(hostId: string): Promise<void> {
      const client = options.getClient(hostId);
      if (!client?.buddyInterrupted || discovering.has(hostId)) return;
      const checkedAt = discoveredAt.get(hostId);
      const now = Date.now();
      if (
        checkedAt !== undefined &&
        now - checkedAt < INTERRUPTED_DISCOVERY_INTERVAL_MS - DISCOVERY_CLOCK_TOLERANCE_MS
      )
        return;
      discovering.add(hostId);
      discoveredAt.set(hostId, now);
      try {
        await importInterrupted(hostId, client);
      } catch {
        // 后台发现失败不打扰用户，也不能一直等到下个完整周期才重试。
        discoveredAt.set(
          hostId,
          Date.now() - INTERRUPTED_DISCOVERY_INTERVAL_MS + DISCOVERY_RETRY_MS,
        );
      } finally {
        discovering.delete(hostId);
      }
    },
    dispose() {
      disposed = true;
      discovering.clear();
      for (const binding of bindings.values()) binding.stop();
      bindings.clear();
      listeners.clear();
    },
  };
}
export type InterruptedQueue = ReturnType<typeof createInterruptedQueue>;
