import type { ProviderModelCatalogEntry } from "@codexhost/shared-contracts";

interface ModelSource {
  name: string;
  apiKey: string;
  baseUrl: string;
  models: readonly string[];
}

export interface ProviderModelSyncResult {
  provider: string;
  models?: string[];
  error?: string;
}

const modelListTimeoutMs = 15_000;

// 网关的 API Base 允许写成带或不带 `/v1` 两种形态（sub2api 两者都被接受），
// 模型目录统一解析到 `<base>/v1/models`。
export function providerModelListUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/u, "");
  return /\/v1$/iu.test(base) ? `${base}/models` : `${base}/v1/models`;
}

/** 拉取单个网关的模型目录。失败只返回错误文案，不影响其他网关。 */
export async function syncProviderModels(source: {
  id: string;
  baseUrl: string;
  apiKey: string;
}): Promise<ProviderModelSyncResult> {
  let response: Response;
  try {
    response = await fetch(providerModelListUrl(source.baseUrl), {
      headers: { accept: "application/json", authorization: `Bearer ${source.apiKey}` },
      signal: AbortSignal.timeout(modelListTimeoutMs),
    });
  } catch (error) {
    return { provider: source.id, error: networkErrorText(error) };
  }
  if (!response.ok) {
    return { provider: source.id, error: `HTTP ${response.status}` };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { provider: source.id, error: "Response is not JSON" };
  }
  const models = modelIds(payload);
  if (!models.length) {
    return { provider: source.id, error: "No models returned" };
  }
  return { provider: source.id, models };
}

/** 合并多个网关的模型目录：同一模型只保留一条，并列出来源网关。 */
export function mergeProviderModels(sources: readonly ModelSource[]): ProviderModelCatalogEntry[] {
  const byModel = new Map<string, string[]>();
  for (const source of sources) {
    const name = source.name || "provider";
    for (const model of source.models) {
      const providers = byModel.get(model);
      if (!providers) {
        byModel.set(model, [name]);
      } else if (!providers.includes(name)) {
        providers.push(name);
      }
    }
  }
  return [...byModel]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, providers]) => ({ model, providers }));
}

function modelIds(payload: unknown): string[] {
  const data = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray(Reflect.get(payload, "data"))
      ? (Reflect.get(payload, "data") as unknown[])
      : [];
  const ids = data.flatMap((entry) => {
    const id = typeof entry === "string" ? entry : objectId(entry);
    const trimmed = id?.trim();
    return trimmed ? [trimmed] : [];
  });
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function objectId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = Reflect.get(value, "id");
  return typeof id === "string" ? id : undefined;
}

function networkErrorText(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Timed out";
  }
  return "Connection failed";
}
