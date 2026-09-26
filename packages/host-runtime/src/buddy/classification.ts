import type { Assessment, Project } from "@codexhost/buddy-engine";
import type { TypeSafeClient } from "@codexhost/jev";
import type { BuddyDecision } from "@codexhost/shared-contracts";
import type { JsonObject, JsonValue } from "@codexhost/protocol-core";
import { recentMessages } from "./history.js";
import { object, type NativeRequest } from "./planner.js";
import { assessWithContext } from "./assessment-context.js";
import { isGitPushRequest } from "./git-push-bypass.js";
import {
  judgeWithJev,
  type JudgmentInput,
  type SystemOneCommand,
  type GitAction,
} from "./judgment.js";

/** System One 或本地兜底给出的完整分类结果，供路由执行阶段直接采用。 */
export interface ClassifiedRoute {
  assessment: Assessment;
  role: BuddyDecision["role"];
  conversational: boolean;
  modelBypass: boolean;
  // Git 工作流动作；none 表示不是 Git 请求。旁路指导据此选择提交/推送/同步步骤。
  gitAction: GitAction;
  needsCommitMessage: boolean;
  judgment: BuddyDecision["judgment"] | undefined;
  commandIndex: number | null;
  reason: string;
  source: "system-one" | "local-rules";
  recent: unknown[];
  previousPlan: string | null;
}

export interface ClassificationEnvironment {
  request: NativeRequest;
  settings: { bypass: boolean; role: BuddyDecision["role"] | "auto"; systemOneModel: string };
  systemOne: TypeSafeClient | null;
  previousPlan(threadId: string): string | null;
}

/**
 * 项目清单中可被精确执行的 CLI 入口，作为 System One 的选择候选。
 * 参数只来自清单本身，任何用户原文都不会拼进命令。
 */
export function dispatchCandidates(
  project: Project,
  cwd: string | undefined,
): SystemOneCommand[] {
  const discovered = project.commands
    .filter((item) => invocation(item.command).length > 0)
    .map((item) => ({
      action: item.action,
      command: item.command,
      cwd: item.cwd,
      source: item.source,
    }));
  const builtins: SystemOneCommand[] = cwd
    ? [
        { action: "inspect", command: "pwd", cwd, source: "builtin" },
        { action: "inspect", command: "ls -la", cwd, source: "builtin" },
      ]
    : [];
  const seen = new Set<string>();
  return [...discovered, ...builtins].filter((item) => {
    if (seen.has(item.command)) return false;
    seen.add(item.command);
    return true;
  });
}

/** 只把清单构造的调用字符串拆成 argv；不做 shell 解析。 */
export function invocation(value: string): string[] {
  return typeof value === "string" && /^[a-zA-Z0-9_./:@-]+(?: [a-zA-Z0-9_./:@-]+)*$/.test(value)
    ? value.split(" ")
    : [];
}

