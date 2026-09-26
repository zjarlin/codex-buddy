import type { Assessment, Project } from "@codexhost/buddy-engine";
import { choice, evaluateDecisions, noul, score, TypeSafeClient } from "@codexhost/jev";

/** Host 交给 System One 的候选 CLI 动作；id 为空表示这条请求不直接执行已知入口。 */
export interface SystemOneCommand {
  action: string;
  command: string;
  cwd: string;
  source: string;
}

/**
 * 只有存在密钥时创建客户端；否则返回 null，让调用方使用本地规则。
 * 来源优先级：界面持久化配置 > 环境变量（`TYPESAFE_API_KEY` / `TYPESAFE_BASE_URL`）。
 * baseURL 可指向自建 Sub2API 网关，只要该网关把 `/v1/systemone` 转发到上游。
 * 网关按 `model` 选择平台：`laya*` 走本地 Laya，`typesafe/jev` 走 JEV。
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
    logLevel: "off",
    retry: { maxRetries: 0 },
  });
}

/** System One 模型名同时是网关的平台选择器；默认 JEV，可切到本地 Laya。 */
export const DEFAULT_SYSTEM_ONE_MODEL = "typesafe/jev";
export const SYSTEM_ONE_MODELS = [DEFAULT_SYSTEM_ONE_MODEL, "laya"] as const;
export type SystemOneModel = (typeof SYSTEM_ONE_MODELS)[number];

export function isSystemOneModel(value: string): value is SystemOneModel {
  return (SYSTEM_ONE_MODELS as readonly string[]).includes(value);
}

/**
 * System One 判定的 Git 工作流动作。旁路回合据此决定是只提交、提交并推送，
 * 还是先拉取同步/继续合并；`none` 表示本轮不是 Git 操作请求。
 */
export const GIT_ACTIONS = [
  "none",
  "commit",
  "commit-push",
  "push",
  "sync",
  "merge-continue",
] as const;
export type GitAction = (typeof GIT_ACTIONS)[number];

export interface JevJudgment {
  tier: Assessment["tier"];
  intent: Assessment["intent"];
  conversational: boolean;
  refersToPrevious: boolean;
  isPush: boolean;
  pushConfidence: number;
  // 具体的 Git 工作流动作；none 表示这不是 Git 请求。
  gitAction: GitAction;
  needsCommitMessage: boolean;
  destructive: boolean;
  role: "git" | "io" | "executor";
  commandIndex: number | null;
  reason: string;
  model: string;
  decisions: Record<string, { status: string; strength: number; basis: string }>;
}

export interface JudgmentInput {
  request: string;
  cwd?: string;
  project?: Project;
  recentText?: string;
  attachmentCount?: number;
  hasConflicts?: boolean;
  approvalPolicy?: string;
  planMode?: boolean;
  commands: SystemOneCommand[];
}

const timeoutMs = 4_000;

const policies = {
  route: { automatic: 0.85, review: 0.6 },
  complexity: { automatic: 0.9, review: 0.7 },
  destructive: { automatic: 0.95, review: 0.75 },
  push: { automatic: 0.9, review: 0.7 },
  gitAction: { automatic: 0.85, review: 0.65 },
  commitMessage: { automatic: 0.85, review: 0.65 },
  role: { automatic: 0.85, review: 0.6 },
  conversational: { automatic: 0.9, review: 0.7 },
  followUp: { automatic: 0.85, review: 0.6 },
  exactCommand: { automatic: 0.95, review: 0.8 },
  commandIndex: { automatic: 0.9, review: 0.7 },
} as const;

export interface JudgeOptions {
  signal?: AbortSignal;
  model?: string;
}

/**
 * 单次批量问询 System One，一次性取得 Host 路由所需的全部原子判断：
 * 处理入口、难度、破坏性、推送意图、执行角色、是否闲聊、是否承接上文、
 * 以及是否命中某个已发现的 CLI 入口。失败由调用者兜底，不在此处猜测。
 */
