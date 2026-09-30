import {
  turnActionExecuteParamsSchema,
  turnActionsInspectParamsSchema,
  type HarnessActionDefinition,
  type HarnessCommandCatalog,
  type TurnActionExecuteParams,
  type TurnActionInvocation,
  type TurnActionFeatures,
  type TurnActionsSnapshot,
} from "@codexhost/shared-contracts";
import { TurnActionStore } from "./turn-action-store.js";
import {
  actionDigest,
  registeredTurnActions,
  type RegisteredTurnAction,
} from "./turn-action-registry.js";
import { TurnActionRecommendations } from "./turn-action-recommendations.js";

export interface TurnActionContext {
  threadId: string;
  harnessId: string;
  provider?: string;
  turns: { id: string; status: string }[];
  busy: boolean;
  private: boolean;
  planMode: boolean;
  git: boolean;
  features: TurnActionFeatures;
  commands: HarnessCommandCatalog;
  contributions?: readonly HarnessActionDefinition[];
}
const terminalStates = new Map<string, TurnActionInvocation["state"]>([
  ["completed", "completed"],
  ["succeeded", "completed"],
  ["failed", "failed"],
  ["interrupted", "interrupted"],
  ["cancelled", "interrupted"],
]);

export class TurnActions {
  readonly #store: TurnActionStore;
  readonly #recommendations: TurnActionRecommendations;
  readonly #executing = new Map<string, Promise<TurnActionInvocation>>();
  readonly #threads = new Set<string>();
  readonly #dispatching = new Map<string, string>();
  constructor(
    private readonly options: {
      environment: NodeJS.ProcessEnv;
      privateMode(): Promise<boolean>;
      context(threadId: string): Promise<TurnActionContext>;
      start(
        threadId: string,
        action: RegisteredTurnAction,
        argumentText?: string,
      ): Promise<string | null>;
    },
  ) {
    this.#store = new TurnActionStore(options.environment);
    this.#recommendations = new TurnActionRecommendations(options);
  }

