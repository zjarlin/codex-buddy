import { homePath, readConnection } from "@codexhost/buddy-engine";
import { buddyHealthSchema, type BuddyHealth } from "@codexhost/shared-contracts";
import { probeProviderHealth } from "../provider-health.js";

type Connection = { url: URL; headers: Headers; providerId: string };
type ConnectionReader = (home: string, environment: NodeJS.ProcessEnv) => Promise<Connection>;

export interface GatewayHealthOptions {
  fetch?: typeof fetch;
  readConnection?: ConnectionReader;
  timeoutMs?: number;
}

function baseUrl(url: URL): string {
  const value = new URL(url.href);
  value.pathname = value.pathname.replace(/\/models\/?$/u, "");
  value.search = "";
  value.hash = "";
  return value.href.replace(/\/$/u, "");
}

/**
 * 没有 Provider 路由时只检查当前 Codex 主供应商。有路由时由 Host 把主供应商和
 * 当前会话可用的备用供应商一起交给 ProviderRouting.health 检查。
 */
export async function probeGatewayHealth(
  environment: NodeJS.ProcessEnv,
  options: GatewayHealthOptions = {},
): Promise<BuddyHealth> {
  const read = options.readConnection ?? readConnection;
  try {
    const connection = await read(homePath(environment.CODEX_HOME), environment);
    const url = baseUrl(connection.url);
    const result = await probeProviderHealth(url, connection.headers, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      modelsUrl: connection.url.href,
    });
    return buddyHealthSchema.parse({
      supported: true,
      healthy: result.healthy,
      checkedAt: Date.now(),
      status: result.status,
      reason: result.reason,
      providers: [
        {
          id: connection.providerId,
          name: connection.providerId,
          baseUrl: url,
          fallback: false,
          healthy: result.healthy,
          status: result.status,
          reason: result.reason,
        },
      ],
    });
  } catch (error) {
    return buddyHealthSchema.parse({
      supported: true,
      healthy: false,
      checkedAt: Date.now(),
      status: null,
      reason: error instanceof Error ? error.message : String(error),
      providers: [],
    });
  }
}
