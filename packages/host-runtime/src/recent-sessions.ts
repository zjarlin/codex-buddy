import type { SessionRouteResult } from "@codexhost/shared-contracts";
import { object, result, type NativeRequest } from "./buddy/planner.js";

/** 近期列表来自原生历史；只有最后一轮已完成的会话才作为续接目标。 */
export async function recentCompletedSessions(request: NativeRequest): Promise<SessionRouteResult> {
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
        if (error.code === -32601 || error.message === "thread/turns/list is not supported yet") {
          const legacy = result(
            await request("thread/read", { threadId: row.id, includeTurns: true }),
          );
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
        if (turn.status !== "completed" && turn.status !== "succeeded") {
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
  return { candidates, reason: "Recent completed conversations" };
}
