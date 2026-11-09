import {
  nativeContinuationPrompt,
  type BuddyInterrupted,
  type ThreadArchiveCompletedResult,
} from "@codexhost/shared-contracts";
import type { JsonObject } from "@codexhost/protocol-core";
import { object, result, type NativeRequest } from "./native.js";

const THREAD_LIST_PAGE_SIZE = 100;
const MAX_THREAD_LIST_PAGES = 20;
const MAX_THREADS = 2_000;
const READ_CONCURRENCY = 4;
// Laya 只分析最近活跃的会话，避免把长期历史全部送到网关。
const RECENT_ACTIVITY_SECONDS = 3 * 24 * 60 * 60;
const MAX_CLASSIFICATIONS = 64;
const VERDICT_TTL_MS = 30 * 60_000;
const FAILED_VERDICT_TTL_MS = 60_000;

const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "functionCall",
]);
const TERMINAL_ITEM_STATUSES = new Set([
  "completed",
  "succeeded",
  "failed",
  "declined",
  "cancelled",
  "interrupted",
]);

type RecoverableStatus = BuddyInterrupted["threads"][number]["status"];

/** 交给 Laya 的结尾证据；只包含最后一个回合的片段。 */
export interface InterruptedTurnClassifierInput {
  threadId: string;
  turnId: string;
  title: string;
  turnStatus: string;
  userText: string;
  assistantText: string;
  lastItemType: string | null;
  lastItemStatus: string | null;
  /** 最后一条 Assistant 文本之后的尾项摘要，帮助判断命令/错误之后是否还有解释。 */
  tailItems: string[];
  pendingTool: boolean;
  errorText: string;
}

export type InterruptedTurnClassifier = (
  input: InterruptedTurnClassifierInput,
) => Promise<boolean | null>;

interface ThreadMetadata {
  id: string;
  title: string;
  updatedAt: number | null;
}

function explicitStatus(turn: Record<string, unknown>): RecoverableStatus | null {
  switch (turn.status) {
    case "failed":
    case "interrupted":
    case "cancelled":
      return turn.status;
    default:
      return null;
  }
}

// 官方只在读取时把非 active 会话里残留的 inProgress 回合投影为 interrupted；
// 进程退出后不一定还会发送 turn/completed，因此这里按同一语义兜底。
const STOPPED_THREAD_STATUSES = new Set(["idle", "notLoaded", "systemError"]);

function staleInProgress(thread: Record<string, unknown>, turn: Record<string, unknown>): boolean {
  const state = object(thread.status).type;
  return (
    turn.status === "inProgress" && typeof state === "string" && STOPPED_THREAD_STATUSES.has(state)
  );
}

// 官方侧栏的三角直接来自 threadRuntimeStatus.systemError：线程已经停下，输入区仍可继续。
// 这是 Host 自己给出的终态，和 failed 回合一样确定，不需要再判断 Assistant 结尾。
function systemErrorStatus(thread: Record<string, unknown>): RecoverableStatus | null {
  return object(thread.status).type === "systemError" ? "failed" : null;
}

function recoverableStatus(
  thread: Record<string, unknown>,
  turn: Record<string, unknown>,
): RecoverableStatus | null {
  const explicit = explicitStatus(turn);
  if (explicit !== null) return explicit;
  // 回合没写完时仍是“中断”，系统错误只说明线程停下了。
  if (staleInProgress(thread, turn)) return "interrupted";
  return systemErrorStatus(thread);
}

function threadTitle(thread: Record<string, unknown>, fallback: string): string {
  const name = typeof thread.name === "string" ? thread.name : "";
  const preview = typeof thread.preview === "string" ? thread.preview : "";
  return (name || preview || fallback).slice(0, 160);
}

function tailText(items: readonly Record<string, unknown>[]): string {
  return (
    items
      .filter((item) => item.type === "error")
      .map((item) => (typeof item.message === "string" ? item.message : ""))
      .filter((text) => text.trim().length > 0)
      .at(-1)
      ?.slice(0, 1_000) ?? ""
  );
}

