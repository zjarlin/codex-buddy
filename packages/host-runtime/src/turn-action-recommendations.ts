import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  turnActionRecommendationSchema,
  type TurnActionDescriptor,
  type TurnActionFeatures,
  type TurnActionRecommendation,
} from "@codexhost/shared-contracts";

export interface ActionRecommendationInput {
  threadId: string;
  turnId: string;
  contextId: string;
  provider?: string;
  features: TurnActionFeatures;
  actions: TurnActionDescriptor[];
}

export class TurnActionRecommendations {
  readonly #cache = new Map<string, TurnActionRecommendation>();
  readonly #reading = new Set<string>();
  constructor(
    private readonly options: {
      environment: NodeJS.ProcessEnv;
      privateMode(): Promise<boolean>;
    },
  ) {}

  inspect(input: ActionRecommendationInput, generate: boolean): TurnActionRecommendation {
    const key = `${input.threadId}:${input.turnId}:${input.contextId}:${generate}`;
    const prior = this.#cache.get(key);
    if (prior && (prior.state !== "pending" || this.#reading.has(key))) return prior;
    const pending: TurnActionRecommendation = {
      session_id: input.threadId,
      run_id: input.turnId,
      context_id: input.contextId,
      state: "pending",
      source: "none",
      features: input.features,
      actions: [],
      updated_at: Date.now(),
    };
    this.#cache.set(key, pending);
    this.#reading.add(key);
    const oldest = this.#cache.keys().next().value;
    if (this.#cache.size > 128 && oldest) this.#cache.delete(oldest);
    void this.read(input, generate, pending).then((value) => {
      this.#reading.delete(key);
      if (this.#cache.get(key) === pending) this.#cache.set(key, value);
    });
    return pending;
  }

  async read(
    input: ActionRecommendationInput,
    generate: boolean,
    pending: TurnActionRecommendation,
  ): Promise<TurnActionRecommendation> {
    const terminal = (state: TurnActionRecommendation["state"]): TurnActionRecommendation => ({
      ...pending,
      state,
      updated_at: Date.now(),
    });
    const signal = AbortSignal.timeout(3_000);
    const work = async () => {
      if (!input.provider || (await this.options.privateMode())) return terminal("unsupported");
      const connection = await readConnection(
        homePath(this.options.environment.CODEX_HOME),
        this.options.environment,
        input.provider,
      );
      signal.throwIfAborted();
      const url = new URL(connection.url);
      if (url.hostname === "api.openai.com") return terminal("unsupported");
      url.pathname = url.pathname.replace(/\/models$/, "/turn/actions");
      url.searchParams.set("session_id", input.threadId);
      url.searchParams.set("run_id", input.turnId);
      if (generate) url.searchParams.set("context_id", input.contextId);
      const request = async (post: boolean): Promise<unknown | null> => {
        if (await this.options.privateMode()) return null;
        signal.throwIfAborted();
        const target = new URL(url);
        if (post) {
          target.pathname += "/recommend";
          target.searchParams.delete("session_id");
          target.searchParams.delete("run_id");
          target.searchParams.delete("context_id");
        }
        const headers = new Headers(connection.headers);
        if (post) headers.set("Content-Type", "application/json");
        const response = await fetch(target, {
          method: post ? "POST" : "GET",
          redirect: "error",
          signal,
          headers,
          ...(post
            ? {
                body: JSON.stringify({
                  session_id: input.threadId,
                  run_id: input.turnId,
                  context_id: input.contextId,
                  features: input.features,
                  candidates: input.actions
                    .filter(({ enabled }) => enabled)
                    .map(({ actionId, version, label, description }) => ({
                      action_id: actionId,
                      version,
                      label,
                      description,
                    })),
                }),
              }
            : {}),
        });
        if (response.status === 404 || response.status === 405) {
          await response.body?.cancel();
          return null;
        }
        if (!response.ok) {
          await response.body?.cancel();
          // 旧网关和不支持旁路推荐的 Provider 都应回退到已注册动作。
          if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 404 ||
            response.status === 405 ||
            response.status === 422
          )
            return null;
          throw new Error(`推荐接口不可用 (${response.status})`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("推荐响应为空");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 256 * 1024) throw new Error("推荐响应过大");
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (parsed && typeof parsed === "object" && "data" in parsed) {
          const data = (parsed as { data?: unknown }).data;
          return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
        }
        return parsed;
      };
      let value = await request(false);
      if (!value && generate) value = await request(true);
      if (!value) return terminal("unsupported");
      const parsed = turnActionRecommendationSchema.parse(value);
      if (
        parsed.session_id !== input.threadId ||
        parsed.run_id !== input.turnId ||
        (generate && parsed.context_id !== input.contextId)
      )
        throw new Error("推荐回合不匹配");
      const allowed = new Map(input.actions.map((action) => [action.actionId, action.version]));
      if (
        generate &&
        parsed.actions.some((action) => allowed.get(action.action_id) !== action.version)
      ) {
        throw new Error("推荐动作不在当前目录中");
      }
      if (await this.options.privateMode()) return terminal("unsupported");
      return parsed;
    };
    let onAbort: () => void = () => undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } catch {
      // 上游正文与 Provider 凭据不进入界面或执行记录。
      return terminal(signal.aborted ? "timed_out" : "failed");
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