function recentTextForJev(recent: unknown[]): string {
  return recent
    .map((item) => {
      const value = object(item);
      return [value.text, value.summary, value.content]
        .flatMap((piece) => {
          if (typeof piece === "string") return [piece];
          if (Array.isArray(piece)) {
            return piece.map((part) =>
              typeof part === "string" ? part : String(object(part).text ?? ""),
            );
          }
          return [];
        })
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .slice(-6)
    .join("\n\n");
}

/**
 * 分类阶段的历史读取：失败时返回空历史，让 System One 仍能只凭本轮文本判断。
 * 真正需要历史的规划阶段仍使用 recentMessages，失败照常中止本回合。
 */
async function classificationHistory(
  request: NativeRequest,
  threadId: string,
): Promise<unknown[]> {
  try {
    return await recentMessages(request, threadId);
  } catch {
    return [];
  }
}

function resolveRole(
  settings: ClassificationEnvironment["settings"],
  judged: "git" | "io" | "executor" | null,
  text: string,
  assessment: Assessment,
  modelBypass: boolean,
): BuddyDecision["role"] {
  if (settings.role !== "auto") return settings.role;
  if (modelBypass) return "git";
  return judged ?? specialist(text, assessment.intent);
}

/** System One 批量判断本轮请求；未配置或调用失败时返回 null 交由调用方兜底。 */
export async function classifyWithSystemOne(
  environment: ClassificationEnvironment,
  context: {
    input: JsonValue[];
    text: string;
    cwd: string | undefined;
    project: Project;
    commands: SystemOneCommand[];
    params: JsonObject;
    threadId: string;
    signal: AbortSignal;
  },
): Promise<ClassifiedRoute> {
  const client = environment.systemOne;
  if (!client) {
    throw new Error("System One client is not configured.");
  }
  // 首轮只发当前请求。只有 System One 判定为承接上文时，才读取历史并复评，
  // 避免每个普通回合都付出历史读取成本。
  const base = {
    request: context.text,
    ...(context.cwd ? { cwd: context.cwd } : {}),
    project: context.project,
    commands: context.commands,
    attachmentCount: context.input.filter((item) => object(item).type !== "text").length,
    planMode: object(context.params.collaborationMode).mode === "plan",
    ...(typeof context.params.approvalPolicy === "string"
      ? { approvalPolicy: context.params.approvalPolicy }
      : {}),
  } satisfies JudgmentInput;
  const model = environment.settings.systemOneModel;
  let jev = await judgeWithJev(client, base, { signal: context.signal, model });
  let recent: unknown[] = [];
  if (jev.refersToPrevious) {
    recent = await classificationHistory(environment.request, context.threadId);
    if (recent.length) {
      jev = await judgeWithJev(
        client,
        { ...base, recentText: recentTextForJev(recent) },
        { signal: context.signal, model },
      );
    }
  }
  const assessment: Assessment = { tier: jev.tier, intent: jev.intent, reason: jev.reason };
  const judgment: NonNullable<BuddyDecision["judgment"]> = {
    source: "system-one",
    model: jev.model,
    decisions: jev.decisions as NonNullable<BuddyDecision["judgment"]>["decisions"],
  };
  // 只要 System One 判定为 Git 动作（提交/提交并推送/推送/同步/继续合并）就进入
  // Git 旁路，交由 git 角色回合按 action 逐步执行；冲突消解仍在该模型回合内完成。
  const gitBypass = jev.gitAction !== "none";
  const modelBypass = environment.settings.bypass && (gitBypass || jev.isPush);
  if (modelBypass) {
    assessment.tier = "standard";
    assessment.intent = "git";
    assessment.reason = `System One 确认 Git 动作 ${jev.gitAction}（${jev.model}，confidence=${jev.pushConfidence.toFixed(2)}）；旁路至垃模型，跳过夯规划。`;
  }
  return {
    assessment,
    role: resolveRole(environment.settings, jev.role, context.text, assessment, modelBypass),
    conversational: jev.conversational,
    modelBypass,
    gitAction: modelBypass ? jev.gitAction : "none",
    needsCommitMessage: modelBypass && jev.needsCommitMessage,
    judgment,
    commandIndex: modelBypass ? null : jev.commandIndex,
    reason: jev.reason,
    source: "system-one",
    recent,
    previousPlan: environment.previousPlan(context.threadId),
  };
}

/** System One 不可用或失败时的本地兜底分类；不参与正常路由的第一判断。 */
export async function classifyWithFallback(
  environment: ClassificationEnvironment,
  path: {
    text: string;
    input: JsonValue[];
    cwd: string | undefined;
    project: Project;
    threadId: string;
  },
): Promise<ClassifiedRoute> {
  const previousPlan = environment.previousPlan(path.threadId);
  // 兜底路径无法判断承接关系，直接读取有界历史交给本地评级；失败按空历史处理。
  const recent = await classificationHistory(environment.request, path.threadId);
  const assessment = await assessWithContext(path.input, path.cwd, path.project, recent, previousPlan);
  const modelBypass = environment.settings.bypass && isGitPushRequest(path.input);
  if (modelBypass) {
    assessment.tier = "standard";
    assessment.intent = "git";
    assessment.reason = "本地规则命中推送请求（System One 不可用）；旁路至垃模型，跳过夯规划。";
  }
  return {
    assessment,
    role: resolveRole(environment.settings, null, path.text, assessment, modelBypass),
    conversational: assessment.intent === "conversation",
    modelBypass,
    gitAction: modelBypass ? "commit-push" : "none",
    needsCommitMessage: modelBypass,
    judgment: undefined,
    commandIndex: null,
    reason: assessment.reason,
    source: "local-rules",
    recent,
    previousPlan: previousPlan ?? null,
  };
}

/** 只作为离线兜底的执行角色推测；System One 可达时不会调用。 */
export function specialist(text: string, intent: string): BuddyDecision["role"] {
  if (
    /(?:开发|实现|设计|新增|添加|编写).*(?:功能|智能体|路由|插件|模块)|implement|design a/iu.test(
      text,
    )
  ) {
    return "executor";
  }
  if (intent === "git") return "git";
  return intent === "project" ||
    /文件|目录|日志|复制|移动|重命名|查找|搜索|跑起来|构建|测试|\b(?:ls|cp|mv|find|rg|npm|pnpm|cargo|gradle|pytest)\b/iu.test(
      text,
    )
    ? "io"
    : "executor";
}
