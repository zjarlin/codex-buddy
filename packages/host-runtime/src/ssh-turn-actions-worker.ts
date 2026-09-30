import {
  hostThreadIdSchema,
  type SshTurnActionsParams,
  type TurnActionsSnapshot,
  type TurnActionInvocation,
} from "@codexhost/shared-contracts";
import { sshObservationContext } from "./ssh-observation-context.js";
import { registeredTurnActions, actionDigest } from "./turn-action-registry.js";
import { TurnActionRecommendations } from "./turn-action-recommendations.js";
import { TurnActionStore } from "./turn-action-store.js";

// 原生 app-server 负责执行与忙闲约束；此 Worker 只查询旁路判断、登记执行身份。
export async function readSshTurnActionsOnHost(
  params: SshTurnActionsParams,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TurnActionsSnapshot | TurnActionInvocation> {
  const observed = await sshObservationContext(params.target, environment);
  const privateMode = await observed.privateMode();
  const threadId = hostThreadIdSchema.parse(params.target.threadId);
  const blocked = privateMode
    ? "隐私模式下不启动在线动作"
    : params.planMode
      ? "计划模式下不启动动作"
      : params.busy
        ? "当前回合尚未结束"
        : params.sourceTurnId !== params.latestTurnId
          ? "历史推荐仅供查看"
          : undefined;
  const actions = registeredTurnActions({
    harnessId: "codex",
    commands: { commands: [] },
    features: params.features,
    git: params.git,
    ...(blocked ? { blocked } : {}),
  }).map(({ descriptor }) => descriptor);
  const store = new TurnActionStore(observed.environment);
  if (params.operation === "inspect") {
    const snapshot: TurnActionsSnapshot = {
      threadId,
      latestTurnId: params.latestTurnId,
      sourceTurnId: params.sourceTurnId,
      busy: params.busy,
      private: privateMode,
      actions,
      invocations: (await store.list(threadId))
        .slice(0, 128)
        .map(({ invocation }) =>
          invocation.state === "starting" ? { ...invocation, state: "unknown" } : invocation,
        ),
    };
    if (!privateMode && (!params.busy || params.sourceTurnId !== params.latestTurnId)) {
      const contextId = actionDigest({
        features: params.features,
        actions: actions.map(({ actionId, version }) => ({ actionId, version })),
      });
      const pending = {
        session_id: params.target.threadId,
        run_id: params.sourceTurnId,
        context_id: contextId,
        state: "pending" as const,
        source: "none" as const,
        features: params.features,
        actions: [],
        updated_at: Date.now(),
      };
      const recommendations = new TurnActionRecommendations({
        environment: observed.environment,
        privateMode: observed.privateMode,
      });
      snapshot.recommendation = await recommendations.read(
        {
          threadId,
          turnId: params.sourceTurnId,
          contextId,
          provider: params.target.modelProvider,
          features: params.features,
          actions,
        },
        params.sourceTurnId === params.latestTurnId && !params.planMode,
        pending,
      );
    }
    return snapshot;
  }
  const invocation = params.invocation;
  if (
    !invocation ||
    invocation.threadId !== threadId ||
    invocation.sourceTurnId !== params.sourceTurnId
  )
    throw new Error("动作身份不匹配");
  const previous = await store.read(threadId, invocation.invocationId);
  if (previous && previous.inputDigest !== actionDigest(invocation))
    throw new Error("执行 ID 已用于其他动作");
  if (params.operation === "update") {
    const result = params.result;
    if (
      !previous ||
      !result ||
      result.threadId !== threadId ||
      result.invocationId !== invocation.invocationId ||
      result.actionId !== invocation.actionId ||
      result.version !== invocation.version ||
      result.sourceTurnId !== invocation.sourceTurnId ||
      (previous.invocation.executionTurnId &&
        previous.invocation.executionTurnId !== result.executionTurnId)
    )
      throw new Error("执行结果归属不匹配");
    if (["completed", "failed", "interrupted"].includes(previous.invocation.state))
      return previous.invocation;
    return (await store.save({ ...previous, invocation: result })).invocation;
  }
  if (previous)
    return previous.invocation.state === "starting"
      ? { ...previous.invocation, state: "unknown" }
      : previous.invocation;
  const action = actions.find(
    (action) => action.actionId === invocation.actionId && action.version === invocation.version,
  );
  if (!action?.enabled || invocation.argumentText)
    throw new Error(action?.disabledReason ?? "动作不可用");
  const receipt: TurnActionInvocation = {
    threadId,
    invocationId: invocation.invocationId,
    sourceTurnId: invocation.sourceTurnId,
    actionId: invocation.actionId,
    version: invocation.version,
    state: "starting",
    updatedAt: Date.now(),
  };
  if (!(await store.claim({ invocation: receipt, inputDigest: actionDigest(invocation) }))) {
    const duplicate = await store.read(threadId, invocation.invocationId);
    if (!duplicate) throw new Error("无法读取动作记录");
    return { ...duplicate.invocation, state: "unknown" };
  }
  return receipt;
}
