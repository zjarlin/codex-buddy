import type { JsonObject } from "@codexhost/protocol-core";
import { object, result, type NativeRequest } from "./planner.js";

export async function recentMessages(request: NativeRequest, threadId: string): Promise<unknown[]> {
  const metadata = result(await request("thread/read", { threadId, includeTurns: false }));
  const thread = object(metadata.thread);
  if (thread.ephemeral === true) {
    return [];
  }
  // 空白非分叉任务在首条消息之前尚无 rollout，不能调用依赖历史文件的接口。
  if (thread.preview === "" && thread.forkedFromId === null && typeof thread.path === "string") {
    try {
      await stat(thread.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
  const response = await request("thread/items/list", {
    threadId,
    limit: 64,
    sortDirection: "desc",
  });
  const error = object(response.error);
  const unsupported =
    error.code === -32601 || error.message === "thread/items/list is not supported yet";
  let items: unknown[];
  if (unsupported) {
    // 旧版 App Server 没有分页接口，改从完整回合中提取相同的消息窗口。
    const legacy = await request("thread/read", { threadId, includeTurns: true });
    const legacyError = object(legacy.error);
    // 首条用户消息之前尚未物化的线程没有历史，不应因此阻止首次发送。
    if (
      typeof legacyError.message === "string" &&
      legacyError.message.endsWith(
        "is not materialized yet; includeTurns is unavailable before first user message",
      )
    ) {
      return [];
    }
    const history = result(legacy);
    const turns = object(history.thread).turns;
    items = Array.isArray(turns)
      ? turns.flatMap((turn: JsonObject) => (Array.isArray(turn.items) ? turn.items : []))
      : [];
  } else {
    const history = result(response);
    const descending = Array.isArray(history.data) ? [...history.data] : [];
    let cursor = history.nextCursor;
    // 工具输出可能淹没最近一页；有限翻页以找到之前的任务和方案。
    for (let page = 1; page < 4 && typeof cursor === "string" && cursor; page += 1) {
      if (descending.filter(isContextMessage).length >= 12) break;
      const next = result(
        await request("thread/items/list", {
          threadId,
          limit: 64,
          sortDirection: "desc",
          cursor,
        }),
      );
      if (Array.isArray(next.data)) descending.push(...next.data);
      if (next.nextCursor === cursor) break;
      cursor = next.nextCursor;
    }
    items = descending.reverse();
  }
  return items.filter(isContextMessage).slice(-12);
}

function isContextMessage(item: unknown): boolean {
  return ["userMessage", "agentMessage", "contextCompaction", "compaction"].includes(
    String(object(item).type),
  );
}
import { stat } from "node:fs/promises";
