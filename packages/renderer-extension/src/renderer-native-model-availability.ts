import type {
  ModelAvailabilityParams,
  ModelAvailabilityResult,
  ModelAvailabilitySnapshot,
} from "@codexhost/shared-contracts";

interface NativeConnection {
  sendRequest(method: string, params: unknown): Promise<unknown>;
  subscribe?: (methods: readonly string[], listener: (notification: unknown) => void) => () => void;
}

const timeoutMs = 15_000;
const instructions =
  "Reply only with OK. Do not use tools, inspect files, or perform any other action.";
const empty = (): ModelAvailabilitySnapshot => ({ provider: "", checkedAt: null, results: [] });
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Bound to one native request client, never a local process, HTTP endpoint, or credential file.
export function createNativeModelAvailability(connection: NativeConnection) {
  let cached: { scope: string; snapshot: ModelAvailabilitySnapshot } | undefined;
  let pending: Promise<ModelAvailabilitySnapshot> | undefined;

  async function scope() {
    const [configuration, account] = await Promise.all([
      connection.sendRequest("config/read", { includeLayers: false }),
      connection.sendRequest("account/read", { refreshToken: false }),
    ]);
    const config = record(record(configuration).config);
    if (!record(configuration).config) throw new Error("无法读取远程 Provider 配置。");
    const provider = typeof config.model_provider === "string" ? config.model_provider : "openai";
    const bytes = new TextEncoder().encode(JSON.stringify([config, account]));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { provider, key: Array.from(new Uint8Array(digest)).join(",") };
  }

  async function model(id: string): Promise<ModelAvailabilityResult> {
    const subscribe = connection.subscribe;
    if (!subscribe) throw new Error("当前远程连接无法接收模型探测结果。");
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    let threadId: string | undefined;
    let turnId: string | undefined;
    let finished = false;
    let released = false;
    let expired = false;
    let hasText = false;
    let settle: (error?: Error) => void = () => undefined;
    const completed = new Promise<void>((resolve, reject) => {
      settle = (error) => (error ? reject(error) : resolve());
    });
    const release = () => {
      if (threadId && !released) {
        released = true;
        void connection.sendRequest("thread/unsubscribe", { threadId }).catch(() => undefined);
      }
    };
    const interrupt = () => {
      if (threadId && turnId && !finished) {
        void connection.sendRequest("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      }
    };
    const remove = subscribe(
      ["item/completed", "turn/started", "turn/completed"],
      (notification) => {
        const message = record(notification);
        const params = record(message.params);
        if (!threadId || params.threadId !== threadId || expired) return;
        const turn = record(params.turn);
        if (message.method === "turn/started" && typeof turn.id === "string") turnId = turn.id;
        const item = record(params.item);
        if (message.method === "item/completed" && item.type === "agentMessage") {
          hasText ||= typeof item.text === "string" && item.text.trim().length > 0;
        }
        if (message.method === "turn/completed") {
          finished = true;
          const items = Array.isArray(turn.items) ? turn.items : [];
          hasText ||= items.some((value) => {
            const item = record(value);
            return (
              item.type === "agentMessage" && typeof item.text === "string" && !!item.text.trim()
            );
          });
          settle(
            turn.status === "completed" && hasText
              ? undefined
              : new Error("远程模型未返回有效的完整回复。"),
          );
        }
      },
    );
    const timer = setTimeout(() => {
      expired = true;
      settle(new Error("远程模型探测超时（15 秒）。"));
    }, timeoutMs);
    const start = async () => {
      const response = record(
        await connection.sendRequest("thread/start", {
          model: id,
          allowProviderModelFallback: false,
          ephemeral: true,
          approvalPolicy: "never",
          sandbox: "read-only",
          baseInstructions: instructions,
          developerInstructions: instructions,
        }),
      );
      const thread = record(response.thread);
      if (typeof thread.id !== "string" || !thread.id)
        throw new Error("远程探测未返回临时 Thread。");
      threadId = thread.id;
      if (expired) {
        release();
        return;
      }
      if (response.model !== id) throw new Error("远程连接未接受指定模型，未使用替代模型探测。");
      const result = record(
        await connection.sendRequest("turn/start", {
          threadId,
          model: id,
          input: [{ type: "text", text: "Reply only with OK." }],
        }),
      );
      const turn = record(result.turn);
      if (typeof turn.id !== "string" || !turn.id) throw new Error("远程探测未返回有效 Turn。");
      turnId = turn.id;
      if (expired) {
        interrupt();
        release();
      }
    };
    // Subscribe before starting the Turn: fast responses can precede its RPC acknowledgement.
    void start().catch(() => settle(new Error("远程模型请求失败，未重试或切换模型。")));
    try {
      await completed;
      return { id, checkedAt, status: "available", latencyMs: Math.max(0, Date.now() - startedAt) };
    } catch (error) {
      return {
        id,
        checkedAt,
        status: "unavailable",
        latencyMs: Math.max(0, Date.now() - startedAt),
        error: error instanceof Error ? error.message : "远程模型请求失败。",
      };
    } finally {
      expired = true;
      clearTimeout(timer);
      remove();
      interrupt();
      release();
    }
  }

  async function probe(modelIds: string[]): Promise<ModelAvailabilitySnapshot> {
    if (!connection.subscribe) throw new Error("当前远程连接无法接收模型探测结果。");
    const before = await scope();
    const ids = new Set(modelIds);
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      const page = record(
        await connection.sendRequest("model/list", { cursor, includeHidden: true }),
      );
      if (!Array.isArray(page.data)) throw new Error("无法读取远程模型目录。");
      for (const entry of page.data) {
        const value = record(entry);
        // Native model is the request ID; id can be a UI alias.
        if (typeof value.model === "string" && value.model) ids.add(value.model);
      }
      cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
      if (cursor && cursors.has(cursor)) throw new Error("远程模型目录分页游标重复。");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const queue = [...ids];
    const results: ModelAvailabilityResult[] = new Array(queue.length);
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (index < queue.length) {
          const position = index++;
          const id = queue[position];
          if (id === undefined) break;
          results[position] = await model(id);
        }
      }),
    );
    if ((await scope()).key !== before.key)
      throw new Error("探测期间远程 Provider 或账号已变化，请重新探测。");
    const snapshot = { provider: before.provider, checkedAt: new Date().toISOString(), results };
    cached = { scope: before.key, snapshot };
    return snapshot;
  }

  return async (params: ModelAvailabilityParams): Promise<ModelAvailabilitySnapshot> => {
    if (params.action === "read") {
      if (!cached) return empty();
      if ((await scope()).key !== cached.scope) cached = undefined;
      return cached?.snapshot ?? empty();
    }
    if (pending) return pending;
    pending = probe(params.modelIds ?? []);
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
