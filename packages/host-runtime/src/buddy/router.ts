import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  compatibleTurn,
  dispatchLifecycle,
  homePath,
  inspectProject,
  threadState,
  turnState,
  type ThreadContext,
} from "@codexhost/buddy-engine";
import {
  buddyPrivateModelSchema,
  buddySettingsFileSchema,
  buddySettingsSchema,
  type BuddyDecision,
  type BuddyModel,
  type BuddyModelRefresh,
  type BuddySnapshot,
} from "@codexhost/shared-contracts";
import type { JsonObject, JsonRpcRequest, JsonValue } from "@codexhost/protocol-core";
import { object, result, type NativeRequest } from "./native.js";
import { chooseConversationModel, discoverModels, type NativeModelCatalog } from "./models.js";
import {
  classifyWithFallback,
  classifyWithSystemOne,
  dispatchCandidates,
  invocation,
  type ClassifiedRoute,
  type ClassificationEnvironment,
} from "./classification.js";
import { AutomaticRecovery } from "./recovery.js";
import { NativeContextCompaction } from "./context-compaction.js";
import { InterruptedConversations } from "./continuation.js";
import { GitPushBypassScores, gitPushSkills, gitWorkflowGuidance } from "./git-push-bypass.js";
import { createJevClient, type SystemOneCommand } from "./judgment.js";
import type { TypeSafeClient } from "@codexhost/jev";

const quote = (text: string): string => `'${text.replaceAll("'", "'\"'\"'")}'`;
// 离线兜底的执行角色推测保留在此导出，供测试与高级用法使用；
// 正常路由由 classification.ts 中的 System One 判定负责。
export { specialist } from "./classification.js";
export const BUDDY_PRIVATE_TURN_MARKER = "codexhostBuddyPrivateTurn";
export interface BuddyRouterOptions {
  activeWorkChanged?(): void;
  environment: NodeJS.ProcessEnv;
  request: NativeRequest;
  send(message: JsonObject): Promise<void>;
  forward(request: JsonRpcRequest): Promise<void>;
  diagnose(error: unknown): void;
  jev?: TypeSafeClient;
}

export class BuddyRouter {
  readonly #home: string;
  readonly #threads = new Map<string, ThreadContext>();
  readonly #tracked = new Map<string | number, JsonRpcRequest>();
  readonly #decisions = new Map<string, BuddyDecision>();
  readonly #jobs = new Map<string, AbortController>();
  readonly #active = new Set<string>();
  readonly #dispatch: ReturnType<typeof dispatchLifecycle>;
  readonly #bypassScores = new GitPushBypassScores();
  #jev: TypeSafeClient | null;
  #jevKey: string | null = null;
  #jevBaseUrl: string | null = null;
  readonly #recovery: AutomaticRecovery;
  readonly #compaction: NativeContextCompaction;
  readonly #recoveryContext = new Map<string, JsonObject>();
  #settings = buddySettingsSchema.parse({});
  #models: BuddyModel[] = [];
  #modelRefresh: BuddyModelRefresh | undefined;