function turnText(turn: Record<string, unknown>) {
  const items = Array.isArray(turn.items) ? turn.items.map(object) : [];
  const assistantText = (
    items
      .filter((item) => item.type === "agentMessage" && typeof item.text === "string")
      .map((item) => item.text as string)
      .filter((text) => text.trim().length > 0)
      .at(-1) ?? ""
  ).slice(-6_000);
  const userText = (
    items
      .filter((item) => item.type === "userMessage")
      .flatMap((item) => (Array.isArray(item.content) ? item.content.map(object) : []))
      .filter((content) => content.type === "text" && typeof content.text === "string")
      .map((content) => content.text as string)
      .at(-1) ?? ""
  ).slice(-2_000);
  const last = items.at(-1);
  const lastItemType = typeof last?.type === "string" ? last.type : null;
  const lastItemStatus = typeof last?.status === "string" ? last.status : null;
  const pendingTool =
    lastItemType !== null &&
    TOOL_ITEM_TYPES.has(lastItemType) &&
    !TERMINAL_ITEM_STATUSES.has(lastItemStatus ?? "");
  const turnError = object(turn.error);
  const errorText =
    (typeof turnError.message === "string" ? turnError.message.slice(0, 1_000) : "") ||
    tailText(items);
  const tailItems = items
    .slice(items.findLastIndex((item) => item.type === "agentMessage") + 1)
    .slice(-6)
    .map(
      (item) => `${String(item.type)}${typeof item.status === "string" ? `:${item.status}` : ""}`,
    );
  return {
    userText,
    assistantText,
    lastItemType,
    lastItemStatus,
    tailItems,
    pendingTool,
    errorText,
  };
}

// 官方 Desktop 只在“回合以 Assistant 文本交付且没有残留错误”时认为是明确完成；
// 其余状态（含 commandExecution 收尾、尾部错误）都会让输入区显示“继续”。
function clearlyCompleted(turn: Record<string, unknown>): boolean {
  if (turn.status !== "completed" && turn.status !== "succeeded") return false;
  const items = Array.isArray(turn.items) ? turn.items.map(object) : [];
  const last = items.at(-1);
  if (last?.type !== "agentMessage" || typeof last.text !== "string" || !last.text.trim()) {
    return false;
  }
  if (object(turn.error).message) return false;
  return !items.some((item) => item.type === "error" && item.willRetry !== true);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await map(values[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => worker()),
  );
  return results;
}

export class InterruptedConversations {
  readonly #pending = new Set<string>();
  readonly #verdicts = new Map<string, { verdict: boolean | null; at: number }>();
  constructor(
    private readonly request: NativeRequest,
    private readonly busy: (id: string) => boolean,
    private readonly allowed: () => Promise<boolean>,
    private readonly classifier?: InterruptedTurnClassifier,
  ) {}

