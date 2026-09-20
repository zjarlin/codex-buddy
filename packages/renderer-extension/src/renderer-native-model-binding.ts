import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";

import type { ModelShortcutView } from "./renderer-model-shortcuts.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

interface NativeModelOption {
  model: Record<string, unknown> & { model: string; displayName: string };
  disabledReason?: unknown;
}

// 只读取原生菜单已发布的模型与回调；不改请求、原生 store 或发送行为。
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
      if (model.hidden === true) continue;
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
    const selectModel = props.onSelectModel;
    return {
      view: {
        models: options.map(({ model, disabledReason }) => ({
          id: model.model,
          label: model.displayName,
          disabled: disabledReason != null || model.model === props.lockedModelSlug,
        })),
        selected: typeof props.model === "string" ? props.model : undefined,
        disabled,
      },
      select(id) {
        const option = options.find(({ model }) => model.model === id);
        if (disabled || !option || option.disabledReason != null || id === props.lockedModelSlug)
          throw new Error("Model selection is unavailable");
        // 和原生菜单一致：保留受支持的思考强度，否则交给该模型的默认值。
        const efforts = Array.isArray(option.model.supportedReasoningEfforts)
          ? option.model.supportedReasoningEfforts
          : [];
        const effort = efforts.some(
          (value) => record(value)?.reasoningEffort === props.reasoningEffort,
        )
          ? props.reasoningEffort
          : option.model.defaultReasoningEffort;
        if (
          typeof props.onBeforeSelectModel === "function" &&
          props.onBeforeSelectModel(id) === false
        )
          return;
        selectModel(id, effort);
        if (typeof props.onSelectModelOption === "function") props.onSelectModelOption();
        if (typeof props.onSelectComplete === "function") props.onSelectComplete();
      },
    };
  }
  return null;
}