  constructor(private readonly options: BuddyRouterOptions) {
    this.#home = homePath(options.environment.CODEX_HOME);
    // JEV 仅由 Host 进程读取密钥；缺少密钥时保持 null，所有判断回退本地规则。
    // 外部注入优先，便于测试；否则从环境变量读取密钥构造实例。
    this.#jevKey = null;
    this.#jev = options.jev ?? createJevClient(options.environment);
    const continuation = new InterruptedConversations(
      options.request,
      (id) => this.#active.has(id) || this.#jobs.has(id),
      async () => {
        await this.#loadSettings();
        return !this.#settings.privateMode;
      },
    );
    this.#compaction = new NativeContextCompaction(options.request);
    this.#recovery = new AutomaticRecovery({
      changed: () => options.activeWorkChanged?.(),
      compact: async (threadId, turnId, signal) => {
        await this.#loadSettings();
        if (this.#settings.privateMode) throw new Error("自动压缩已关闭。");
        return this.#compaction.compact(threadId, turnId, signal);
      },
      nextModel: async (threadId, excluded, signal) => {
        await this.#loadSettings();
        if (!this.#settings.enabled || this.#settings.privateMode)
          throw new Error("自动恢复已关闭。");
        const inventory = await discoverModels({
          home: this.#home,
          environment: options.environment,
          settings: this.#settings,
          nativeModels: await this.#nativeModels(threadId),
          signal,
          tier: this.#decisions.get(threadId)?.difficulty ?? "standard",
        });
        return inventory.executors.find((candidate) => !excluded.has(candidate.id))?.id ?? null;
      },
      resume: async (threadId, turnId, model, signal, afterCompaction) => {
        const context = this.#recoveryContext.get(threadId) ?? {};
        const mode = object(context.collaborationMode) as JsonObject;
        const nextTurnId = await continuation.continue(threadId, turnId, {
          signal,
          model,
          context,
          ...(afterCompaction ? { afterCompaction: true } : {}),
          ...(typeof mode.mode === "string"
            ? {
                collaborationMode: {
                  ...mode,
                  settings: {
                    ...(object(mode.settings) as JsonObject),
                    model,
                    reasoning_effort: null,
                    developer_instructions: `${String(object(mode.settings).developer_instructions ?? "")}\n本次续接请求的模型 ID 已更新为 ${JSON.stringify(model)}，此前的模型身份描述不再适用。`,
                  },
                },
              }
            : {}),
        });
        if (!signal.aborted && this.#recovery.started(threadId, nextTurnId)) {
          this.#active.add(threadId);
          this.#update(threadId, { acceptedModel: model, turnId: nextTurnId });
        }
      },
      report: (threadId, reason, model, stopped, waiting) => {
        if (stopped) this.#recoveryContext.delete(threadId);
        if (!this.#decisions.has(threadId)) {
          this.#setDecision(threadId, {
            threadId,
            turnId: null,
            phase: "retrying",
            role: "executor",
            difficulty: "standard",
            score: 0,
            reason,
            executorModel: model,
            acceptedModel: model,
            involvedModels: [model],
            command: null,
            exitCode: null,
            updatedAt: new Date().toISOString(),
          });
        }
        this.#update(threadId, {
          reason,
          executorModel: model,
          phase: stopped ? "failed" : waiting ? "retrying" : "executing",
        });
      },
    });
    this.#dispatch = dispatchLifecycle({
      send: (message) => {
        void options.send(message as JsonObject).catch(options.diagnose);
      },
      warn: (threadId, message) => {
        this.#update(threadId, { reason: message });
      },
      record: (state) => {
        if (typeof state.threadId !== "string") {
          return;
        }
        this.#update(state.threadId, {
          phase:
            state.accepted === false || state.success === false
              ? "failed"
              : state.success === true
                ? "completed"
                : "bypass",
          exitCode: typeof state.exitCode === "number" ? state.exitCode : null,
          turnId: typeof state.turnId === "string" ? state.turnId : null,
        });
      },
      release: (threadId) => this.#active.delete(threadId),
    });
  }

  async #loadSettings(): Promise<void> {
    try {
      // 持久化文件可能由更新版本先写入；读取时忽略未知字段，避免旧运行时被新开关卡死。
      this.#settings = buddySettingsFileSchema.parse(
        JSON.parse(await readFile(join(this.#home, "buddy-router.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async #loadJevKey(): Promise<void> {
    if (this.options.jev) {
      // 外部注入的客户端优先，测试或高级用法不读取持久化密钥。
      return;
    }
    try {
      const raw = JSON.parse(await readFile(join(this.#home, "buddy-jev.json"), "utf8"));
      const key = typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
      const baseURL = typeof raw?.baseURL === "string" ? raw.baseURL.trim() : "";
      this.#jevKey = key || null;
      this.#jevBaseUrl = baseURL || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      this.#jevKey = null;
      this.#jevBaseUrl = null;
    }
    this.#jev = createJevClient(this.options.environment, {
      apiKey: this.#jevKey,
      baseURL: this.#jevBaseUrl,
    });
  }

  /**
   * 持久化 JEV 连接配置。`apiKey` / `baseURL` 省略表示保持原值，null/空串表示清除该项；
   * baseURL 可指向自建 Sub2API 网关。密钥不写入 settings，也不回传浏览器；baseURL 会回传。
   */
  async configureJevKey(input: {
    apiKey?: string | null | undefined;
    baseURL?: string | null | undefined;
  }): Promise<BuddySnapshot> {
    if (this.options.jev) {
      throw new Error("JEV 客户端已由 Host 注入，不能在界面覆盖连接配置。");
    }
    await this.#loadJevKey();
    const key = input.apiKey === undefined ? this.#jevKey : input.apiKey?.trim() || null;
    const baseURL = input.baseURL === undefined ? this.#jevBaseUrl : input.baseURL?.trim() || null;
    const file = join(this.#home, "buddy-jev.json");
    await mkdir(this.#home, { recursive: true });
    if (key || baseURL) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify(
          { ...(key ? { apiKey: key } : {}), ...(baseURL ? { baseURL } : {}) },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      await rename(temporary, file);
    } else {
      await rm(file, { force: true });
    }
    this.#jevKey = key;
    this.#jevBaseUrl = baseURL;
    this.#jev = createJevClient(this.options.environment, {
      apiKey: this.#jevKey,
      baseURL: this.#jevBaseUrl,
    });
    return this.snapshot();
  }

  async snapshot(): Promise<BuddySnapshot> {
    await this.#loadSettings();
    await this.#loadJevKey();
    return {
      settings: this.#settings,
      models: this.#models,
      ...(this.#modelRefresh ? { modelRefresh: this.#modelRefresh } : {}),
      decisions: [...this.#decisions.values()],
      jevKeyConfigured: this.#jev !== null,
      jevBaseUrl: this.#jevBaseUrl,
      emergencyConfigured: false,
      emergencyEnabled: false,
      emergencyBaseUrl: null,
    };
  }

  async refreshModels(): Promise<BuddySnapshot> {
    await this.#loadSettings();
    if (this.#settings.privateMode) {
      throw new Error("隐私模式下不读取在线供应商目录。");
    }
    const inventory = await discoverModels({
      home: this.#home,
      environment: this.options.environment,
      settings: this.#settings,
      nativeModels: await this.#nativeModels(),
      signal: AbortSignal.timeout(10000),
    });
    this.#models = inventory.models;
    this.#modelRefresh = {
      returned: inventory.returned,
      synchronized: inventory.models.length,
      eligible: inventory.models.filter((model) => model.eligible).length,
    };
    return this.snapshot();
  }

  async configure(value: unknown): Promise<BuddySnapshot> {
    const settings = buddySettingsSchema.parse(value);
    await mkdir(this.#home, { recursive: true });
    const file = join(this.#home, "buddy-router.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, file);
    this.#settings = settings;
    if (!settings.enabled || settings.privateMode) {
      for (const [id, decision] of this.#decisions) {
        if (decision.phase === "retrying") this.cancel(id);
      }
      this.#recovery.close();
      this.#recoveryContext.clear();
      for (const controller of this.#jobs.values()) {
        controller.abort();
      }
    }
    return this.snapshot();
  }

  cancel(threadId: string): void {
    this.#recovery.cancel(threadId);
    this.#recoveryContext.delete(threadId);
    if (this.#decisions.get(threadId)?.phase === "retrying") {
      this.#update(threadId, { phase: "cancelled", reason: "已取消自动续接。" });
    }
    this.#jobs.get(threadId)?.abort();
  }

  async privateMode(): Promise<boolean> {
    await this.#loadSettings();
    return this.#settings.privateMode;
  }

  get hasActiveWork(): boolean {
    return this.#jobs.size > 0 || this.#active.size > 0 || this.#recovery.pending;
  }

  get activeThreadIds(): string[] {
    return [...new Set([...this.#jobs.keys(), ...this.#active, ...this.#recovery.threadIds])];
  }

  // 明确的工作流入口不再做意图分类，也不经过高级模型规划；沿用现有 Git 技能与执行约束。
  async startGitWorkflow(
    threadId: string,
    cwd: string,
    prompt: string,
    beforeStart: () => Promise<void>,
  ): Promise<string> {
    await this.#loadSettings();
    if (this.#settings.privateMode) throw new Error("隐私模式下不自动推送代码。");
    if (this.#threads.get(threadId)?.mode === "plan")
      throw new Error("规划模式下不执行推送工作流。");
    const nativeModels = await this.#nativeModels(threadId);
    const inventory = await discoverModels({
      home: this.#home,
      environment: this.options.environment,
      settings: this.#settings,
      nativeModels,
      signal: new AbortController().signal,
      tier: "standard",
    });
    const model = inventory.executor;
    if (!model) throw new Error("没有可用的 Git 执行模型。");
    if (this.#settings.executorModel && model !== this.#settings.executorModel)
      throw new Error("指定的执行模型当前不可用。");
    const skills = await gitPushSkills(this.options.request, cwd, [{ type: "text", text: prompt }]);
    await beforeStart();
    this.#setDecision(threadId, {
      threadId,
      turnId: null,
      phase: "executing",
      role: "git",
      difficulty: "standard",
      score: 45,
      reason: "项目推送工作流",
      executorModel: model,
      acceptedModel: null,
      involvedModels: [model],
      command: null,
      exitCode: null,
      updatedAt: new Date().toISOString(),
      modelBypass: this.#bypassScores.start(model, skills.skills, skills.warning),
    });
    this.#active.add(threadId);
    try {
      const response = await this.options.request("turn/start", {
        threadId,
        cwd,
        input: skills.input,
        model,
        effort: null,
        collaborationMode: {
          mode: "default",
          settings: {
            model,
            reasoning_effort: null,
            developer_instructions: gitWorkflowGuidance("commit-push", true),
          },
        },
      });
      const turnId = object(result(response).turn).id;
      if (typeof turnId !== "string") throw new Error("推送工作流没有返回回合 ID。");
      this.#update(threadId, { turnId, acceptedModel: model });
      return turnId;
    } catch (error) {
      this.#active.delete(threadId);
      this.#update(threadId, {
        phase: "failed",
        ...this.#finishBypass(threadId, "failed"),
        reason: String(error),
      });
      throw error;
    }
  }

  track(request: JsonRpcRequest): void {
    if (request.method === "turn/start" && !this.#settings.enabled && !this.#settings.privateMode) {
      const params = object(request.params) as JsonObject;
      const threadId = params.threadId;
      const model =
        params.model ??
        object(object(params.collaborationMode).settings).model ??
        (typeof threadId === "string" ? this.#threads.get(threadId)?.model : undefined);
      const mode =
        object(params.collaborationMode).mode ??
        (typeof threadId === "string" ? this.#threads.get(threadId)?.mode : undefined);
      if (
        typeof threadId === "string" &&
        typeof model === "string" &&
        mode !== "plan" &&
        Array.isArray(params.input) &&
        params.input.length > 0 &&
        !params.toolOutput &&
        params.outputSchema == null
      ) {
        this.#watchRecovery(threadId, model, params, false, true);
      }
    }
    if (["thread/start", "thread/resume", "thread/fork", "turn/start"].includes(request.method)) {
      this.#tracked.set(request.id, request);
    }
    if (request.method === "thread/settings/update") {
      const params = object(request.params);
      if (typeof params.threadId === "string") {
        this.#threads.delete(params.threadId);
      }
    }
  }

  /** 写入本轮决策并保持最多 100 条内存记录。 */
  #setDecision(threadId: string, decision: BuddyDecision): void {
    this.#decisions.set(threadId, decision);
    if (this.#decisions.size > 100) {
      const first = this.#decisions.keys().next().value;
      if (first) {
        this.#decisions.delete(first);
      }
    }
  }

  #update(threadId: string, patch: Partial<BuddyDecision>): void {
    const current = this.#decisions.get(threadId);
    if (current) {
      const next = { ...current, ...patch };
      const involvedModels = [
        ...new Set(
          [
            ...current.involvedModels,
            ...(patch.involvedModels ?? []),
            next.executorModel,
            next.acceptedModel,
          ].filter((model): model is string => typeof model === "string" && model.length > 0),
        ),
      ];
      this.#decisions.set(threadId, {
        ...next,
        involvedModels,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  #finishBypass(
    threadId: string,
    outcome: "completed" | "failed" | "cancelled",
  ): Partial<BuddyDecision> {
    const decision = this.#decisions.get(threadId);
    const modelBypass = decision ? this.#bypassScores.finish(decision, outcome) : undefined;
    return modelBypass ? { modelBypass } : {};
  }

  observe(message: JsonValue): boolean {
    if (this.#compaction.observe(message)) {
      const value = object(message);
      const threadId = object(value.params).threadId;
      if (typeof threadId === "string") {
        if (value.method === "turn/started") this.#active.add(threadId);
        else this.#active.delete(threadId);
      }
      return false;
    }
    if (this.#dispatch.handle(message)) {
      return true;
    }
    const value = object(message);
    const params = object(value.params);
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const item = object(params.item);
    if (
      (value.method === "item/started" || value.method === "item/completed") &&
      item.type === "collabAgentToolCall" &&
      Array.isArray(item.receiverThreadIds) &&
      item.receiverThreadIds.length > 0 &&
      typeof item.model === "string" &&
      (!params.turnId || this.#decisions.get(threadId)?.turnId === params.turnId)
    ) {
      this.#update(threadId, { involvedModels: [item.model] });
    }
    const request =
      typeof value.id === "number" || typeof value.id === "string"
        ? this.#tracked.get(value.id)
        : undefined;
    if (!value.method && request) {
      this.#tracked.delete(request.id);
      const response = object(value.result);
      const thread = object(response.thread);
      const original = object(request.params);
      if (typeof thread.id === "string") {
        this.#threads.set(thread.id, threadState(response, original, this.#threads.get(thread.id)));
      }
      if (request.method === "turn/start" && typeof original.threadId === "string") {
        const id = original.threadId;
        if (value.error) {
          this.#recovery.cancel(id);
          this.#recoveryContext.delete(id);
          this.#update(id, {
            phase: "failed",
            ...this.#finishBypass(id, "failed"),
            acceptedModel: null,
            reason: "执行模型启动失败；没有自动重放。",
          });
          this.#active.delete(id);
        } else {
          this.#threads.set(id, turnState(original, this.#threads.get(id)));
          this.#update(id, {
            acceptedModel: typeof original.model === "string" ? original.model : null,
            ...(typeof object(response.turn).id === "string"
              ? { turnId: object(response.turn).id as string }
              : {}),
          });
        }
      }
    }
    if (value.method === "turn/started" && threadId) {
      const turn = object(params.turn);
      const bypass = this.#decisions.get(threadId);
      if (
        bypass?.modelBypass &&
        (bypass.modelBypass.outcome !== "pending" ||
          (bypass.turnId !== null && bypass.turnId !== turn.id))
      ) {
        return false;
      }
      this.#active.add(threadId);
      if (typeof turn.id === "string") this.#recovery.started(threadId, turn.id);
      this.#update(threadId, { turnId: typeof turn.id === "string" ? turn.id : null });
    }
    if (value.method === "turn/completed" && threadId) {
      const bypass = this.#decisions.get(threadId);
      if (
        bypass?.modelBypass &&
        (bypass.modelBypass.outcome !== "pending" || bypass.turnId !== object(params.turn).id)
      ) {
        return false;
      }
      this.#active.delete(threadId);
      const current = this.#decisions.get(threadId);
      if (current && current.command === null) {
        const status = object(params.turn).status;
        this.#update(threadId, {
          ...this.#finishBypass(
            threadId,
            status === "completed"
              ? "completed"
              : status === "interrupted"
                ? "cancelled"
                : "failed",
          ),
          phase:
            status === "completed"
              ? "completed"
              : status === "interrupted"
                ? "cancelled"
                : "failed",
        });
      }
      const turn = object(params.turn);
      if (typeof turn.id === "string") {
        this.#recovery.completed(threadId, turn.id, String(turn.status), turn.error);
      }
      if (turn.status !== "failed") this.#recoveryContext.delete(threadId);
    }
    return false;
  }

  async #nativeModels(threadId?: string): Promise<NativeModelCatalog> {
    const ids = new Set<string>();
    const contextWindows = new Map<string, number>();
    let provider: string | null = null;
    if (threadId) {
      const response = await this.options.request("thread/read", {
        threadId,
        includeTurns: false,
      });
      const thread = object(result(response).thread);
      if (typeof thread.modelProvider === "string" && thread.modelProvider.trim()) {
        provider = thread.modelProvider;
      }
    }
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const listing = result(
        await this.options.request("model/list", { includeHidden: true, limit: 100, cursor }),
      );
      for (const item of Array.isArray(listing.data) ? listing.data : []) {
        const row = object(item);
        const id =
          typeof row.id === "string" ? row.id : typeof row.model === "string" ? row.model : null;
        if (id) {
          ids.add(id);
          const contextWindow = [
            row.contextWindow,
            row.context_window,
            row.maxContextWindow,
            row.max_context_window,
          ].find(
            (value): value is number =>
              typeof value === "number" && Number.isSafeInteger(value) && value > 0,
          );
          if (contextWindow !== undefined) {
            contextWindows.set(id, contextWindow);
          }
        }
      }
      cursor = typeof listing.nextCursor === "string" ? listing.nextCursor : null;
      if (cursor && seen.has(cursor)) {
        throw new Error("客户端模型目录分页循环。");
      }
      if (cursor) {
        seen.add(cursor);
      }
    } while (cursor);
    return { ids, provider, contextWindows };
  }

  async route(request: JsonRpcRequest): Promise<boolean> {
    const incomingThread = object(request.params).threadId;
    if (typeof incomingThread === "string") {
      this.#recovery.cancel(incomingThread);
      this.#recoveryContext.delete(incomingThread);
    }
    await this.#loadSettings();
    await this.#loadJevKey();
    if (this.#settings.privateMode) {
      await this.#routePrivate(request);
      return true;
    }
    const params = object(request.params) as JsonObject;
    if (
      !this.#settings.enabled ||
      typeof params.threadId !== "string" ||
      !Array.isArray(params.input) ||
      !params.input.length ||
      params.toolOutput ||
      params.outputSchema != null
    ) {
      return false;
    }
    const threadId = params.threadId;
    if (this.#jobs.has(threadId)) {
      await this.options.send({
        id: request.id,
        error: { code: -32090, message: "当前任务仍在规划；请等待或取消规划。" },
      });
      return true;
    }
    if (this.#active.has(threadId)) {
      return false;
    }
    const controller = new AbortController();
    this.#jobs.set(threadId, controller);
    try {
      await this.#route(request, params, threadId, controller.signal);
    } catch (error) {
      this.#active.delete(threadId);
      const cancelled = controller.signal.aborted;
      this.#update(threadId, {
        phase: cancelled ? "cancelled" : "failed",
        ...this.#finishBypass(threadId, cancelled ? "cancelled" : "failed"),
        reason: cancelled
          ? "已取消；未启动执行模型。"
          : error instanceof Error
            ? error.message
            : "路由失败。",
      });
      await this.options.send({
        id: request.id,
        error: {
          code: cancelled ? -32800 : -32090,
          message: this.#decisions.get(threadId)?.reason ?? "Buddy 路由失败。",
        },
      });
    } finally {
      this.#jobs.delete(threadId);
    }
    return true;
  }

  async #routePrivate(request: JsonRpcRequest): Promise<void> {
    const params = object(request.params) as JsonObject;
    if (
      typeof params.threadId !== "string" ||
      !Array.isArray(params.input) ||
      !params.input.length ||
      params.toolOutput
    ) {
      throw new Error("隐私模式只允许原生对话输入发起新的纯文本回合。");
    }
    const threadId = params.threadId;
    if (this.#active.has(threadId) || this.#jobs.has(threadId)) {
      throw new Error("当前任务仍有回合在运行；请等待或取消后再发送隐私回合。");
    }
    const nativeModels = await this.#nativeModels(threadId);
    const inventory = await discoverModels({
      home: this.#home,
      environment: this.options.environment,
      settings: this.#settings,
      nativeModels,
      signal: AbortSignal.timeout(10_000),
    });
    this.#models = inventory.models;
    const privateModels = inventory.models.filter(
      (model) => model.eligible && buddyPrivateModelSchema.safeParse(model.id).success,
    );
    const privateModel =
      privateModels.find((model) => model.id === this.#settings.executorModel) ??
      privateModels.find((model) => model.id === "q3-14b") ??
      privateModels[0];
    if (!privateModel) {
      throw new Error("没有可用的离线 q3 模型；隐私回合未发送，不会回退到在线模型。");
    }
    const originalMode = object(params.collaborationMode);
    const originalSettings = object(originalMode.settings);
    const rewritten: JsonRpcRequest = {
      id: request.id,
      method: request.method,
      params: {
        ...params,
        [BUDDY_PRIVATE_TURN_MARKER]: true,
        model: privateModel.id,
        effort: null,
        collaborationMode: {
          mode: "default",
          settings: {
            ...originalSettings,
            model: privateModel.id,
            reasoning_effort: null,
          },
        },
      },
    };
    this.#decisions.set(threadId, {
      threadId,
      turnId: null,
      phase: "executing",
      role: "executor",
      difficulty: "simple",
      score: 0,
      reason: "隐私模式已开启；跳过在线路由，自动选择可用的离线 q3 模型。",
      executorModel: privateModel.id,
      acceptedModel: null,
      involvedModels: [privateModel.id],
      command: null,
      exitCode: null,
      updatedAt: new Date().toISOString(),
    });
    if (this.#decisions.size > 100) {
      const first = this.#decisions.keys().next().value;
      if (first) {
        this.#decisions.delete(first);
      }
    }
    this.track(rewritten);
    this.#active.add(threadId);
    try {
      await this.options.forward(rewritten);
    } catch (error) {
      this.#active.delete(threadId);
      throw error;
    }
  }

  /** 分类层需要的 Host 上下文：原生请求、路由设置与 System One 客户端。 */
  #classificationEnvironment(): ClassificationEnvironment {
    return {
      request: this.options.request,
      settings: {
        bypass: this.#settings.bypass,
        role: this.#settings.role,
        systemOneModel: this.#settings.systemOneModel,
      },
      systemOne: this.#jev,
    };
  }

  async #route(
    request: JsonRpcRequest,
    params: JsonObject,
    threadId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const settings = this.#settings;
    const context = this.#threads.get(threadId);
    let cwd = typeof params.cwd === "string" ? params.cwd : context?.cwd;
    if (!cwd) {
      try {
        const response = await this.options.request("thread/read", {
          threadId,
          includeTurns: false,
        });
        const thread = object(result(response).thread);
        if (typeof thread.cwd === "string" && thread.cwd.trim()) {
          cwd = thread.cwd;
          this.#threads.set(threadId, { ...context, cwd });
        }
      } catch {
        // Keep the explicit error below. A Host process directory is not a safe
        // substitute for the user's workspace.
      }
    }
    const input = params.input as JsonValue[];
    const text = input
      .map(object)
      .filter((v) => v.type === "text")
      .map((v) => String(v.text ?? ""))
      .join("\n");
    const project = await inspectProject(cwd);
    signal.throwIfAborted();
    // 意图识别、工具路由、执行角色、推送旁路与 CLI 入口选择全部委托 System One；
    // 本地规则只在该服务不可用时兜底，不再是路由的第一判断层。
    const commands = dispatchCandidates(project, cwd);
    const classification = this.#classificationEnvironment();
    let selected: ClassifiedRoute | null = null;
    let fallbackReason = settings.jev ? "System One 未配置" : "System One 已关闭";
    if (settings.jev && this.#jev) {
      try {
        selected = await classifyWithSystemOne(classification, {
          input,
          text,
          cwd,
          project,
          commands,
          params,
          threadId,
          signal,
        });
      } catch (error) {
        signal.throwIfAborted();
        fallbackReason = "System One 调用失败";
        this.options.diagnose(error);
      }
    }
    selected ??= await classifyWithFallback(classification, {
      text,
      input,
      cwd,
      project,
      threadId,
      fallbackReason,
    });
    if (!cwd) {
      throw new Error("未确认工作目录，无法路由。");
    }
    signal.throwIfAborted();
    this.#setDecision(threadId, {
      threadId,
      turnId: null,
      phase: "discovering",
      role: selected.role,
      difficulty: selected.assessment.tier,
      score: { simple: 15, standard: 45, advanced: 85 }[selected.assessment.tier],
      reason: selected.assessment.reason,
      executorModel: null,
      acceptedModel: null,
      involvedModels: [],
      command: null,
      exitCode: null,
      updatedAt: new Date().toISOString(),
      ...(selected.judgment ? { judgment: selected.judgment } : {}),
      ...(selected.modelBypass ? { modelBypass: this.#bypassScores.start(null, [], null) } : {}),
    });
    const exact = selected.commandIndex === null ? null : commands[selected.commandIndex];
    if (
      exact &&
      !selected.modelBypass &&
      !selected.conversational &&
      settings.bypass &&
      compatibleTurn(params, context)
    ) {
      return this.#runExactCommand(
        request,
        threadId,
        exact,
        `System One ${selected.judgment?.model ?? ""} 命中已发现入口 ${exact.command}`.trim(),
      );
    }
    // 只有确实要走模型回合时才读取原生模型目录，零模型旁路不产生额外请求。
    const nativeModels = await this.#nativeModels(threadId);
    signal.throwIfAborted();
    return this.#executeRoute(request, params, threadId, signal, selected, nativeModels);
  }

  /** 运行 System One 选定的精确 CLI 入口。参数只来自项目清单，不插值用户原文。 */
  async #runExactCommand(
    request: JsonRpcRequest,
    threadId: string,
    command: SystemOneCommand,
    reason: string,
  ): Promise<void> {
    const argv = invocation(command.command);
    const line = `cd ${quote(command.cwd)} && exec ${argv.map(quote).join(" ")}`;
    this.#update(threadId, {
      phase: "bypass",
      difficulty: "simple",
      score: 0,
      command: line,
      reason: `${reason}；未请求模型目录或推理。`,
    });
    this.#active.add(threadId);
    const native = this.#dispatch.submit(request.id, threadId, {
      route: "tool",
      recipe: {
        id: `project.${command.action}`,
        argv,
        cwd: command.cwd,
        source: command.source,
        action: command.action,
      },
      command: line,
      timeoutMs: 3_600_000,
    });
    await this.options.forward(native as JsonRpcRequest);
  }

  /** 分类完成后选择单个模型并改写原生请求，不创建额外规划或执行线程。 */
  async #executeRoute(
    request: JsonRpcRequest,
    params: JsonObject,
    threadId: string,
    signal: AbortSignal,
    selected: ClassifiedRoute,
    nativeModels: NativeModelCatalog,
  ): Promise<void> {
    const settings = this.#settings;
    const fixedExecutor = settings.executorModel;
    const cwd = typeof params.cwd === "string" ? params.cwd : this.#threads.get(threadId)?.cwd;
    if (!cwd) {
      throw new Error("未确认工作目录，无法路由。");
    }
    const input = params.input as JsonValue[];
    const assessment = selected.assessment;
    const conversational = selected.conversational;
    const modelBypass = selected.modelBypass;
    const nativePlanning = object(params.collaborationMode).mode === "plan";
    const inventory = await discoverModels({
      home: this.#home,
      environment: this.options.environment,
      settings,
      nativeModels,
      signal,
      tier: assessment.tier,
    });
    this.#models = inventory.models;
    const questionBypass =
      settings.bypass && selected.source === "system-one" && conversational && !fixedExecutor;
    const answerModel = questionBypass ? chooseConversationModel(inventory.models) : null;
    if (answerModel) {
      inventory.executor = answerModel;
      this.#update(threadId, {
        reason: `System One 确认纯问答；由 ${answerModel} 直接回答。`,
      });
    } else if (questionBypass) {
      this.#update(threadId, {
        reason: "System One 确认纯问答，但实时目录没有可用 Doubao；保留现有 Agent 模型直接回答。",
      });
    }
    if (fixedExecutor && inventory.executor !== fixedExecutor) {
      throw new Error(`指定的执行模型 ${fixedExecutor} 当前不可用，未切换模型。`);
    }
    if (!inventory.executor) {
      throw new Error("没有可用的执行模型，请检查供应商模型同步。");
    }
    signal.throwIfAborted();
    const model = inventory.executor;
    const bypassSkills = modelBypass ? await gitPushSkills(this.options.request, cwd, input) : null;
    signal.throwIfAborted();
    if (bypassSkills && model) {
      this.#update(threadId, {
        modelBypass: this.#bypassScores.start(model, bypassSkills.skills, bypassSkills.warning),
      });
    }
    const originalMode = object(params.collaborationMode);
    const originalSettings = object(originalMode.settings);
    const guidance = [
      originalSettings.developer_instructions,
      questionBypass
        ? "本回合是纯问答旁路。依据当前对话与已有知识直接回答，不调用工具、读取工作区、运行命令、修改文件或委派子代理。缺少事实时明确说明，不声称完成实际操作。后续执行请求由下一回合重新分类。"
        : "",
      modelBypass ? gitWorkflowGuidance(selected.gitAction, selected.needsCommitMessage) : "",
      bypassSkills?.warning
        ? `技能上下文状态：${bypassSkills.warning}。只使用实际可用的技能，不宣称缺失技能已加载。`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const rewritten: JsonRpcRequest = {
      id: request.id,
      method: request.method,
      params: {
        ...params,
        ...(bypassSkills ? { input: bypassSkills.input } : {}),
        model,
        effort: null,
        collaborationMode: {
          mode: nativePlanning ? "plan" : "default",
          settings: {
            ...originalSettings,
            model,
            reasoning_effort: null,
            developer_instructions: guidance,
          },
        },
      },
    };
    this.#update(threadId, {
      phase: "executing",
      executorModel: model,
    });
    this.track(rewritten);
    if (!modelBypass && !answerModel && !nativePlanning && typeof model === "string") {
      this.#watchRecovery(threadId, model, object(rewritten.params) as JsonObject, !fixedExecutor);
    }
    this.#active.add(threadId);
    await this.options.forward(rewritten);
  }

  #watchRecovery(
    threadId: string,
    model: string,
    params: JsonObject,
    allowModelSwitch: boolean,
    contextOnly = false,
  ): void {
    this.#recovery.watch(threadId, model, allowModelSwitch, contextOnly);
    const context: JsonObject = {};
    for (const key of [
      "collaborationMode",
      "cwd",
      "approvalPolicy",
      "sandboxPolicy",
      "permissions",
      "permissionProfile",
      "outputSchema",
    ]) {
      if (params[key] !== undefined) context[key] = params[key];
    }
    this.#recoveryContext.set(threadId, context);
  }

  close(): void {
    this.#recovery.close();
    this.#recoveryContext.clear();
    for (const controller of this.#jobs.values()) {
      controller.abort();
    }
    this.#dispatch.close();
  }
}
