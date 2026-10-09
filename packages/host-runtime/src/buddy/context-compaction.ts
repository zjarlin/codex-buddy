import type { JsonObject, JsonValue } from "@codexhost/protocol-core";
import { object, result, type NativeRequest } from "./native.js";

interface PendingCompaction {
  turnId: string | null;
  itemCompleted: boolean;
  sent: boolean;
  finish(error?: Error): void;
}

// 原生完成事件发生在 replacement_history 保存之后；请求被接受不等于压缩成功。
export class NativeContextCompaction {
  readonly #pending = new Map<string, PendingCompaction>();

  constructor(private readonly request: NativeRequest) {}

  async compact(threadId: string, failedTurnId: string, signal: AbortSignal): Promise<string> {
    if (this.#pending.has(threadId)) throw new Error("该会话正在压缩。");
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const verify = async () => {
      const history = result(
        await this.#request("thread/read", { threadId, includeTurns: true }, boundedSignal),
      );
      const thread = object(history.thread);
      const turns = Array.isArray(thread.turns) ? thread.turns : [];
      const turn = object(turns.at(-1));
      if (
        object(thread.status).type === "active" ||
        turn.id !== failedTurnId ||
        turn.status !== "failed"
      ) {
        throw new Error("会话状态已改变，未开始自动压缩。");
      }
    };
    let finish: PendingCompaction["finish"] = () => {};
    const completed = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve());
    });
    // 先挂载观察器，再发送请求，避免同步事件或极快完成丢失。
    const pending: PendingCompaction = { turnId: null, itemCompleted: false, sent: false, finish };
    this.#pending.set(threadId, pending);
    const abort = () => {
      const error = new Error("自动压缩取消或超时，未自动续接。");
      finish(error);
    };
    boundedSignal.addEventListener("abort", abort, { once: true });
    // 请求失败或取消时也消费事件等待的拒绝，避免未处理的 Promise 拒绝。
    void completed.catch(() => {});
    try {
      await verify();
      result(await this.#request("thread/resume", { threadId }, boundedSignal));
      await verify();
      boundedSignal.throwIfAborted();
      pending.sent = true;
      result(await this.#request("thread/compact/start", { threadId }, boundedSignal));
      await completed;
      boundedSignal.throwIfAborted();
      if (!pending.turnId) throw new Error("原生压缩回合未确认。");
      const history = result(
        await this.#request("thread/read", { threadId, includeTurns: true }, boundedSignal),
      );
      const thread = object(history.thread);
      const turns = Array.isArray(thread.turns) ? thread.turns : [];
      const turn = object(turns.at(-1));
      if (
        object(thread.status).type === "active" ||
        turn.id !== pending.turnId ||
        !isCompletedCompaction(turn)
      ) {
        throw new Error("压缩后的历史未确认，未自动续接。");
      }
      boundedSignal.throwIfAborted();
      return pending.turnId;
    } finally {
      boundedSignal.removeEventListener("abort", abort);
      this.#pending.delete(threadId);
    }
  }

  // 超时只停止等待；原生操作结果未知时不重发，也不假定它已经停止。
  async #request(method: string, params: JsonObject, signal: AbortSignal): Promise<JsonObject> {
    signal.throwIfAborted();
    let abort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error("自动压缩取消或超时，未自动续接。"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([this.request(method, params), cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  observe(message: JsonValue): boolean {
    const value = object(message);
    const params = object(value.params);
    const pending =
      typeof params.threadId === "string" ? this.#pending.get(params.threadId) : undefined;
    if (!pending?.sent) return false;
    const turn = object(params.turn);
    if (value.method === "turn/started" && typeof turn.id === "string") {
      if (pending.turnId !== null && pending.turnId !== turn.id) {
        pending.finish(new Error("压缩期间出现其他回合，未自动续接。"));
      } else {
        pending.turnId = turn.id;
      }
    }
    if (
      value.method === "item/completed" &&
      params.turnId === pending.turnId &&
      object(params.item).type === "contextCompaction"
    ) {
      pending.itemCompleted = true;
    }
    if (value.method === "turn/completed" && turn.id === pending.turnId) {
      if (turn.status === "completed" && pending.itemCompleted) {
        pending.finish();
      } else {
        pending.finish(
          new Error(
            `原生压缩未成功，未自动续接：${String(object(turn.error).message ?? turn.status)}`,
          ),
        );
      }
    }
    // 通知仍向 Desktop 转发，只隔离它与普通执行回合的恢复状态。
    return value.method === "turn/started" || value.method === "turn/completed";
  }
}

export function isCompletedCompaction(turn: Record<string, unknown>): boolean {
  return (
    turn.status === "completed" &&
    Array.isArray(turn.items) &&
    turn.items.some((item) => object(item).type === "contextCompaction")
  );
}