  #actions(context: TurnActionContext, sourceTurnId?: string): RegisteredTurnAction[] {
    const latest = context.turns.at(-1);
    const blocked = context.private
      ? "隐私模式下不启动在线动作"
      : context.planMode
        ? "计划模式下不启动动作"
        : context.busy
          ? "当前回合尚未结束"
          : !latest || !terminalStates.has(latest.status)
            ? "等待回合结束"
            : sourceTurnId && sourceTurnId !== latest.id
              ? "历史推荐仅供查看"
              : undefined;
    return registeredTurnActions({ ...context, ...(blocked ? { blocked } : {}) });
  }

  async inspect(raw: unknown): Promise<TurnActionsSnapshot> {
    const { threadId, sourceTurnId: requested } = turnActionsInspectParamsSchema.parse(raw);
    const context = await this.options.context(threadId);
    const latestTurnId = context.turns.at(-1)?.id;
    const sourceTurnId = requested ?? latestTurnId;
    if (requested && !context.turns.some(({ id }) => id === requested))
      throw new Error("找不到推荐所属回合");
    const registered = this.#actions(context, sourceTurnId);
    const actions = registered.map(({ descriptor }) => descriptor);
    const invocations: TurnActionInvocation[] = [];
    for (const value of (await this.#store.list(threadId)).slice(0, 128)) {
      const turn = context.turns.find(({ id }) => id === value.invocation.executionTurnId);
      const state = turn && terminalStates.get(turn.status);
      if (state && ["starting", "running", "unknown"].includes(value.invocation.state)) {
        value.invocation = { ...value.invocation, state, updatedAt: Date.now() };
        await this.#store.save(value);
      }
      const invocation = value.invocation;
      invocations.push(
        invocation.state === "starting" && !this.#executing.has(invocation.invocationId)
          ? { ...invocation, state: "unknown", message: "状态待确认，请查看实际回合；不会自动重试" }
          : invocation,
      );
    }
    const result: TurnActionsSnapshot = {
      threadId,
      busy: context.busy,
      private: context.private,
      ...(latestTurnId ? { latestTurnId } : {}),
      ...(sourceTurnId ? { sourceTurnId } : {}),
      actions,
      invocations,
    };
    if (sourceTurnId && !context.private && (!context.busy || sourceTurnId !== latestTurnId)) {
      const contextId = actionDigest({
        harness: context.harnessId,
        provider: context.provider,
        features: context.features,
        actions: actions.map(({ actionId, version, label, description, kind, argumentMode }) => ({
          actionId,
          version,
          label,
          description,
          kind,
          argumentMode,
        })),
      });
      result.recommendation = this.#recommendations.inspect(
        {
          threadId,
          turnId: sourceTurnId,
          contextId,
          ...(context.provider ? { provider: context.provider } : {}),
          features: context.features,
          actions,
        },
        sourceTurnId === latestTurnId && !context.planMode,
      );
    }
    return result;
  }

  execute(raw: unknown): Promise<TurnActionInvocation> {
    const params = turnActionExecuteParamsSchema.parse(raw);
    const key = params.invocationId;
    const pending = this.#executing.get(key);
    // 重复入参也必须校验，不能复用另一个动作的受理结果。
    if (pending) return pending.then(() => this.#previous(params));
    const work = this.#execute(params).finally(() => this.#executing.delete(key));
    this.#executing.set(key, work);
    return work;
  }

  async #previous(params: TurnActionExecuteParams): Promise<TurnActionInvocation> {
    const previous = await this.#store.read(params.threadId, params.invocationId);
    if (!previous || previous.inputDigest !== actionDigest(params))
      throw new Error("执行 ID 已用于其他动作或参数");
    return previous.invocation.state === "starting"
      ? { ...previous.invocation, state: "unknown" }
      : previous.invocation;
  }

  async #execute(params: TurnActionExecuteParams): Promise<TurnActionInvocation> {
    // 每次都确认当前 Host 的 Thread 所有权，包括重复请求。
    let context = await this.options.context(params.threadId);
    if (await this.#store.read(params.threadId, params.invocationId)) return this.#previous(params);
    if (this.#threads.has(params.threadId)) throw new Error("当前聊天正在启动另一个动作");
    this.#threads.add(params.threadId);
    try {
      const action = this.#actions(context, params.sourceTurnId).find(
        ({ descriptor }) => descriptor.actionId === params.actionId,
      );
      if (!action || action.descriptor.version !== params.version)
        throw new Error("动作已变化，请刷新后重试");
      if (!action.descriptor.enabled) throw new Error(action.descriptor.disabledReason);
      if (action.descriptor.argumentMode === "none" && params.argumentText)
        throw new Error("此动作不接受参数");
      const stored = {
        inputDigest: actionDigest(params),
        invocation: {
          threadId: params.threadId,
          invocationId: params.invocationId,
          sourceTurnId: params.sourceTurnId,
          actionId: params.actionId,
          version: params.version,
          state: "starting" as TurnActionInvocation["state"],
          updatedAt: Date.now(),
        } as TurnActionInvocation,
      };
      if (!(await this.#store.claim(stored))) return this.#previous(params);
      // 读盘与能力检查期间，用户可能已开始下一轮或切换了模式。
      context = await this.options.context(params.threadId);
      const fresh = this.#actions(context, params.sourceTurnId).find(
        ({ descriptor }) =>
          descriptor.actionId === params.actionId &&
          descriptor.version === params.version &&
          descriptor.enabled,
      );
      if (!fresh) {
        stored.invocation = {
          ...stored.invocation,
          state: "failed",
          message: "上下文已变化，动作未启动",
          updatedAt: Date.now(),
        };
        await this.#store.save(stored);
        return stored.invocation;
      }
      this.#dispatching.set(params.threadId, params.invocationId);
      try {
        const executionTurnId = await this.options.start(
          params.threadId,
          fresh,
          params.argumentText,
        );
        const observed = await this.#store.read(params.threadId, params.invocationId);
        const early = observed?.invocation;
        stored.invocation =
          early && early.executionTurnId === executionTurnId && terminalStates.has(early.state)
            ? early
            : {
                ...stored.invocation,
                state: executionTurnId ? "running" : "completed",
                ...(executionTurnId ? { executionTurnId } : { message: "工作流无需执行" }),
                updatedAt: Date.now(),
              };
      } catch {
        stored.invocation = {
          ...stored.invocation,
          state: "unknown",
          message: "启动状态待确认，请检查实际回合后操作；不会自动重试",
          updatedAt: Date.now(),
        };
      }
      return (await this.#store.save(stored)).invocation;
    } finally {
      this.#dispatching.delete(params.threadId);
      this.#threads.delete(params.threadId);
    }
  }

  async completed(threadId: string, turnId: string, status: string): Promise<boolean> {
    const state = terminalStates.get(status);
    if (!state) return false;
    let suppressAutoPush = false;
    for (const stored of await this.#store.list(threadId)) {
      const starting =
        stored.invocation.state === "starting" &&
        this.#dispatching.get(threadId) === stored.invocation.invocationId;
      if (stored.invocation.executionTurnId !== turnId && !starting) continue;
      suppressAutoPush ||= stored.invocation.actionId === "git.commit";
      stored.invocation = {
        ...stored.invocation,
        executionTurnId: turnId,
        state,
        ...(stored.invocation.actionId === "git.commit_push" && state === "completed"
          ? { message: "执行回合已结束；仓库同步结果请查看推送工作流" }
          : {}),
        updatedAt: Date.now(),
      };
      await this.#store.save(stored);
    }
    return suppressAutoPush;
  }
}
