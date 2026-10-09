import { setTimeout as delay } from "node:timers/promises";

interface RecoveryState {
  model: string;
  allowModelSwitch: boolean;
  used: Set<string>;
  failures: number;
  total: number;
  compacted: boolean;
  contextOnly: boolean;
  turnId: string | null;
  seen: Set<string>;
  controller: AbortController;
}

interface RecoveryOptions {
  changed?(): void;
  wait?(milliseconds: number, signal: AbortSignal): Promise<void>;
  nextModel(threadId: string, excluded: Set<string>, signal: AbortSignal): Promise<string | null>;
  compact?(threadId: string, turnId: string, signal: AbortSignal): Promise<string>;
  resume(
    threadId: string,
    turnId: string,
    model: string,
    signal: AbortSignal,
    afterCompaction?: boolean,
  ): Promise<void>;
  report(
    threadId: string,
    reason: string,
    model: string,
    stopped: boolean,
    waiting?: boolean,
  ): void;
}

// 只消费最终失败回合；原生自动重试、工具报错和结果未知的断连不在此重放。
export class AutomaticRecovery {
  readonly #states = new Map<string, RecoveryState>();
  #waiting = 0;

  constructor(private readonly options: RecoveryOptions) {}

  get pending(): boolean {
    return this.#waiting > 0;
  }

  get threadIds(): string[] {
    return [...this.#states.keys()];
  }

  watch(threadId: string, model: string, allowModelSwitch = true, contextOnly = false): void {
    this.cancel(threadId);
    this.#states.set(threadId, {
      model,
      allowModelSwitch,
      used: new Set([model]),
      failures: 0,
      total: 0,
      compacted: false,
      contextOnly,
      turnId: null,
      seen: new Set(),
      controller: new AbortController(),
    });
  }

  started(threadId: string, turnId: string): boolean {
    const state = this.#states.get(threadId);
    if (!state || state.seen.has(turnId)) return false;
    state.turnId = turnId;
    return true;
  }

  completed(threadId: string, turnId: string, status: string, error: unknown): void {
    const state = this.#states.get(threadId);
    if (!state || state.turnId !== turnId || state.seen.has(turnId)) return;
    if (status !== "failed") {
      this.cancel(threadId);
      return;
    }
    state.seen.add(turnId);
    const description = JSON.stringify(error ?? "");
    // 供应商可能只透出业务码或文本；在通用 HTTP 400/参数错误之前识别上下文超限。
    if (
      /\b11115\b|prompt[_ -](?:too[_ -]long)|prompt is too long|context[_ -]?window[_ -]?exceeded|context[_ -]?length[_ -]?exceeded|exceeds? (?:the )?(?:model.?s? )?(?:context|token) (?:window|limit)|上下文.{0,8}(?:超限|过长)/iu.test(
        description,
      )
    ) {
      if (!this.options.compact || state.compacted || state.total >= 8) {
        this.options.report(
          threadId,
          "上下文超限，已停止自动续接；未重发原请求。",
          state.model,
          true,
        );
        this.cancel(threadId);
        return;
      }
      state.compacted = true;
      state.total++;
      this.#waiting++;
      void this.#compact(threadId, turnId, state).finally(() => {
        this.#waiting--;
        this.options.changed?.();
      });
      return;
    }
    if (state.contextOnly) {
      this.cancel(threadId);
      return;
    }
    // 请求格式错误不会因重试或换模消失，尤其不能重复携带非法工具名的历史。
    if (
      /invalid[_ -]?(?:string|request|argument|parameter)|string does not match pattern|unknown parameter|missing required parameter|unsupported parameter|\b(?:HTTP|status)\s*[:=]?\s*(?:400|422)\b|"(?:httpStatusCode|http_status_code|statusCode|status)"\s*:\s*(?:400|422)\b/iu.test(
        description,
      )
    ) {
      this.options.report(
        threadId,
        "请求参数或工具协议校验失败，已停止自动续接；请修正请求或网关兼容性后再继续。",
        state.model,
        true,
      );
      this.cancel(threadId);
      return;
    }
    if (
      /permission|approval|unauthorized|forbidden|\b40[13]\b|invalid.?api.?key|authentication|context.?window|input length|invalid.?parameter|content.?policy|safety|拒绝|权限|认证|输入长度/iu.test(
        description,
      )
    ) {
      this.options.report(
        threadId,
        "权限、认证、输入长度或其他不可恢复请求限制错误，不自动重试。",
        state.model,
        true,
      );
      this.cancel(threadId);
      return;
    }
    state.failures++;
    state.total++;
    if (!state.allowModelSwitch && state.failures >= 3) {
      this.options.report(
        threadId,
        "指定的执行模型连续失败 3 次，已停止自动续接；未切换模型。",
        state.model,
        true,
      );
      this.cancel(threadId);
      return;
    }
    if (state.total >= 9) {
      this.options.report(threadId, "累计失败 9 次，已停止自动续接。", state.model, true);
      this.cancel(threadId);
      return;
    }
    this.#waiting++;
    void this.#recover(threadId, turnId, state).finally(() => {
      this.#waiting--;
      this.options.changed?.();
    });
  }

  async #recover(threadId: string, turnId: string, state: RecoveryState): Promise<void> {
    const signal = state.controller.signal;
    try {
      const wait = Math.min(30_000, 2_000 * 2 ** (state.total - 1));
      this.options.report(
        threadId,
        `失败 ${state.total}/9 次，${wait / 1000} 秒后自动续接${state.failures >= 3 ? "并切换模型" : ""}。`,
        state.model,
        false,
        true,
      );
      await (this.options.wait
        ? this.options.wait(wait, signal)
        : delay(wait, undefined, { signal }));
      if (state.failures >= 3) {
        const next = await this.options.nextModel(threadId, state.used, signal);
        signal.throwIfAborted();
        if (!next || state.used.has(next)) throw new Error("没有其他可用的同档经济模型。");
        state.model = next;
        state.used.add(next);
        state.failures = 0;
      }
      signal.throwIfAborted();
      await this.options.resume(threadId, turnId, state.model, signal);
      if (!signal.aborted && !state.seen.has(state.turnId ?? ""))
        this.options.report(
          threadId,
          `已自动续接；累计失败 ${state.total}/9 次。`,
          state.model,
          false,
        );
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.report(threadId, `自动续接停止：${message}`, state.model, true);
        this.cancel(threadId);
      }
    }
  }

  async #compact(threadId: string, turnId: string, state: RecoveryState): Promise<void> {
    const signal = state.controller.signal;
    try {
      this.options.report(
        threadId,
        "上下文超限，正在尝试一次原生压缩；确认历史保存后才续接。",
        state.model,
        false,
        true,
      );
      const compact = this.options.compact;
      if (!compact) throw new Error("原生压缩能力不可用。");
      const compactTurnId = await compact(threadId, turnId, signal);
      signal.throwIfAborted();
      await this.options.resume(threadId, compactTurnId, state.model, signal, true);
      if (!signal.aborted && !state.seen.has(state.turnId ?? ""))
        this.options.report(threadId, "原生压缩和历史保存已确认，已自动续接。", state.model, false);
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.report(threadId, `自动压缩停止：${message}`, state.model, true);
        this.cancel(threadId);
      }
    }
  }

  cancel(threadId: string): void {
    this.#states.get(threadId)?.controller.abort();
    this.#states.delete(threadId);
  }

  close(): void {
    for (const id of this.#states.keys()) this.cancel(id);
  }
}
