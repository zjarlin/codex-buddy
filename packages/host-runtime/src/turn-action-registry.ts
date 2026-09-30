import { createHash } from "node:crypto";
import {
  harnessActionDefinitionSchema,
  commitOnlyPrompt,
  type HarnessActionDefinition,
  type HarnessCommandCatalog,
  type TurnActionDescriptor,
  type TurnActionFeatures,
} from "@codexhost/shared-contracts";

export interface RegisteredTurnAction {
  descriptor: TurnActionDescriptor;
  target: HarnessActionDefinition["target"] | { kind: "workflow" };
}

export function actionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function registeredTurnActions(input: {
  harnessId: string;
  commands: HarnessCommandCatalog;
  contributions?: readonly HarnessActionDefinition[];
  features: TurnActionFeatures;
  git: boolean;
  blocked?: string;
}): RegisteredTurnAction[] {
  const result: RegisteredTurnAction[] = [];
  const add = (
    definition: Omit<TurnActionDescriptor, "enabled" | "kind">,
    target: RegisteredTurnAction["target"],
    disabledReason?: string,
  ) => {
    if (result.some(({ descriptor }) => descriptor.actionId === definition.actionId)) {
      throw new Error("动作 ID 重复");
    }
    const reason = input.blocked ?? disabledReason;
    result.push({
      target,
      descriptor: {
        ...definition,
        kind: target.kind,
        enabled: !reason,
        ...(reason ? { disabledReason: reason } : {}),
      },
    });
  };
  add(
    {
      actionId: "git.commit",
      version: "1",
      label: "提交代码",
      description: "检查并提交当前项目改动，不推送",
      argumentMode: "none",
    },
    { kind: "prompt", prompt: commitOnlyPrompt },
    !input.git
      ? "当前项目不是 Git 仓库"
      : input.features.git_conflicts
        ? "请先解决合并冲突"
        : input.features.git_changes === 0
          ? "没有待提交改动"
          : undefined,
  );
  add(
    {
      actionId: "git.commit_push",
      version: "1",
      label: "提交并推送",
      description: "执行已有的项目提交并推送工作流",
      argumentMode: "none",
    },
    { kind: "workflow" },
    !input.git
      ? "当前项目不是 Git 仓库"
      : input.features.git_changes + input.features.git_ahead + input.features.git_behind === 0
        ? "项目已同步"
        : undefined,
  );
  for (const candidate of input.contributions ?? []) {
    const definition = harnessActionDefinitionSchema.parse(candidate);
    if (!definition.actionId.startsWith(`${input.harnessId}.`)) {
      throw new Error("插件动作 ID 必须以所属 Harness ID 为前缀");
    }
    const { target, ...descriptor } = definition;
    const command =
      target.kind === "command"
        ? input.commands.commands.find(({ id }) => id === target.commandId)
        : undefined;
    if (command && command.argumentMode !== definition.argumentMode) {
      throw new Error("插件动作参数与原生命令不一致");
    }
    add(
      { ...descriptor, version: actionDigest(definition) },
      target,
      target.kind === "command" && !command ? "当前 Harness 不提供此命令" : undefined,
    );
  }
  for (const command of input.commands.commands) {
    if (result.some(({ target }) => target.kind === "command" && target.commandId === command.id))
      continue;
    add(
      {
        actionId: `native.${actionDigest(command.id).slice(0, 32)}`,
        version: actionDigest(command),
        label: command.label,
        description: command.description ?? command.invocation,
        argumentMode: command.argumentMode,
      },
      { kind: "command", commandId: command.id },
    );
  }
  return result.slice(0, 128);
}
