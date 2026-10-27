import { homePath, readConnection } from "@codexhost/buddy-engine";
import {
  turnAccountListSchema,
  turnAccountsParamsSchema,
  type TurnAccountsResult,
} from "@codexhost/shared-contracts";
import { readTurnWindow } from "./turn-window.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isoSeconds(epochSeconds: number | undefined): string | undefined {
  if (epochSeconds === undefined) return undefined;
  return new Date(epochSeconds * 1_000).toISOString().replace(".000Z", "Z");
}

// 网关只在 usage_logs 里按「会话 + 时间窗」记录账号，没有 turn_id 列。
// 因此这里把回合的起止时间作为窗口传过去，结果如实标注为窗口归属。
export async function readTurnAccounts(input: {
  params: unknown;
  environment: NodeJS.ProcessEnv;
  privateMode: () => Promise<boolean | undefined>;
  readThread: (threadId: string) => Promise<unknown>;
}): Promise<TurnAccountsResult> {
  const params = turnAccountsParamsSchema.parse(input.params);
  const { threadId, runId } = params;
  let { since, until } = params;
  if (await input.privateMode()) {
    return { supported: false, accounts: [], attribution: "unknown", unavailableReason: "private" };
  }
  const response = record(await input.readThread(threadId));
  const thread = record(record(response?.result)?.thread);
  if (!thread || thread.id !== threadId || typeof thread.modelProvider !== "string") {
    throw new Error("Turn account Thread ownership is unavailable");
  }
  if (thread.modelProvider === "codexhost") {
    return { supported: false, accounts: [], attribution: "unknown" };
  }
  // 回合起止时间来自该 Thread 自己的 rollout；读不到就退化成「会话最近一次请求」。
  if ((since === undefined || until === undefined) && runId && typeof thread.path === "string") {
    try {
      const window = await readTurnWindow({
        codexHome: homePath(input.environment.CODEX_HOME),
        threadPath: thread.path,
        threadId,
        runId,
      });
      since ??= window.since;
      until ??= window.until;
    } catch {
      // rollout 不可读时不声明归属精度，只按会话回查。
    }
  }
  let connection;
  try {
    connection = await readConnection(
      homePath(input.environment.CODEX_HOME),
      input.environment,
      thread.modelProvider,
    );
  } catch {
    throw new Error("Turn account Provider connection is unavailable");
  }
  const url = new URL(connection.url);
  if (url.hostname === "api.openai.com") {
    return {
      supported: false,
      accounts: [],
      attribution: "unknown",
      unavailableReason: "provider",
    };
  }
  url.pathname = url.pathname.replace(/\/models$/, "/turn/accounts");
  url.searchParams.set("session_id", threadId);
  const sinceIso = isoSeconds(since);
  const untilIso = isoSeconds(until);
  if (sinceIso) url.searchParams.set("since", sinceIso);
  if (untilIso) url.searchParams.set("until", untilIso);
  if (await input.privateMode()) {
    return { supported: false, accounts: [], attribution: "unknown", unavailableReason: "private" };
  }
  let result: TurnAccountsResult;
  try {
    const fetched = await fetch(url, {
      headers: connection.headers,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (fetched.status === 404 || fetched.status === 405) {
      await fetched.body?.cancel();
      return {
        supported: false,
        accounts: [],
        attribution: "unknown",
        unavailableReason: (await input.privateMode()) ? "private" : "provider",
      };
    }
    if (!fetched.ok) {
      await fetched.body?.cancel();
      throw new Error(`HTTP ${fetched.status}`);
    }
    const reader = fetched.body?.getReader();
    if (!reader) throw new Error("Empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512 * 1024) throw new Error("Response too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const parsed = turnAccountListSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    result = {
      supported: true,
      accounts: parsed.data,
      attribution: sinceIso || untilIso ? "window" : "unknown",
      ...(runId ? { runId } : {}),
    };
  } catch {
    if (await input.privateMode()) {
      return {
        supported: false,
        accounts: [],
        attribution: "unknown",
        unavailableReason: "private",
      };
    }
    // 不把上游正文、URL 或认证信息透传给 Renderer。
    throw new Error("Unable to read turn accounts from Provider");
  }
  if (await input.privateMode())
    return { supported: false, accounts: [], attribution: "unknown", unavailableReason: "private" };
  return result;
}
