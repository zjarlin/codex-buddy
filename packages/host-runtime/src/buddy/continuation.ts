import type { BuddyInterrupted, ThreadArchiveCompletedResult } from "@codexhost/shared-contracts";
import type { JsonObject } from "@codexhost/protocol-core";
import { object, result, type NativeRequest } from "./planner.js";

const continuation =
  "继续本会话上一次尚未完成的请求。先核对已有回答、工具结果和当前实际状态，从中断处继续；不要盲目重放已完成的命令、修改或外部操作。若上次请求已经完成，简要说明即可。";
const THREAD_LIST_PAGE_SIZE = 100;
const MAX_THREAD_LIST_PAGES = 20;
const MAX_THREADS = 2_000;
const READ_CONCURRENCY = 4;

interface ThreadMetadata {
  id: string;
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
  constructor(
    private readonly request: NativeRequest,
    private readonly busy: (id: string) => boolean,
    private readonly allowed: () => Promise<boolean>,
  ) {}

  async #checkAllowed(): Promise<void> {
    if (!(await this.allowed())) throw new Error("隐私模式下不能续接普通会话。");
  }

  async #read(threadId: string) {
    const response = result(await this.request("thread/read", { threadId, includeTurns: true }));
    const thread = object(response.thread);
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    return { thread, turn: object(turns.at(-1)) };
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
        threads.push({ id: metadata.id });
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

  async list(): Promise<BuddyInterrupted> {
    await this.#checkAllowed();
    const candidates = (await this.#listThreads()).filter((metadata) => !this.busy(metadata.id));
    const entries = await mapWithConcurrency(candidates, READ_CONCURRENCY, async (metadata) => {
      try {
        const { thread, turn } = await this.#read(metadata.id);
        if (object(thread.status).type === "active") {
          return { kind: "running" as const, threadId: metadata.id };
        }
        if (typeof turn.id !== "string") {
          return { kind: "done" as const };
        }
        if (
          turn.status !== "failed" &&
          turn.status !== "interrupted" &&
          turn.status !== "cancelled"
        )
          return { kind: "done" as const };
        return {
          kind: "interrupted" as const,
          thread: {
            threadId: metadata.id,
            turnId: turn.id,
            title: String(thread.name || thread.preview || metadata.id).slice(0, 160),
            status: turn.status,
          } satisfies BuddyInterrupted["threads"][number],
        };
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
      signal: AbortSignal;
      model: string;
      collaborationMode?: JsonObject;
      context?: JsonObject;
    },
  ): Promise<string> {
    if (this.#pending.has(threadId)) throw new Error("该会话正在续接，请勿重复点击。");
    this.#pending.add(threadId);
    try {
      await this.#checkAllowed();
      options?.signal.throwIfAborted();
      const verify = async () => {
        const { thread, turn } = await this.#read(threadId);
        if (this.busy(threadId) || object(thread.status).type === "active")
          throw new Error("该会话仍在运行。");
        if (
          turn.id !== turnId ||
          !["failed", "interrupted", "cancelled"].includes(String(turn.status))
        ) {
          throw new Error("会话状态已改变，请刷新列表。");
        }
      };
      await verify();
      options?.signal.throwIfAborted();
      // 原生 resume 恢复会话配置，不覆盖模型、权限或工作目录。
      result(await this.request("thread/resume", { threadId }));
      await verify();
      await this.#checkAllowed();
      options?.signal.throwIfAborted();
      const response = result(
        await this.request("turn/start", {
          ...options?.context,
          threadId,
          input: [{ type: "text", text: continuation }],
          ...(options
            ? {
                model: options.model,
                effort: null,
                ...(options.collaborationMode
                  ? { collaborationMode: options.collaborationMode }
                  : {}),
              }
            : {}),
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
