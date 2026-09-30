import {
  TURN_ACTIONS_INSPECT_METHOD,
  TURN_ACTION_EXECUTE_METHOD,
  SSH_TURN_ACTIONS_METHOD,
  GIT_STATUS_METHOD,
  turnActionsInspectParamsSchema,
  turnActionExecuteParamsSchema,
  sshAutoModelRoutesParamsSchema,
  gitWorkspaceStatusSchema,
  turnActionsSnapshotSchema,
  turnActionInvocationSchema,
  commitOnlyPrompt,
  nativeGitWorkflowPrompt,
  type SshTurnActionsParams,
  type TurnActionInvocation,
} from "@codexhost/shared-contracts";
import {
  createRendererRequestSender,
  RendererMethodUnavailableError,
  type RendererRequestOptions,
} from "./renderer-request-sender.js";

type Send = (method: string, params: unknown, options?: RendererRequestOptions) => unknown;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
// 原生 SSH 仍由原生 turn/start 执行；旁路 Worker 只负责远端记录、隐私及 Provider 查询。
export function createRendererSshTurnActionsSender(input: {
  hostId: string;
  send: Send;
  sendGit: Send;
  sendLocal: Send;
  isCurrent(): boolean;
}): Send {
  const remote = createRendererRequestSender(input.send);
  const local = createRendererRequestSender(input.sendLocal);
  const git = createRendererRequestSender(input.sendGit);
  const ensureCurrent = () => {
    if (!input.isCurrent()) throw new Error("SSH 连接已变化，请重新读取动作");
  };
  const read = async (threadId: string, sourceTurnId?: string) => {
    ensureCurrent();
    const response = record(await remote("thread/read", { threadId, includeTurns: true }));
    const thread = record(response.thread);
    if (thread.id !== threadId) throw new Error("无法确认远程动作所属聊天");
    const turns = Array.isArray(thread.turns) ? thread.turns.map(record) : [];
    const last = turns.at(-1);
    if (
      typeof last?.id !== "string" ||
      (sourceTurnId && !turns.some(({ id }) => id === sourceTurnId))
    )
      throw new Error("远程回合不可用");
    const status = await git(GIT_STATUS_METHOD, { threadId }).then(
      (value) => gitWorkspaceStatusSchema.parse(value),
      (error: unknown) => {
        if (error instanceof Error && /not a git repository|不是 Git 仓库/u.test(error.message))
          return null;
        throw error;
      },
    );
    ensureCurrent();
    const params: SshTurnActionsParams = {
      operation: "inspect",
      target: sshAutoModelRoutesParamsSchema.parse({
        hostId: input.hostId,
        threadId,
        modelProvider: thread.modelProvider,
        rolloutPath: thread.path,
      }),
      sourceTurnId: sourceTurnId ?? last.id,
      latestTurnId: last.id,
      busy:
        record(thread.status).type === "active" ||
        ["inProgress", "running"].includes(String(last.status)),
      planMode: record(thread.collaborationMode).mode === "plan",
      git: status !== null,
      features: {
        git_changes: status?.changes.length ?? 0,
        git_conflicts: status?.changes.filter(({ conflicted }) => conflicted).length ?? 0,
        git_ahead: status?.ahead ?? 0,
        git_behind: status?.behind ?? 0,
      },
    };
    return { params, turns };
  };
  return async (method, raw, options) => {
    ensureCurrent();
    try {
      return await remote(method, raw, options);
    } catch (error) {
      if (
        !(error instanceof RendererMethodUnavailableError) ||
        ![TURN_ACTIONS_INSPECT_METHOD, TURN_ACTION_EXECUTE_METHOD].includes(method)
      )
        throw error;
    }
    const query =
      method === TURN_ACTIONS_INSPECT_METHOD
        ? turnActionsInspectParamsSchema.parse(raw)
        : turnActionExecuteParamsSchema.parse(raw);
    const { params, turns } = await read(query.threadId, query.sourceTurnId);
    ensureCurrent();
    if (method === TURN_ACTIONS_INSPECT_METHOD) {
      const snapshot = turnActionsSnapshotSchema.parse(
        await local(SSH_TURN_ACTIONS_METHOD, params),
      );
      ensureCurrent();
      if (snapshot.threadId !== query.threadId || snapshot.sourceTurnId !== params.sourceTurnId)
        throw new Error("远程动作结果归属不匹配");
      for (const invocation of snapshot.invocations) {
        const turn = turns.find(({ id }) => id === invocation.executionTurnId);
        if (!turn || !["running", "unknown"].includes(invocation.state)) continue;
        const states: Record<string, TurnActionInvocation["state"]> = {
          completed: "completed",
          failed: "failed",
          interrupted: "interrupted",
        };
        const state = states[String(turn.status)];
        if (!state) continue;
        const result = { ...invocation, state, updatedAt: Date.now() };
        const original = {
          threadId: invocation.threadId,
          sourceTurnId: invocation.sourceTurnId,
          invocationId: invocation.invocationId,
          actionId: invocation.actionId,
          version: invocation.version,
        };
        await local(SSH_TURN_ACTIONS_METHOD, {
          ...params,
          sourceTurnId: invocation.sourceTurnId,
          operation: "update",
          invocation: original,
          result,
        });
        Object.assign(invocation, result);
        ensureCurrent();
      }
      return snapshot;
    }
    const invocation = turnActionExecuteParamsSchema.parse(raw);
    const claimed = turnActionInvocationSchema.parse(
      await local(SSH_TURN_ACTIONS_METHOD, { ...params, operation: "claim", invocation }),
    );
    if (
      claimed.invocationId !== invocation.invocationId ||
      claimed.threadId !== invocation.threadId ||
      claimed.sourceTurnId !== invocation.sourceTurnId ||
      claimed.actionId !== invocation.actionId ||
      claimed.version !== invocation.version
    )
      throw new Error("执行记录归属不匹配");
    if (claimed.state !== "starting") return claimed;
    let result: TurnActionInvocation;
    try {
      const fresh = await read(query.threadId, invocation.sourceTurnId);
      if (
        fresh.params.busy ||
        fresh.params.planMode ||
        fresh.params.latestTurnId !== invocation.sourceTurnId
      )
        throw new Error("远程回合状态已变化");
      ensureCurrent();
      const prompt =
        invocation.actionId === "git.commit"
          ? commitOnlyPrompt
          : invocation.actionId === "git.commit_push"
            ? nativeGitWorkflowPrompt
            : null;
      if (!prompt) throw new Error("原生 SSH 不支持此动作");
      const started = record(
        await remote("turn/start", {
          threadId: invocation.threadId,
          input: [{ type: "text", text: prompt }],
        }),
      );
      const turnId = record(started.turn).id;
      if (typeof turnId !== "string") throw new Error("原生回合未返回身份");
      result = { ...claimed, state: "running", executionTurnId: turnId, updatedAt: Date.now() };
    } catch {
      result = {
        ...claimed,
        state: "unknown",
        message: "启动状态待确认，不会自动重试",
        updatedAt: Date.now(),
      };
    }
    // 即使界面已切换也将结果保存回原 SSH 目标，绝不在新连接上发起执行。
    return turnActionInvocationSchema.parse(
      await local(SSH_TURN_ACTIONS_METHOD, { ...params, operation: "update", invocation, result }),
    );
  };
}
