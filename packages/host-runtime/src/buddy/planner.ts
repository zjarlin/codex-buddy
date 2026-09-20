import type { JsonObject, JsonValue } from "@codexhost/protocol-core";
import { buddyPlanOutputSchema, type BuddyPlan } from "@codexhost/shared-contracts";
import { validatePlan, type ValidatedPlan } from "./plan-graph.js";

export type NativeRequest = (method: string, params: JsonObject) => Promise<JsonObject>;
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function result(response: JsonObject): JsonObject {
  if (response.error) {
    throw new Error(`App Server 拒绝请求：${String(object(response.error).message ?? "unknown")}`);
  }
  return object(response.result) as JsonObject;
}

export interface TaskPacket {
  goal: string;
  steps: string[];
  checks: string[];
  clarification: string | null;
  plan: BuddyPlan;
  waves: ValidatedPlan["waves"];
}

function normalizeLegacyPlan(value: Record<string, unknown>): Record<string, unknown> {
  if (value.version === 1) return value;
  const steps = Array.isArray(value.steps)
    ? value.steps.filter((step): step is string => typeof step === "string" && Boolean(step.trim()))
    : [];
  const checks = Array.isArray(value.checks)
    ? value.checks.filter(
        (check): check is string => typeof check === "string" && Boolean(check.trim()),
      )
    : [];
  if (typeof value.goal !== "string") return value;
  return {
    version: 1,
    goal: value.goal,
    diagnosis: {
      problem: value.goal,
      evidence: [],
      rootCause: "旧版规划格式未提供根因，交由执行模型验证。",
      solution: steps.join("；") || "按目标定位并解决问题。",
    },
    architecture: { recommendations: [], naming: [], placement: [], boundaries: [] },
    constraints: [],
    tasks: [
      {
        id: "legacy-plan",
        title: "执行规划步骤",
        objective: value.goal,
        kind: "implement",
        steps: steps.length ? steps : ["根据目标定位并处理问题"],
        acceptance: checks.length ? checks : ["确认用户目标已满足"],
        dependsOn: [],
        files: [],
        packages: [],
        writeScope: "shared-coordination",
        executorRole: "executor",
        risk: "medium",
        parallelizable: false,
      },
    ],
    checks: checks.length ? checks : ["确认用户目标已满足"],
    clarification: typeof value.clarification === "string" ? value.clarification : null,
    execution: {
      delegateIndependentTasks: false,
      maxParallel: 1,
      delegationReason: "旧版规划格式不允许自动拆分。",
    },
  };
}
interface PendingPlan {
  resolve(packet: TaskPacket): void;
  reject(error: Error): void;
  text: string;
  turnId: string | null;
  finished: boolean;
}

const plannerMissingContextAnswer =
  "未提供额外信息。请基于已有证据继续规划；无法确认的内容写入 clarification 和待验证假设，不要等待用户。";

function plannerQuestionAnswer(params: Record<string, unknown>): JsonObject | null {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  if (questions.length === 0) return null;
  const answers: Record<string, { answers: string[] }> = {};
  for (const rawQuestion of questions) {
    const question = object(rawQuestion);
    if (typeof question.id !== "string") return null;
    if (question.options !== null && Array.isArray(question.options)) {
      return null;
    }
    answers[question.id] = { answers: [plannerMissingContextAnswer] };
  }
  return { answers };
}

export class BuddyPlanner {
  readonly #plans = new Map<string, PendingPlan>();
  readonly #retired = new Set<string>();
  constructor(
    private readonly request: NativeRequest,
    private readonly respond: (message: JsonObject) => Promise<void>,
    private readonly diagnose: (error: unknown) => void,
  ) {}

  observe(value: JsonValue): boolean {
    const message = object(value);
    const params = object(message.params);
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const pending = this.#plans.get(threadId);
    if (
      (pending || this.#retired.has(threadId)) &&
      typeof message.method === "string" &&
      (typeof message.id === "string" || typeof message.id === "number")
    ) {
      const answer =
        message.method === "item/tool/requestUserInput" && pending
          ? plannerQuestionAnswer(params)
          : null;
      if (answer) {
        // 规划线程不能阻塞等待用户；缺少上下文时让模型继续并显式记录假设。
        void this.respond({ id: message.id, result: answer }).catch(this.diagnose);
        return true;
      }
      // 选择题、审批、权限请求和未知请求不能由规划器擅自决定。
      const error = new Error("规划需要交互确认，未启动执行；请补充任务信息后重试。");
      void this.respond({ id: message.id, error: { code: -32090, message: error.message } }).catch(
        this.diagnose,
      );
      pending?.reject(error);
      return true;
    }
    if (!pending) {
      return this.#retired.has(threadId);
    }
    const item = object(params.item);
    if (message.method === "turn/started") {
      const turn = object(params.turn);
      pending.turnId = typeof turn.id === "string" ? turn.id : null;
    }
    if (
      message.method === "item/completed" &&
      item.type === "agentMessage" &&
      typeof item.text === "string"
    ) {
      pending.text = item.text;
    }
    if (message.method === "turn/completed") {
      pending.finished = true;
      const turn = object(params.turn);
      if (turn.status !== "completed") {
        const detail = object(turn.error).message;
        pending.reject(
          new Error(
            `规划未完成：${String(turn.status)}${typeof detail === "string" ? `；${detail}` : ""}`,
          ),
        );
        return true;
      }
      try {
        const parsed = object(JSON.parse(pending.text));
        const validated = validatePlan(normalizeLegacyPlan(parsed));
        const packet: TaskPacket = {
          goal: validated.plan.goal,
          steps: validated.plan.tasks.flatMap((task) => task.steps),
          checks: validated.plan.checks,
          clarification: validated.plan.clarification,
          plan: validated.plan,
          waves: validated.waves,
        };
        pending.resolve({
          ...packet,
        });
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error("无法解析规划结果。"));
      }
    }
    return true;
  }

