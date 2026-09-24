import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import type { ModelRefreshOutcome } from "./renderer-model-refresh-summary.js";

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