export async function judgeWithJev(
  client: TypeSafeClient,
  input: JudgmentInput,
  options: JudgeOptions = {},
): Promise<JevJudgment> {
  // 候选入口本身来自项目清单，通常很少；上限避免过长选项列表拖累本地小模型。
  const commands = input.commands.slice(0, 12);
  const commandCriteria: Record<string, string> = { none: "不执行任何已发现的命令入口" };
  commands.forEach((item, index) => {
    commandCriteria[`c${index}`] = item.command;
  });
  const model = options.model ?? DEFAULT_SYSTEM_ONE_MODEL;
  const questions = {
    route: choice("这轮请求最适合哪种处理入口？", {
      code: "修改代码、编写实现或执行项目写操作",
      inspect: "只需读取、查看或检查结果，不改动文件",
      plan: "需要规划、设计、架构判断或跨模块改动",
      other: "以上都不适用或信息不足",
    }),
    complexity: score("任务复杂度处于哪一档？", [
      "简单：单次读取、信息查询或简短交流",
      "常规：范围明确的小改动或验证",
      "复杂：设计、重构、跨模块或多步骤",
    ]),
    destructive: noul("这轮请求会改动或删除已有数据、历史或远端状态吗？"),
    push: noul(
      "用户是在要求本回合实际执行把代码提交或推送到远端仓库的操作吗？" +
        "只是询问、解释、讨论、诊断或提到推送（例如“为什么/如何/会不会触发推送”“推送功能怎么实现”）都不算操作请求。",
    ),
    // Git 工作流的具体动作：决定旁路回合是只提交、提交并推送，还是同步/继续合并。
    // none 同时覆盖“不是 Git 请求”和“只是在提问/讨论”，避免仅凭 push 分数触发旁路。
    gitAction: choice("用户本回合明确要求执行哪一种 Git 操作？提问或讨论一律选 none。", {
      none: "没有要求执行 Git 操作（包括提问、解释、讨论或提及推送）",
      commit: "只提交本地改动，不推送",
      "commit-push": "提交改动并推送到远端",
      push: "只推送已有提交，不新建提交",
      sync: "拉取远端并同步/合并到本地",
      "merge-continue": "继续完成进行中的合并或解决冲突",
    }),
    commitMessage: noul("这次提交是否需要由你根据改动自动生成提交消息？"),
    role: choice("应由哪类执行角色处理？", {
      git: "Git 操作：提交、推送、合并、冲突处理",
      io: "文件、目录、日志、构建、测试、启动等 IO 操作",
      executor: "编码、实现、设计或普通问答",
    }),
    conversational: noul("这条请求是无需工具和代码改动的普通问答或简短寒暄吗？"),
    followUp: noul("这条请求是在承接上文已讨论的任务、方案或步骤，而不是提出新的独立任务吗？"),
    exactCommand: noul("这条请求是否正好对应下面列出的某个已发现 CLI 入口？"),
    commandIndex: choice("如果是，应执行哪一个已发现入口？", commandCriteria),
  };
  const result = await evaluateDecisions(
    client,
    {
      state: {
        request: input.request.slice(0, 6_000),
        commands: commands.map((item, index) => ({
          id: `c${index}`,
          action: item.action,
          command: item.command,
        })),
        evidence: {
          attachments: input.attachmentCount ?? 0,
          conflicts: input.hasConflicts ?? false,
          approvalPolicy: input.approvalPolicy ?? "unknown",
          planMode: input.planMode ?? false,
          project: input.project
            ? { stacks: input.project.stacks, keywords: input.project.keywords }
            : null,
        },
        ...(input.recentText ? { recent: input.recentText.slice(-6_000) } : {}),
      },
      questions,
      model,
    },
    policies,
    { timeout: timeoutMs, ...(options.signal ? { signal: options.signal } : {}) },
  );
  const route = result.answers.route.choice;
  const complexity = result.answers.complexity.score;
  const destructive = result.answers.destructive.noul;
  const push = result.answers.push.noul;
  const gitActionAnswer = result.answers.gitAction.choice;
  const needsCommitMessage =
    result.answers.commitMessage.noul > 0.5 &&
    result.decisions.commitMessage.status === "automatic";
  const roleAnswer = result.answers.role.choice;
  const conversational = result.answers.conversational.noul;
  const followUp = result.answers.followUp.noul;
  const exactCommand = result.answers.exactCommand.noul;
  const commandChoice = result.answers.commandIndex.choice;
  const exact =
    exactCommand > 0.5 &&
    result.decisions.exactCommand.status === "automatic" &&
    commandChoice !== "none" &&
    result.decisions.commandIndex.status === "automatic";
  const index = exact ? Number(commandChoice.slice(1)) : NaN;
  const commandIndex = Number.isInteger(index) && index >= 0 && index < commands.length ? index : null;

  const risky = destructive > 0.5 && result.decisions.destructive.status === "automatic";
  // 难度以复杂度分数为主：高级档即使置信度未达自动阈值也保守进入夯规划。
  const complexityCertain = result.decisions.complexity.status !== "defer";
  let tier: Assessment["tier"];
  if (
    risky ||
    (route === "plan" && result.decisions.route.status !== "defer") ||
    (complexityCertain && complexity >= 1.5)
  ) {
    tier = "advanced";
  } else if (complexityCertain && complexity < 1) {
    tier = "simple";
  } else {
    tier = "standard";
  }
  const conversationalAnswer =
    conversational > 0.5 && result.decisions.conversational.status === "automatic";
  const followUpAnswer = followUp > 0.5 && result.decisions.followUp.status === "automatic";
  // Git 动作必须以 System One 明确且自动的 gitAction 判定为准。仅在 push 分数高、
  // 但 gitAction 未达 automatic 或落在 none 时，视为提问/提及而非操作授权，避免误触发旁路。
  const gitActionAnswered =
    (GIT_ACTIONS as readonly string[]).includes(gitActionAnswer) &&
    gitActionAnswer !== "none" &&
    result.decisions.gitAction.status === "automatic";
  // 普通问答即使出现“推送/提交”等字眼也不构成 Git 操作授权。
  const gitAction: GitAction =
    !conversationalAnswer && gitActionAnswered ? (gitActionAnswer as GitAction) : "none";
  const intent: Assessment["intent"] = conversationalAnswer
    ? "conversation"
    : route === "code"
      ? exact && commands[commandIndex ?? -1]?.action === "inspect"
        ? "io"
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
    conversational: conversationalAnswer,
    refersToPrevious: followUpAnswer,
    isPush: !conversationalAnswer && push > 0.5 && result.decisions.push.status === "automatic",
    pushConfidence: Math.max(push, 1 - push),
    gitAction,
    needsCommitMessage,
    destructive: risky,
    role: roleAnswer === "git" || roleAnswer === "io" ? roleAnswer : "executor",
    commandIndex: exact ? commandIndex : null,
    reason:
      `System One ${result.model} 判定 route=${route}、complexity=${complexity}、` +
      `destructive=${destructive.toFixed(2)}、conversation=${conversationalAnswer}、` +
      `gitAction=${gitAction}、` +
      `exactCommand=${commandIndex === null ? "none" : commands[commandIndex]?.command}`,
    model: result.model,
    decisions,
  };
}
