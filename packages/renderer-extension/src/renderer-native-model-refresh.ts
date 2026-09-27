import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import type { RendererModelClient } from "./renderer-model-client.js";
import type { ModelRefreshOutcome } from "./renderer-model-refresh-summary.js";
import { nativeModelBinding } from "./renderer-native-model-binding.js";

interface NativeModelCatalogRefresh {
  client: Pick<RendererModelClient, "buddyStatus" | "syncCodexCatalog">;
  hostId: string;
  trigger(): HTMLElement | null;
  isCurrent(): boolean;
}

// 供应商同步与原生查询结束后，仍需等待 React 发布完整的新目录。
export async function refreshNativeModelCatalog({
  client,
  hostId,
  trigger,
  isCurrent,
}: NativeModelCatalogRefresh): Promise<ModelRefreshOutcome> {
  try {
    if (!isCurrent()) return undefined;
    if (!client.buddyStatus) throw new Error("Model refresh connection is unavailable");
    const snapshot = await client.buddyStatus();
    if (!isCurrent()) return undefined;
    if (snapshot.settings.privateMode) throw new Error("隐私模式下不刷新在线模型目录。");
    if (!client.syncCodexCatalog) throw new Error("供应商模型同步不可用。");
    const synced = await client.syncCodexCatalog();
    if (!isCurrent()) return undefined;
    await refreshNativeModels(trigger(), hostId);
    if (!isCurrent()) return undefined;

    const expectedIds = new Set(synced.ids);
    const deadline = Date.now() + 2_000;
    while (isCurrent()) {
      const models = nativeModelBinding(trigger())?.view.models;
      const loadedIds = new Set(models?.map(({ id }) => id));
      if (
        models &&
        loadedIds.size === expectedIds.size &&
        [...expectedIds].every((id) => loadedIds.has(id))
      ) {
        return { returned: synced.returned, synchronized: loadedIds.size };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `目录已同步但界面尚未更新，请重试刷新（供应商返回 ${synced.returned} 个模型，界面已载入 ${loadedIds.size} 个）。`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, remaining)));
    }
    return undefined;
  } catch (error) {
    // 已切换任务、Host 或 Harness 的请求不再向新目标发布状态。
    if (!isCurrent()) return undefined;
    throw error;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// 使用原生 QueryClient 的目录查询，不改写菜单数据或模型选择。
export async function refreshNativeModels(
  trigger: HTMLElement | null,
  hostId: string,
): Promise<ModelRefreshOutcome> {
  const key = trigger && Object.keys(trigger).find((key) => key.startsWith("__reactFiber$"));
  const ancestors = trigger && key ? committedReactAncestors(Reflect.get(trigger, key)) : [];
  const candidates: unknown[] = [];
  for (const fiber of ancestors) {
    const props = record(fiber.memoizedProps);
    candidates.push(props?.client, props?.value, props?.scope);
    const seen = new Set<unknown>();
    for (
      let dependency = record(record(fiber.dependencies)?.firstContext);
      dependency;
      dependency = record(dependency.next)
    ) {
      if (seen.has(dependency) || seen.size >= 1000) break;
      seen.add(dependency);
      candidates.push(dependency.memoizedValue);
    }
  }
  for (const candidate of candidates) {
    const value = record(candidate);
    const client = record(value?.queryClient) ?? value;
    if (typeof client?.getQueryCache !== "function" || typeof client.refetchQueries !== "function")
      continue;
    const cache = record(client.getQueryCache());
    if (typeof cache?.findAll !== "function") continue;
    // 9922 的原生目录键为 models/list/host/auth/limit，后缀由原生查询自行维护。
    const filters = { queryKey: ["models", "list", hostId], type: "active" };
    const queries: unknown = cache.findAll(filters);
    if (!Array.isArray(queries) || queries.length === 0) continue;
    await client.refetchQueries(filters, { throwOnError: true, cancelRefetch: false });
    return undefined;
  }
  throw new Error("Native model refresh is unavailable. Reopen the model menu and try again.");
}
