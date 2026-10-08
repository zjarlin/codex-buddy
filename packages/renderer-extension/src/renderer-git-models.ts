import type { GitMessageModels } from "@codexhost/shared-contracts";
import { readModelFavorites } from "./renderer-model-favorites.js";
import type { ModelShortcutView } from "./renderer-model-shortcuts.js";

// 收藏与原生目录属于当前 Host 的 Codex Provider；其他 Harness 的不透明模型 ID 不混用。
export function cachedGitMessageModels(
  view: ModelShortcutView | undefined,
): GitMessageModels | null {
  if (!view?.models.length) return null;
  const favorites = readModelFavorites("codex");
  const catalog = new Map(view.models.map((model) => [model.id, model]));
  if (view.supportsCustomModel) {
    for (const id of favorites) {
      if (!catalog.has(id)) catalog.set(id, { id, label: id });
    }
  }
  const models = [...catalog.values()].map((model) => ({
    id: model.id,
    label: model.label,
    tier: "垃" as const,
    eligible:
      !model.disabled &&
      !view.unavailableModelIds?.includes(model.id) &&
      !/(?:embedding|rerank|moderation|whisper|tts|image|audio|vision-only|safety)/iu.test(
        model.id,
      ),
    recommended: favorites.has(model.id),
  }));
  models.sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const eligible = models.filter((model) => model.eligible);
  if (!eligible.length) return null;
  return {
    models,
    defaultModel:
      eligible.find((model) => model.id.toLowerCase() === "ask")?.id ?? eligible[0]?.id ?? null,
  };
}
