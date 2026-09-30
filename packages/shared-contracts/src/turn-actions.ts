import { z } from "zod";
import { sshAutoModelRoutesParamsSchema } from "./ssh-auto-model-routes.js";
import { hostThreadIdSchema } from "./ids.js";

export const TURN_ACTIONS_INSPECT_METHOD = "codexhost/thread/actions/inspect";
export const TURN_ACTION_EXECUTE_METHOD = "codexhost/thread/action/execute";
const identity = z.string().min(1).max(128);
const actionId = identity.regex(/^[A-Za-z0-9._:-]+$/u);
export const turnActionDescriptorSchema = z
  .object({
    actionId,
    version: identity,
    label: z.string().min(1).max(128),
    description: z.string().max(512),
    kind: z.enum(["prompt", "command", "workflow"]),
    argumentMode: z.enum(["none", "text"]),
    enabled: z.boolean(),
    disabledReason: z.string().max(512).optional(),
  })
  .strict();
export type TurnActionDescriptor = z.infer<typeof turnActionDescriptorSchema>;

// 插件只声明自身的 Prompt 或原生命令，Host 工作流不向插件开放任意执行入口。
export const harnessActionDefinitionSchema = z
  .object({
    actionId,
    version: identity,
    label: z.string().min(1).max(128),
    description: z.string().max(512),
    argumentMode: z.enum(["none", "text"]),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("prompt"), prompt: z.string().min(1).max(16_384) }).strict(),
      z.object({ kind: z.literal("command"), commandId: actionId }).strict(),
    ]),
  })
  .strict();
export type HarnessActionDefinition = z.infer<typeof harnessActionDefinitionSchema>;

export const turnActionFeaturesSchema = z
  .object({
    git_changes: z.number().int().nonnegative(),
    git_conflicts: z.number().int().nonnegative(),
    git_ahead: z.number().int().nonnegative(),
    git_behind: z.number().int().nonnegative(),
  })
  .strict();
export type TurnActionFeatures = z.infer<typeof turnActionFeaturesSchema>;

export const turnActionRecommendationSchema = z
  .object({
    session_id: z.string().uuid(),
    run_id: identity,
    context_id: z.string().regex(/^[a-f0-9]{64}$/u),
    state: z.enum(["pending", "completed", "failed", "timed_out", "unsupported"]),
    source: z.enum(["laya", "jev", "none"]),
    model: z.string().max(128).optional(),
    features: turnActionFeaturesSchema,
    actions: z
      .array(
        z
          .object({
            action_id: actionId,
            version: identity,
            confidence: z.number().min(0).max(1),
            reason: z.string().max(512),
          })
          .strict(),
      )
      .max(3),
    updated_at: z.number().int().nonnegative(),
  })
  .strict();
export type TurnActionRecommendation = z.infer<typeof turnActionRecommendationSchema>;

export const turnActionInvocationSchema = z
  .object({
    invocationId: z.string().uuid(),
    threadId: hostThreadIdSchema,
    sourceTurnId: identity,
    actionId,
    version: identity,
    executionTurnId: identity.optional(),
    state: z.enum(["starting", "running", "completed", "failed", "interrupted", "unknown"]),
    message: z.string().max(512).optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type TurnActionInvocation = z.infer<typeof turnActionInvocationSchema>;
export const turnActionsInspectParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    sourceTurnId: identity.optional(),
  })
  .strict();
export type TurnActionsInspectParams = z.infer<typeof turnActionsInspectParamsSchema>;
export const turnActionExecuteParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    sourceTurnId: identity,
    actionId,
    version: identity,
    invocationId: z.string().uuid(),
    argumentText: z.string().max(16_384).optional(),
  })
  .strict();
export type TurnActionExecuteParams = z.infer<typeof turnActionExecuteParamsSchema>;
export const turnActionsSnapshotSchema = z
  .object({
    threadId: hostThreadIdSchema,
    latestTurnId: identity.optional(),
    sourceTurnId: identity.optional(),
    busy: z.boolean(),
    private: z.boolean(),
    actions: z.array(turnActionDescriptorSchema).max(128),
    recommendation: turnActionRecommendationSchema.optional(),
    invocations: z.array(turnActionInvocationSchema).max(128),
  })
  .strict();
export type TurnActionsSnapshot = z.infer<typeof turnActionsSnapshotSchema>;

export const SSH_TURN_ACTIONS_METHOD = "codexhost/ssh/turn-actions";
export const sshTurnActionsParamsSchema = z
  .object({
    target: sshAutoModelRoutesParamsSchema,
    operation: z.enum(["inspect", "claim", "update"]),
    sourceTurnId: identity,
    latestTurnId: identity,
    busy: z.boolean(),
    planMode: z.boolean(),
    features: turnActionFeaturesSchema,
    git: z.boolean(),
    invocation: turnActionExecuteParamsSchema.optional(),
    result: turnActionInvocationSchema.optional(),
  })
  .strict();
export type SshTurnActionsParams = z.infer<typeof sshTurnActionsParamsSchema>;

export const commitOnlyPrompt = [
  "执行提交代码工作流，仅处理当前聊天项目及已明确关联的仓库。",
  "检查各仓库真实根目录、分支、暂存区及工作区，遵循仓库指导生成提交消息并提交应提交的改动。",
  "保留用户已有改动，不删除、不覆盖，不把密钥、环境文件或无关文件加入提交。",
  "遇到未解决冲突或无法判断提交范围时报告原因；没有改动时不创建空提交。",
  "本次只提交，不推送、不发布、不执行远端写操作。逐仓库报告提交结果。",
].join("\n");

export const nativeGitWorkflowPrompt = [
  "处理当前项目的 Git 提交和推送。",
  "先确认当前工作区、分支和远程，只提交用户授权的改动。",
  "有未提交改动时生成简洁的 Conventional Commit 消息并提交，然后推送当前分支；没有改动但有未推送提交时只推送；已经同步时不要创建空提交。",
  "遇到 non-fast-forward 时先拉取并用 merge 同步，不要强制推送；遇到冲突、权限或其他错误时停止并报告真实结果。",
].join("\n");
