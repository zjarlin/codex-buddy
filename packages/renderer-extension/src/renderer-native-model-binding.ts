import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import type { ModelShortcutView } from "./renderer-model-shortcuts.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

interface NativeModelOption {
  model: Record<string, unknown> & { model: string; displayName: string };
  disabledReason?: unknown;
}

// 复用原生模型选择回调；手填 ID 不依赖目录成员资格，也不改写发送请求。
export function nativeModelBinding(trigger: HTMLElement | null): {
  view: ModelShortcutView;
  select(id: string): void;
} | null {
  if (!trigger) return null;
  const fiberKey = Object.keys(trigger).find((key) => key.startsWith("__reactFiber$"));
  if (!fiberKey) return null;
  for (const fiber of committedReactAncestors(Reflect.get(trigger, fiberKey))) {
    const props = record(fiber.memoizedProps);
    if (!props || !Array.isArray(props.modelOptions) || typeof props.onSelectModel !== "function")
      continue;
    const options: NativeModelOption[] = [];
    for (const value of props.modelOptions) {
      const option = record(value);
      const model = record(option?.model);
      if (typeof model?.model !== "string" || typeof model.displayName !== "string") return null;
      options.push({
        model: model as NativeModelOption["model"],
        disabledReason: option?.disabledReason,
      });
    }
    const disabled =
      props.disabled === true ||
      props.modelOptionsDisabled === true ||
      record(props.daybreak)?.isSaving === true ||
      props.menuFooter != null;
    // 隐藏或目录外的锁定模型也必须在关闭自动策略之前被拒绝。
    const unavailableModelIds = options
      .filter(({ disabledReason }) => disabledReason != null)
      .map(({ model }) => model.model);
    if (typeof props.lockedModelSlug === "string") {
      unavailableModelIds.push(props.lockedModelSlug);
    }
    const selectModel = props.onSelectModel;
    return {
      view: {
        models: options
          .filter(({ model }) => model.hidden !== true)
          .map(({ model }) => ({
            id: model.model,
            label: model.displayName,
            disabled: unavailableModelIds.includes(model.model),
          })),
        selected: typeof props.model === "string" ? props.model : undefined,
        supportsCustomModel: true,
        unavailableModelIds,
        disabled,
      },
      select(id) {
        const option = options.find(({ model }) => model.model === id);
        if (!id.trim() || disabled || unavailableModelIds.includes(id)) {
          throw new Error("Model selection is unavailable");
        }
        // 和原生菜单一致：保留受支持的思考强度，否则交给该模型的默认值。
        const efforts = Array.isArray(option?.model.supportedReasoningEfforts)
          ? option.model.supportedReasoningEfforts
          : [];
        // 目录外模型显式清空旧强度；undefined 会让原生计划模式沿用上个模型的值。
        const effort = efforts.some(
          (value) => record(value)?.reasoningEffort === props.reasoningEffort,
        )
          ? props.reasoningEffort
          : (option?.model.defaultReasoningEffort ?? null);
        if (
          typeof props.onBeforeSelectModel === "function" &&
          props.onBeforeSelectModel(id) === false
        ) {
          throw new Error("Model selection was declined");
        }
        selectModel(id, effort);
        if (typeof props.onSelectModelOption === "function") props.onSelectModelOption();
        if (typeof props.onSelectComplete === "function") props.onSelectComplete();
      },
    };
  }
  return null;
}