  async #checkAllowed(): Promise<void> {
    if (!(await this.allowed())) throw new Error("隐私模式下不能续接普通会话。");
  }

  // 只读取会话元数据和最新回合：`thread/read includeTurns` 会物化整段历史，
  // 单个大会话可能超过内部请求超时，进而让整轮扫描失败。分页接口按需返回单个
  // 回合，默认不加载 items；只有需要 Laya 判断结尾时才读取 full items。
  async #read(threadId: string, options: { items?: boolean } = {}) {
    const metadata = result(await this.request("thread/read", { threadId, includeTurns: false }));
    const thread = object(metadata.thread);
    const embedded = Array.isArray(thread.turns) ? thread.turns : [];
    const embeddedTurn = embedded.length > 0 ? object(embedded.at(-1)) : null;
    if (
      embeddedTurn &&
      (!options.items || (Array.isArray(embeddedTurn.items) && embeddedTurn.items.length > 0))
    ) {
      return { thread, turn: embeddedTurn };
    }
    const response = await this.request("thread/turns/list", {
      threadId,
      limit: 1,
      sortDirection: "desc",
      itemsView: options.items ? "full" : "notLoaded",
    });
    const error = object(response.error);
    const unsupported =
      error.code === -32601 ||
      error.message === "thread/turns/list is not supported yet" ||
      (error.code === -32600 &&
        typeof error.message === "string" &&
        error.message.includes("unknown variant `thread/turns/list`"));
    if (unsupported) {
      const legacy = result(await this.request("thread/read", { threadId, includeTurns: true }));
      const legacyThread = object(legacy.thread);
      const turns = Array.isArray(legacyThread.turns) ? legacyThread.turns : [];
      return { thread: legacyThread, turn: object(turns.at(-1)) };
    }
    const history = result(response);
    const turns = Array.isArray(history.data) ? history.data : [];
    return { thread, turn: object(turns[0]) };
  }

  async #listThreads(options: { cwd?: string } = {}): Promise<ThreadMetadata[]> {
    const threads: ThreadMetadata[] = [];
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < MAX_THREAD_LIST_PAGES; pageIndex += 1) {
      const page = result(
        await this.request("thread/list", {
          limit: THREAD_LIST_PAGE_SIZE,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived: false,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(cursor ? { cursor } : {}),
        }),
      );
      const data = Array.isArray(page.data) ? page.data : [];
      for (const entry of data) {
        const metadata = object(entry);
        if (typeof metadata.id !== "string") continue;
        const updatedAt =
          typeof metadata.updatedAt === "number" && Number.isFinite(metadata.updatedAt)
            ? metadata.updatedAt
            : null;
        const title =
          typeof metadata.name === "string"
            ? metadata.name
            : typeof metadata.preview === "string"
              ? metadata.preview
              : "";
        threads.push({ id: metadata.id, title, updatedAt });
        if (threads.length > MAX_THREADS) {
          throw new Error("thread/list exceeded the recovery scan item limit");
        }
      }
      if (data.length === 0 || page.nextCursor === null || page.nextCursor === undefined) {
        return threads;
      }
      if (typeof page.nextCursor !== "string") {
        throw new Error("thread/list returned an invalid next cursor");
      }
      if (page.nextCursor === cursor) {
        throw new Error("thread/list returned a repeated cursor");
      }
      cursor = page.nextCursor;
    }
    throw new Error("thread/list exceeded the recovery scan page limit");
  }

  async #classify(
    threadId: string,
    turnId: string,
    thread: Record<string, unknown>,
    turn: Record<string, unknown>,
  ): Promise<{ value: boolean | null; classified: boolean }> {
    if (!this.classifier) return { value: null, classified: false };
    const key = `${threadId}\u0000${turnId}`;
    const cached = this.#verdicts.get(key);
    if (
      cached &&
      Date.now() - cached.at < (cached.verdict === null ? FAILED_VERDICT_TTL_MS : VERDICT_TTL_MS)
    ) {
      return { value: cached.verdict, classified: false };
    }
    let verdict: boolean | null = null;
    try {
      let evidenceTurn = turn;
      const items = Array.isArray(turn.items) ? turn.items : [];
      if (items.length === 0) {
        const full = await this.#read(threadId, { items: true });
        if (object(full.turn).id !== turnId) return { value: null, classified: false };
        evidenceTurn = full.turn;
      }
      verdict = await this.classifier({
        threadId,
        turnId,
        title: threadTitle(thread, threadId),
        turnStatus: typeof turn.status === "string" ? turn.status : "",
        ...turnText(evidenceTurn),
      });
    } catch {
      // 判断失败不能阻断其余会话；调用方回退到官方状态。
      verdict = null;
    }
    this.#verdicts.set(key, { verdict, at: Date.now() });
    if (this.#verdicts.size > 500) {
      const oldest = this.#verdicts.keys().next().value;
      if (oldest !== undefined) this.#verdicts.delete(oldest);
    }
    return { value: verdict, classified: true };
  }

  async archiveCompleted(threadId: string): Promise<ThreadArchiveCompletedResult> {
    await this.#checkAllowed();
    const target = await this.#read(threadId);
    const cwd = typeof target.thread.cwd === "string" ? target.thread.cwd : null;
    if (!cwd) throw new Error("无法确认该项目路径，未归档任何会话。");
    const candidates = (await this.#listThreads({ cwd })).filter(
      (metadata) => metadata.id !== threadId && !this.busy(metadata.id),
    );
    let archived = 0;
    let skipped = 0;
    let failed = 0;
    for (const metadata of candidates) {
      try {
        const { thread, turn } = await this.#read(metadata.id);
        if (typeof thread.cwd !== "string" || thread.cwd !== cwd) {
          skipped += 1;
          continue;
        }
        if (object(thread.status).type === "active" || typeof turn.id !== "string") {
          skipped += 1;
          continue;
        }
        if (turn.status !== "completed" && turn.status !== "succeeded") {
          skipped += 1;
          continue;
        }
      } catch {
        failed += 1;
        continue;
      }
      try {
        result(await this.request("thread/archive", { threadId: metadata.id }));
        archived += 1;
      } catch {
        failed += 1;
      }
    }
    return { archived, skipped, failed };
  }

  async list(options: { threadId?: string } = {}): Promise<BuddyInterrupted> {
    // 打开单个会话时只扫描这一条，供界面核对漏检回合；未指定时按官方分页扫描全部历史。
    const candidates: ThreadMetadata[] = options.threadId
      ? [{ id: options.threadId, title: "", updatedAt: null }]
      : await this.#listThreads();
    const cutoff = Math.floor(Date.now() / 1000) - RECENT_ACTIVITY_SECONDS;
    let classifications = 0;
    const entries = await mapWithConcurrency(candidates, READ_CONCURRENCY, async (metadata) => {
      if (this.busy(metadata.id)) {
        return { kind: "running" as const, threadId: metadata.id };
      }
      try {
        const { thread, turn } = await this.#read(metadata.id);
        if (this.busy(metadata.id) || object(thread.status).type === "active") {
          return { kind: "running" as const, threadId: metadata.id };
        }
        if (typeof turn.id !== "string") return { kind: "done" as const };
        const interrupted = (status: RecoverableStatus) => ({
          kind: "interrupted" as const,
          thread: {
            threadId: metadata.id,
            turnId: turn.id as string,
            title: threadTitle(thread, metadata.title || metadata.id),
            status,
            owner: "codex" as const,
          } satisfies BuddyInterrupted["threads"][number],
        });
        const explicit = explicitStatus(turn);
        if (explicit !== null) return interrupted(explicit);
        const updatedAt =
          metadata.updatedAt ?? (typeof thread.updatedAt === "number" ? thread.updatedAt : null);
        const recent = updatedAt === null || updatedAt >= cutoff;
        const stale = staleInProgress(thread, turn);
        // 系统错误同样是确定的终态，不该再交给 Laya 猜结尾；只补最近活跃的会话，
        // 避免把很早以前的系统错误重新翻出来。回合没写完时仍按中断处理。
        if (recent && !stale && systemErrorStatus(thread) !== null) return interrupted("failed");
        const completedLike = turn.status === "completed" || turn.status === "succeeded";
        if (!this.classifier || !recent || classifications >= MAX_CLASSIFICATIONS) {
          return stale ? interrupted("interrupted") : { kind: "done" as const };
        }
        // 官方按“最新回合是否已经交付 Assistant 文本”决定输入区是否显示继续；
        // completed 但以命令或错误收尾的回合同样需要判断，分页摘要不含 items，必须补读完整回合。
        let evidence = turn;
        if (completedLike) {
          const full = await this.#read(metadata.id, { items: true });
          if (object(full.turn).id !== turn.id) return { kind: "done" as const };
          evidence = full.turn;
          if (clearlyCompleted(evidence)) return { kind: "done" as const };
        }
        const verdict = await this.#classify(metadata.id, turn.id, thread, evidence);
        // 命中缓存的判断不消耗本轮预算，否则每轮都会重新占满同样的名额，
        // 排在后面的会话永远轮不到 Laya，只能等用户点开才被发现。
        if (verdict.classified) classifications += 1;
        if (verdict.value === true) return interrupted("interrupted");
        // Laya 不可用或证据不足时，只保留官方 stale inProgress 兜底。
        return verdict.value === null && stale
          ? interrupted("interrupted")
          : { kind: "done" as const };
      } catch {
        // 单个历史不可读不阻断其他会话，并明确返回遗漏数量。
        return { kind: "unreadable" as const };
      }
    });
    return {
      threads: entries.flatMap((entry) => (entry.kind === "interrupted" ? [entry.thread] : [])),
      runningThreadIds: entries.flatMap((entry) =>
        entry.kind === "running" ? [entry.threadId] : [],
      ),
      unreadable: entries.filter((entry) => entry.kind === "unreadable").length,
    };
  }

  async continue(
    threadId: string,
    turnId: string,
    options?: {
      signal?: AbortSignal;
      model?: string;
      collaborationMode?: JsonObject;
      context?: JsonObject;
    },
  ): Promise<string> {
    if (this.#pending.has(threadId)) throw new Error("该会话正在续接，请勿重复点击。");
    this.#pending.add(threadId);
    try {
      await this.#checkAllowed();
      options?.signal?.throwIfAborted();
      const verify = async () => {
        const { thread, turn } = await this.#read(threadId);
        if (this.busy(threadId) || object(thread.status).type === "active")
          throw new Error("该会话仍在运行。");
        if (turn.id !== turnId) throw new Error("会话状态已改变，请刷新列表。");
        if (recoverableStatus(thread, turn) !== null) return;
        // 官方状态不明确时补读完整尾项：以 Assistant 文本交付且无残留错误的回合才算明确完成。
        const full = await this.#read(threadId, { items: true });
        if (object(full.turn).id !== turnId) throw new Error("会话状态已改变，请刷新列表。");
        if (clearlyCompleted(full.turn)) throw new Error("会话状态已改变，请刷新列表。");
        // Laya 明确判定已交付时同样停止；判断不可用不阻断续接，官方输入区此时本来可写。
        if ((await this.#classify(threadId, turnId, thread, full.turn)).value === false)
          throw new Error("会话状态已改变，请刷新列表。");
      };
      await verify();
      options?.signal?.throwIfAborted();
      // 原生 resume 恢复会话配置，不覆盖模型、权限或工作目录。
      result(await this.request("thread/resume", { threadId }));
      await verify();
      await this.#checkAllowed();
      options?.signal?.throwIfAborted();
      const response = result(
        await this.request("turn/start", {
          ...options?.context,
          threadId,
          input: [{ type: "text", text: nativeContinuationPrompt }],
          ...(options?.model ? { model: options.model, effort: null } : {}),
          ...(options?.collaborationMode ? { collaborationMode: options.collaborationMode } : {}),
        }),
      );
      const accepted = object(response.turn).id;
      if (typeof accepted !== "string")
        throw new Error("续接结果未确认，请检查原会话，勿重复发送。");
      return accepted;
    } finally {
      this.#pending.delete(threadId);
    }
  }
}
