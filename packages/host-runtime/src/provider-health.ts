import { providerModelListUrl } from "./provider-routing/models.js";

const DEFAULT_TIMEOUT_MS = 3_000;

export interface ProviderProbeOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 已经带认证和查询参数的模型目录地址；省略时按 baseUrl 推导。 */
  modelsUrl?: string;
}

export interface ProviderProbeResult {
  healthy: boolean;
  status: number | null;
  reason: string | null;
}

/**
 * 网关根路径的就绪探测优先于进程存活探测；带路径前缀的 Base URL 先试同一前缀，
 * 再回退站点根路径。模型目录只在两者都不存在时使用。
 */
export function providerHealthUrls(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  const prefix = url.pathname
    .replace(/\/models\/?$/iu, "")
    .replace(/\/v1\/?$/iu, "")
    .replace(/\/+$/u, "");
  const urls = [
    ...(prefix ? [`${url.origin}${prefix}/ready`, `${url.origin}${prefix}/health`] : []),
    `${url.origin}/ready`,
    `${url.origin}/health`,
  ];
  return [...new Set(urls)];
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 响应体取消失败不影响健康结论。
  }
}

async function get(
  request: typeof fetch,
  url: string,
  headers: Headers,
  timeoutMs: number,
): Promise<Response> {
  return request(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function probeProviderHealth(
  baseUrl: string,
  headers?: HeadersInit,
  options: ProviderProbeOptions = {},
): Promise<ProviderProbeResult> {
  const request = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    for (const url of providerHealthUrls(baseUrl)) {
      const response = await get(
        request,
        url,
        new Headers({ Accept: "application/json" }),
        timeoutMs,
      );
      await discard(response);
      if (response.ok) {
        return { healthy: true, status: response.status, reason: null };
      }
      if (response.status !== 404 && response.status !== 405) {
        return {
          healthy: false,
          status: response.status,
          reason: `HTTP ${response.status}`,
        };
      }
    }
    const modelsUrl = options.modelsUrl ?? providerModelListUrl(baseUrl);
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Accept", "application/json");
    const response = await get(request, modelsUrl, requestHeaders, timeoutMs);
    await discard(response);
    return {
      healthy: response.ok,
      status: response.status,
      reason: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      healthy: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