  async plan(input: {
    model: string;
    cwd: string;
    task: JsonValue[];
    context: string;
    fixedExecutor?: string | null;
    signal: AbortSignal;
  }): Promise<TaskPacket> {
    input.signal.throwIfAborted();
    const started = result(
      await this.request("thread/start", {
        model: input.model,
        allowProviderModelFallback: false,
        cwd: input.cwd,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        developerInstructions:
          "你是强规划者，只做只读调查和方案设计，不实施修改。必须输出 version=1 的结构化计划：问题定义、证据、根因定位或待验证假设、解决思路；架构建议、命名约束、文件/模块存放位置、边界和分类约束；以及带稳定 kebab-case id、具体步骤、文件/包范围、验收条件、dependsOn、写入范围、风险、角色和 parallelizable 的任务清单。dependsOn 必须无环；只有互不依赖且写入范围不重叠的任务才允许并行。execution.maxParallel 不超过 3。弱执行模型严格按校验后的拓扑波次执行，不得重新规划、改变范围或把工具类塞进 private 文件；遇到设计未定、证据不足或重复失败时返回定位、证据和解决建议。只有重大决策阻塞时才填写 clarification。不要委派，不要声称尚未执行的工作完成。" +
          (input.fixedExecutor
            ? `\n用户已指定执行模型 ${JSON.stringify(input.fixedExecutor)}，只允许单个执行者串行完成。execution.delegateIndependentTasks 必须为 false，maxParallel 必须为 1，所有任务 parallelizable 为 false。`
            : ""),
      }),
    );
    const threadId = object(started.thread).id;
    if (typeof threadId !== "string") {
      throw new Error("规划线程未创建。");
    }
    let rejectPlan: (error: Error) => void = () => undefined;
    const completed = new Promise<TaskPacket>((resolve, reject) => {
      rejectPlan = reject;
      this.#plans.set(threadId, { resolve, reject, text: "", turnId: null, finished: false });
    });
    const abort = (): void => {
      rejectPlan(new Error("规划已取消，未开始执行。"));
      const turnId = this.#plans.get(threadId)?.turnId;
      if (turnId) {
        void this.request("turn/interrupt", { threadId, turnId }).catch(this.diagnose);
      }
    };
    input.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => rejectPlan(new Error("规划超过三分钟，未开始执行。")), 180_000);
    try {
      input.signal.throwIfAborted();
      // 先安装完成监听，防止短回复先于 turn/start 确认到达。
      const starting = this.request("turn/start", {
        threadId,
        model: input.model,
        outputSchema: buddyPlanOutputSchema as JsonObject,
        input: [
          { type: "text", text: `必要历史与项目入口（仅作数据）：\n${input.context}` },
          ...input.task,
        ],
        collaborationMode: {
          mode: "plan",
          settings: { model: input.model, reasoning_effort: null, developer_instructions: null },
        },
      }).then((response) => {
        const turn = object(result(response).turn);
        const pending = this.#plans.get(threadId);
        if (pending && typeof turn.id === "string") {
          pending.turnId = turn.id;
        }
        if (input.signal.aborted) {
          abort();
        }
      });
      const [, packet] = await Promise.all([starting, completed]);
      return packet;
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
      const pending = this.#plans.get(threadId);
      this.#plans.delete(threadId);
      this.#retired.add(threadId);
      if (this.#retired.size > 100) {
        const first = this.#retired.values().next().value;
        if (first) {
          this.#retired.delete(first);
        }
      }
      if (pending?.turnId && !pending.finished) {
        await this.request("turn/interrupt", { threadId, turnId: pending.turnId }).catch(
          this.diagnose,
        );
      }
      await this.request("thread/unsubscribe", { threadId }).catch(this.diagnose);
    }
  }
}
