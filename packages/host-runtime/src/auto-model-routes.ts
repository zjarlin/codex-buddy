import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  autoModelRouteListSchema,
  autoModelRoutesParamsSchema,
  type AutoModelRoutesResult,
} from "@codexhost/shared-contracts";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function readAutoModelRoutes(input: {
  params: unknown;
  environment: NodeJS.ProcessEnv;
  privateMode: () => Promise<boolean | undefined>;
  readThread: (threadId: string) => Promise<unknown>;
}): Promise<AutoModelRoutesResult> {
  const { threadId, runId } = autoModelRoutesParamsSchema.parse(input.params);
  if (await input.privateMode()) {
    return { supported: false, routes: [] };
  }
  const response = record(await input.readThread(threadId));
  const thread = record(record(response?.result)?.thread);
  if (!thread || thread.id !== threadId || typeof thread.modelProvider !== "string") {
    throw new Error("Auto route Thread ownership is unavailable");
  }
  if (thread.modelProvider === "codexhost") {
    return { supported: false, routes: [] };
  }
  let connection;
  try {
    connection = await readConnection(
      homePath(input.environment.CODEX_HOME),
      input.environment,
      thread.modelProvider,
    );
  } catch {
    throw new Error("Auto route Provider connection is unavailable");
  }
  const url = new URL(connection.url);
  if (url.hostname === "api.openai.com") {
    return { supported: false, routes: [] };
  }
  url.pathname = url.pathname.replace(/\/models$/, "/auto/routes");
  url.searchParams.set("session_id", threadId);
  if (runId) url.searchParams.set("run_id", runId);
  if (await input.privateMode()) {
    return { supported: false, routes: [] };
  }
  let result: AutoModelRoutesResult;
  try {
    const response = await fetch(url, {
      headers: connection.headers,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404 || response.status === 405) {
      await response.body?.cancel();
      return { supported: false, routes: [] };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error("Response too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const parsed = autoModelRouteListSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (
      parsed.data.some(
        (route) =>
          route.session_id !== threadId ||
          (route.run_id !== undefined && route.run_id !== route.turn_id) ||
          (runId !== undefined && route.turn_id !== runId),
      )
    ) {
      throw new Error("Mismatched Thread");
    }
    result = { supported: true, routes: parsed.data };
  } catch {
    // 不把上游正文、URL 或认证信息透传给 Renderer。
    throw new Error("Unable to read Auto route observations from Provider");
  }
  if (await input.privateMode()) return { supported: false, routes: [] };
  return result;
}
