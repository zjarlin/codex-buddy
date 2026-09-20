import type { BuddyInterrupted } from "@codexhost/shared-contracts";
import type { JsonObject } from "@codexhost/protocol-core";
import { object, result, type NativeRequest } from "./planner.js";

const continuation =
  "继续本会话上一次尚未完成的请求。先核对已有回答、工具结果和当前实际状态，从中断处继续；不要盲目重放已完成的命令、修改或外部操作。若上次请求已经完成，简要说明即可。";

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

  async list(): Promise<BuddyInterrupted> {
    await this.#checkAllowed();
    const page = result(
      await this.request("thread/list", {
        limit: 30,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
      }),
    );
    const threads: BuddyInterrupted["threads"] = [];
    let unreadable = 0;
    for (const entry of Array.isArray(page.data) ? page.data : []) {
      const metadata = object(entry);
      if (typeof metadata.id !== "string" || this.busy(metadata.id)) continue;
      try {
        const { thread, turn } = await this.#read(metadata.id);
        if (object(thread.status).type === "active" || typeof turn.id !== "string") continue;
        if (
          turn.status !== "failed" &&
          turn.status !== "interrupted" &&
          turn.status !== "cancelled"
        )
          continue;
        threads.push({
          threadId: metadata.id,
          turnId: turn.id,
          title: String(thread.name || thread.preview || metadata.id).slice(0, 160),
          status: turn.status,
        });
      } catch {
        // 单个历史不可读不阻断其他会话，并明确返回遗漏数量。
        unreadable++;
      }
    }
    return { threads, unreadable };
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
