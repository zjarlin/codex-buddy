import { readFile } from "node:fs/promises";
import { readConnection } from "@codexhost/buddy-engine";
import type { BuddyModel, BuddySettings } from "@codexhost/shared-contracts";
import { readSelectionPolicy, type SelectionPolicy } from "./model-policy.js";

export interface ExecutorCandidate {
  id: string;
  capability: number | null;
  economy: number | null;
  level: "simple" | "standard" | "unknown";
  efforts?: string[];
}

export interface ModelInventory {
  models: BuddyModel[];
  provider: string;
  planner: string | null;
  executor: string | null;
  executors: ExecutorCandidate[];
  parallelExecutors: ExecutorCandidate[];
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
  return /(?:^|[/:])(?:gpt|claude)(?=[\d._-]|$)/iu.test(id) ? "夯" : "垃";
}

export function chooseModels(
  ids: string[],
  nativeModels: Pick<NativeModelCatalog, "ids" | "contextWindows">,
  preferred: { planner?: string | null; executor?: string | null },
  selection?: { policy: SelectionPolicy; tier: "simple" | "standard" },
): Pick<ModelInventory, "models" | "planner" | "executor" | "executors" | "parallelExecutors"> {
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
  const strong = models.filter((m) => m.eligible && m.tier === "夯");
  const weak = models.filter((m) => {
    const assessment = selection?.policy.assessments.get(m.id);
    return (
      m.eligible &&
      m.tier === "垃" &&
      assessment?.purpose !== "specialized" &&
      assessment?.tools !== false
    );
  });
  const planner =
    strong.find((m) => m.id === preferred.planner) ??
    strong.sort((a, b) => {
      const gpt = (m: BuddyModel): number => (/(?:^|[/:])gpt/iu.test(m.id) ? 1 : 0);
      return gpt(b) - gpt(a) || b.id.localeCompare(a.id, "en", { numeric: true });
    })[0];
  const ranked: ExecutorCandidate[] = weak
    .sort((a, b) => {
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
    (model) => selection?.tier !== "standard" || model.level !== "simple",
  );
  const executor = executors.find((model) => model.id === preferred.executor) ?? executors[0];
  const parallelExecutors = ranked
    .filter((model) => selection?.policy.clientModels.has(model.id))
    .map((model) => ({ ...model, efforts: selection?.policy.clientModels.get(model.id) ?? [] }));
  return {
    models,
    planner: planner?.id ?? null,
    executor: executor?.id ?? null,
    executors,
    parallelExecutors,
  };
}

export async function discoverModels(input: {
  home: string;
  environment: NodeJS.ProcessEnv;
  settings: BuddySettings;
  nativeModels: NativeModelCatalog;
  signal: AbortSignal;
  tier?: "simple" | "standard";
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
  const configModel = typeof connection.config.model === "string" ? connection.config.model : null;
  const chosen = chooseModels(
    ids,
    nativeModels,
    {
      planner: input.settings.plannerModel ?? policy.planner ?? configModel,
      executor: input.settings.executorModel,
    },
    { policy, tier: input.tier ?? "standard" },
  );
  return { ...chosen, provider: connection.providerId };
}
