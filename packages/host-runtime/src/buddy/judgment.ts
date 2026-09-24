import type { Assessment, Project } from "@codexhost/buddy-engine";
import { choice, evaluateDecisions, noul, score, TypeSafeClient } from "@codexhost/jev";

/**
 * 只有存在密钥时创建客户端；否则返回 null，让调用方使用本地规则。
 * 来源优先级：界面持久化配置 > 环境变量（`TYPESAFE_API_KEY` / `TYPESAFE_BASE_URL`）。
 * baseURL 可指向自建 Sub2API 网关，只要该网关把 `/v1/systemone` 原样转发到上游。
 */
export function createJevClient(
  environment: NodeJS.ProcessEnv,
  stored?: { apiKey?: string | null; baseURL?: string | null },
): TypeSafeClient | null {
  const apiKey = stored?.apiKey?.trim() || environment.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const baseURL = stored?.baseURL?.trim() || environment.TYPESAFE_BASE_URL?.trim();
  // 显式传入，避免 SDK 读取进程级环境变量，保证凭据来源只有 Host 注入的 environment。
  return new TypeSafeClient({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(environment.TYPESAFE_DEFAULT_MODEL
      ? { defaultModel: environment.TYPESAFE_DEFAULT_MODEL }
      : {}),
    logLevel: "off",
    retry: { maxRetries: 0 },
  });
}

export interface JevJudgment {
  tier: Assessment["tier"];
  intent: Assessment["intent"];
  reason: string;
  model: string;
  isPush: boolean;
  pushConfidence: number;
  role: "git" | "io" | "executor";
  decisions: Record<string, { status: string; strength: number; basis: string }>;
}

export interface JudgmentInput {
  request: string;
  cwd?: string;
  project?: Project;
  recentText?: string;
  attachmentCount?: number;
  isPushLike?: boolean;
  hasConflicts?: boolean;
  approvalPolicy?: string;
  planMode?: boolean;
}

const timeoutMs = 4_000;

const policies = {
  route: { automatic: 0.85, review: 0.6 },
  complexity: { automatic: 0.9, review: 0.7 },
  destructive: { automatic: 0.95, review: 0.75 },
  push: { automatic: 0.9, review: 0.7 },
  role: { automatic: 0.85, review: 0.6 },
} as const;

/** 单次批量问询 JEV，返回可供 Host 采用的难度、意图和逐题依据；失败由调用者兜底。 */
export async function judgeWithJev(
  client: TypeSafeClient,
  input: JudgmentInput,
  signal?: AbortSignal,
): Promise<JevJudgment> {
  const questions = {
    route: choice("这轮请求最适合哪种处理入口？", {
      code: "修改代码或执行项目操作",
      inspect: "只需读取和检查结果",
      plan: "需要规划、设计或跨模块改动",
      other: "以上都不适用或信息不足",
    }),
    complexity: score("任务复杂度处于哪一档？", [
      "简单：单次读取或信息查询",
      "常规：范围明确的小改动或验证",
      "复杂：设计、重构、跨模块或多步骤",
    ]),
    destructive: noul("拟执行的操作会改动或删除已有数据、历史或远端状态吗？"),
    push: noul("这条当前请求是在要求把已有代码提交或推送到远端仓库吗？"),
    role: choice("应由哪类执行角色处理？", {
      git: "Git 操作：提交、推送、合并、冲突处理",
      io: "文件、目录、日志、构建、测试、启动等 IO 操作",
      executor: "编码、实现、设计或普通问答",
    }),
  };
  const result = await evaluateDecisions(
    client,
    {
      state: {
        request: input.request.slice(0, 6_000),
        evidence: {
          attachments: input.attachmentCount ?? 0,
          pushLike: input.isPushLike ?? false,
          conflicts: input.hasConflicts ?? false,
          approvalPolicy: input.approvalPolicy ?? "unknown",
          planMode: input.planMode ?? false,
          project: input.project
            ? { stacks: input.project.stacks, commands: input.project.commands.length }
            : null,
        },
        ...(input.recentText ? { recent: input.recentText.slice(-6_000) } : {}),
      },
      questions,
      model: "jev-latest",
    },
    policies,
    { timeout: timeoutMs, ...(signal ? { signal } : {}) },
  );
  const push = result.answers.push.noul;
  const roleAnswer = result.answers.role.choice;
  const route = result.answers.route.choice;
  const complexity = result.answers.complexity.score;
  const destructive = result.answers.destructive.noul;
  let tier: Assessment["tier"] = "standard";
  if (
    result.decisions.route.status === "automatic" &&
    (route === "plan" ||
      complexity >= 1.5 ||
      (destructive > 0.5 && result.decisions.destructive.status === "automatic"))
  ) {
    tier = "advanced";
  } else if (route === "inspect" && complexity < 1) {
    tier = "simple";
  }
  const intent =
    route === "code"
      ? input.isPushLike
        ? "git"
        : "project"
      : route === "inspect"
        ? "io"
        : "general";
  const decisions = Object.fromEntries(
    Object.entries(result.decisions).map(([id, decision]) => [
      id,
      { status: decision.status, strength: decision.strength, basis: decision.basis },
    ]),
  );
  return {
    tier,
    intent,
    reason: `JEV ${result.model} 判定 route=${route}、complexity=${complexity}、destructive=${destructive.toFixed(2)}`,
    model: result.model,
    isPush: push > 0.5,
    pushConfidence: Math.max(push, 1 - push),
    role: roleAnswer === "git" || roleAnswer === "io" ? roleAnswer : "executor",
    decisions,
  };
}
