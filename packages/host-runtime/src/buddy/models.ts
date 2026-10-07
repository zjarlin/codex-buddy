import { readFile } from "node:fs/promises";
import { readConnection } from "@codexhost/buddy-engine";
import type { BuddyModel, BuddySettings } from "@codexhost/shared-contracts";
import { readSelectionPolicy, type SelectionPolicy } from "./model-policy.js";

export interface ExecutorCandidate {
  id: string;
  capability: number | null;
  economy: number | null;
  level: "simple" | "standard" | "unknown";
}

export interface ModelInventory {
  models: BuddyModel[];
  returned: number;
  provider: string;
  executor: string | null;
  executors: ExecutorCandidate[];
}

export interface NativeModelCatalog {
  ids: Set<string>;
  provider: string | null;
  contextWindows: Map<string, number>;
}

async function catalogContextWindows(path: string | undefined): Promise<Map<string, number>> {
  if (!path) return new Map();
  try {
    const catalog: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!catalog || typeof catalog !== "object" || !("models" in catalog)) {
      return new Map();
    }
    const models = Array.isArray(catalog.models) ? catalog.models : [];
    const windows = new Map<string, number>();
    for (const item of models) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = [row.id, row.model, row.slug].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      const contextWindow = [
        row.contextWindow,
        row.context_window,
        row.maxContextWindow,
        row.max_context_window,
      ].find(
        (value): value is number =>
          typeof value === "number" && Number.isSafeInteger(value) && value > 0,
      );
      if (id && contextWindow !== undefined) {
        windows.set(id, contextWindow);
      }
    }
    return windows;
  } catch {
    return new Map();
  }
}

export function modelTier(id: string): "夯" | "垃" {
  // 开源权重系列单独归类，不按名称当作旗舰模型。
  if (/(?:^|[/:])gpt-oss(?=[\d._-]|$)/iu.test(id)) return "垃";
  return /(?:^|[/:])(?:gpt|claude)(?=[\d._-]|$)/iu.test(id) ? "夯" : "垃";
}

/** 问答只从供应商与原生目录共同确认可用的 Doubao 文本模型中选择。 */
export function chooseConversationModel(models: BuddyModel[]): string | null {
  const candidates = models.filter(
    (model) => model.eligible && /(?:^|[/:])doubao(?:[._-]|$)/iu.test(model.id),
  );
  candidates.sort((a, b) => {
    const priority = (id: string): number =>
      /^doubao$/iu.test(id) ? 2 : /(?:flash|lite|mini)/iu.test(id) ? 1 : 0;
    return priority(b.id) - priority(a.id) || b.id.localeCompare(a.id, "en", { numeric: true });
  });
  return candidates[0]?.id ?? null;
}

export function chooseModels(
  ids: string[],
  nativeModels: Pick<NativeModelCatalog, "ids" | "contextWindows">,
  preferred: { executor?: string | null },
  selection?: { policy: SelectionPolicy; tier: "simple" | "standard" | "advanced" },
): Pick<ModelInventory, "models" | "executor" | "executors"> {
  const models: BuddyModel[] = [...new Set(ids)].map((id) => ({
    id,
    tier: modelTier(id),
    eligible:
      nativeModels.ids.has(id) &&
      (nativeModels.contextWindows.get(id) ?? Number.POSITIVE_INFINITY) > 13_000 &&
      !/(?:embedding|rerank|moderation|whisper|tts|image|audio|vision-only|content-safety|safety-guard|nemoguard|calibration|riva-translate|nemotron-parse|auto-review)/iu.test(
        id,
      ),
  }));
  const candidates = models.filter((m) => {
    const assessment = selection?.policy.assessments.get(m.id);
    return m.eligible && assessment?.purpose !== "specialized" && assessment?.tools !== false;
  });
  const ranked: ExecutorCandidate[] = candidates
    .sort((a, b) => {
      if (selection?.tier === "advanced") {
        const capability = (model: BuddyModel): number =>
          selection.policy.assessments.get(model.id)?.capability ?? (model.tier === "夯" ? 90 : 0);
        const difference = capability(b) - capability(a);
        if (difference) return difference;
        const gpt = (model: BuddyModel): number => (/(?:^|[/:])gpt/iu.test(model.id) ? 1 : 0);
        const family = gpt(b) - gpt(a);
        if (family) return family;
      } else {
        const family = Number(a.tier === "夯") - Number(b.tier === "夯");
        if (family) return family;
      }
      const aEconomy = selection?.policy.assessments.get(a.id)?.economy;
      const bEconomy = selection?.policy.assessments.get(b.id)?.economy;
      if (aEconomy !== undefined || bEconomy !== undefined) {
        const difference = (bEconomy ?? -1) - (aEconomy ?? -1);
        if (difference) {
          return difference;
        }
      }
      const economyHint = (m: BuddyModel): number =>
        /flash|mini|nano|small|lite/iu.test(m.id) ? 1 : 0;
      return economyHint(b) - economyHint(a) || b.id.localeCompare(a.id, "en", { numeric: true });
    })
    .map((model) => ({
      id: model.id,
      capability: selection?.policy.assessments.get(model.id)?.capability ?? null,
      economy: selection?.policy.assessments.get(model.id)?.economy ?? null,
      level:
        selection?.policy.assessments.get(model.id)?.capability === undefined
          ? "unknown"
          : (selection.policy.assessments.get(model.id)?.capability ?? 0) >=
              selection.policy.standardThreshold
            ? "standard"
            : "simple",
    }));
  const executors = ranked.filter(
    (model) => selection?.tier === "simple" || model.level !== "simple",
  );
  const executor = executors.find((model) => model.id === preferred.executor) ?? executors[0];
  return {
    models,
    executor: executor?.id ?? null,
    executors,
  };
}

export async function discoverModels(input: {
  home: string;
  environment: NodeJS.ProcessEnv;
  settings: BuddySettings;
  nativeModels: NativeModelCatalog;
  signal: AbortSignal;
  tier?: "simple" | "standard" | "advanced";
}): Promise<ModelInventory> {
  const connection = await readConnection(
    input.home,
    input.environment,
    input.nativeModels.provider ?? undefined,
  );
  const response = await fetch(connection.url, {
    headers: connection.headers,
    redirect: "error",
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok) {
    throw new Error(`供应商 /models 请求失败 HTTP ${response.status}，未启动模型。`);
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("供应商 /models 返回格式无效。");
  }
  const ids = body.data.flatMap((item: unknown) => {
    if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
      return [item.id];
    }
    return [];
  });
  const policy = await readSelectionPolicy(input.home, connection);
  const nativeModels: NativeModelCatalog = {
    ...input.nativeModels,
    contextWindows: new Map([
      ...(await catalogContextWindows(connection.catalogPath)),
      ...input.nativeModels.contextWindows,
    ]),
  };
  const chosen = chooseModels(
    ids,
    nativeModels,
    {
      executor: input.settings.executorModel,
    },
    { policy, tier: input.tier ?? "standard" },
  );
  return { ...chosen, returned: ids.length, provider: connection.providerId };
}
