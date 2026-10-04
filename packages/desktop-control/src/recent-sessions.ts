import type { SessionRouteResult } from "@codexhost/shared-contracts";

/** 原生历史里已停止的最末回合状态；运行中的 `inProgress` 不属于可续接目标。 */
const stoppedTurnStatuses = new Set([
  "completed",
  "succeeded",
  "interrupted",
  "failed",
  "cancelled",
]);

export type RecentSessionsRequest = (
  method: string,
  params: Record<string, string | number | boolean>,
) => Promise<{ result?: unknown; error?: unknown }>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function result(response: Awaited<ReturnType<RecentSessionsRequest>>): Record<string, unknown> {
  if (response.error) {
    throw new Error(`App Server 拒绝请求：${String(object(response.error).message ?? "unknown")}`);
  }
  return object(response.result);
}

/**
 * 近期列表来自原生历史；最后一轮已停止（完成/中断/失败/取消）的会话都可作为续接目标，
 * 因为它们不再运行且可直接输入。只有仍在运行的会话会被排除。
 */
export async function recentCompletedSessions(
  request: RecentSessionsRequest,
): Promise<SessionRouteResult> {
  const page = result(
    await request("thread/list", {
      limit: 80,
      archived: false,
      sortKey: "updated_at",
      sortDirection: "desc",
    }),
  );
  if (!Array.isArray(page.data)) {
    throw new Error("Unable to list recent Threads");
  }
  const rows = page.data.slice(0, 80);
  const candidates: SessionRouteResult["candidates"] = [];
  // 分批读取，保留原生更新时间顺序，同时避免逐条串行等待。
  for (let offset = 0; offset < rows.length && candidates.length < 32; offset += 8) {
    const batch = await Promise.all(
      rows.slice(offset, offset + 8).map(async (value) => {
        const row = object(value);
        if (
          typeof row.id !== "string" ||
          typeof row.cwd !== "string" ||
          !row.cwd ||
          row.canAcceptDirectInput === false ||
          object(row.status).type === "active"
        ) {
          return null;
        }
        const response = await request("thread/turns/list", {
          threadId: row.id,
          limit: 1,
          sortDirection: "desc",
          itemsView: "notLoaded",
        });
        const error = object(response.error);
        let turn: Record<string, unknown>;
        const unsupported =
          error.code === -32601 ||
          error.message === "thread/turns/list is not supported yet" ||
          (error.code === -32600 &&
            typeof error.message === "string" &&
            error.message.includes("unknown variant `thread/turns/list`"));
        if (unsupported) {
          const legacyResponse = await request("thread/read", {
            threadId: row.id,
            includeTurns: true,
          });
          const legacyError = object(legacyResponse.error);
          // 旧版完整历史接口也会遇到首条消息之前尚未物化的草稿。
          if (
            typeof legacyError.message === "string" &&
            legacyError.message.endsWith(
              "is not materialized yet; includeTurns is unavailable before first user message",
            )
          ) {
            return null;
          }
          const legacy = result(legacyResponse);
          const thread = object(legacy.thread);
          if (thread.id !== row.id || object(thread.status).type === "active") {
            return null;
          }
          turn = object(Array.isArray(thread.turns) ? thread.turns.at(-1) : null);
        } else {
          // 新草稿尚未物化时没有历史，不能让它阻断其他近期候选。
          if (
            typeof error.message === "string" &&
            error.message.includes("is not materialized yet")
          ) {
            return null;
          }
          const history = result(response);
          turn = object(Array.isArray(history.data) ? history.data[0] : null);
        }
        // 已停止且可直接输入的会话都可续接；inProgress 仍在运行，不能作为转移目标。
        if (!stoppedTurnStatuses.has(String(turn.status))) {
          return null;
        }
        return {
          threadId: row.id,
          title:
            typeof row.name === "string"
              ? row.name
              : typeof row.title === "string"
                ? row.title
                : null,
          cwd: row.cwd,
          confidence: null,
          preview: typeof row.preview === "string" ? row.preview.slice(-4_000) : "",
        };
      }),
    );
    for (const candidate of batch) {
      if (candidate && candidates.length < 32) {
        candidates.push(candidate);
      }
    }
  }
  return { candidates, reason: "Recent stopped conversations" };
}
