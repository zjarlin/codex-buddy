import { nativeContinuationPrompt, type BuddyInterrupted } from "@codexhost/shared-contracts";
import { assertNativeCodexThread, isSubagentNativeThread } from "./renderer-native-thread.js";

type InterruptedThread = BuddyInterrupted["threads"][number];
interface ThreadTurn {
  thread: Record<string, unknown> | null;
  turn: Record<string, unknown> | null;
  status: InterruptedThread["status"] | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// 与当前 Host 连接共用读取与发送函数；侧栏和面板共享防重状态。
export function createNativeContinuation(options: {
  sendRequest(method: string, params: unknown): Promise<unknown>;
  readThread(threadId: string): Promise<ThreadTurn>;
}) {
  const pending = new Set<string>();
  const submitted = new Map<string, string>();
  let listing: Promise<BuddyInterrupted> | null = null;

  async function listThreadIds(): Promise<string[]> {
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = record(
        await options.sendRequest("thread/list", {
          limit: 100,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived: false,
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (!Array.isArray(page.data)) {
        throw new Error("thread/list returned invalid conversation data");
      }
      for (const entry of page.data) {
        const id = record(entry).id;
        if (typeof id !== "string" || !id) {
          throw new Error("thread/list returned an invalid conversation ID");
        }
        ids.add(id);
      }
      if (ids.size > 2_000) {
        throw new Error("thread/list exceeded the recovery scan item limit");
      }
      if (page.nextCursor === null || page.nextCursor === undefined) {
        return [...ids];
      }
      if (typeof page.nextCursor !== "string" || !page.nextCursor || cursors.has(page.nextCursor)) {
        throw new Error("thread/list returned an invalid or repeated cursor");
      }
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error("thread/list exceeded the recovery scan page limit");
  }

  async function readCandidate(threadId: string) {
    const value = await options.readThread(threadId);
    if (value.thread?.modelProvider === "codexhost" || value.thread?.cliVersion === "codexhost") {
      return null;
    }
    // subagent 由父会话派生，不接受直接输入，不属于可恢复会话。
    if (isSubagentNativeThread(value.thread)) return null;
    assertNativeCodexThread(value.thread, threadId);
    const activity = record(value.thread.status).type;
    // 只接受官方已知状态；无法识别时不能安全地假定会话已经停下。
    if (
      activity !== "active" &&
      activity !== "idle" &&
      activity !== "notLoaded" &&
      activity !== "systemError"
    ) {
      throw new Error("无法确认会话运行状态，请刷新后重试。");
    }
    return { ...value, thread: value.thread, running: activity === "active" };
  }

  async function discover(threadId?: string): Promise<BuddyInterrupted> {
    // 单会话核对只读目标会话，避免打开会话时遍历全部历史。
    const ids = threadId ? [threadId] : await listThreadIds();
    const entries = new Array<InterruptedThread | null>(ids.length).fill(null);
    const running = new Set<string>();
    let unreadable = 0;
    const candidates = ids.entries();
    const worker = async () => {
      while (true) {
        const entry = candidates.next();
        if (entry.done) {
          return;
        }
        const [index, threadId] = entry.value;
        try {
          const candidate = await readCandidate(threadId);
          if (!candidate) {
            continue;
          }
          const { thread, turn, status, running: active } = candidate;
          if (active || pending.has(threadId)) {
            running.add(threadId);
          } else if (status && typeof turn?.id === "string" && turn.id) {
            entries[index] = {
              threadId,
              turnId: turn.id,
              title: String(thread.name || thread.preview || threadId).slice(0, 160),
              status,
              owner: "codex",
            };
          }
        } catch {
          // 单条不可读不阻断其他记录，但必须向面板报告遗漏数量。
          unreadable += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    return {
      threads: entries.filter((entry): entry is InterruptedThread => entry !== null),
      runningThreadIds: [...running],
      unreadable,
    };
  }

  return {
    list(threadId?: string): Promise<BuddyInterrupted> {
      // 单会话核对不共享全量扫描缓存，避免把其他会话的旧结果带进队列。
      if (threadId) return discover(threadId);
      listing ??= discover().finally(() => {
        listing = null;
      });
      return listing;
    },
    async continue(threadId: string, turnId: string, model?: string): Promise<void> {
      if (pending.has(threadId)) {
        throw new Error("该会话正在续接，请勿重复点击。");
      }
      if (submitted.get(threadId) === turnId) {
        throw new Error("该回合已提交过续接，请先检查原会话，勿重复发送。");
      }
      pending.add(threadId);
      try {
        const verify = async () => {
          const candidate = await readCandidate(threadId);
          if (!candidate) {
            throw new Error("仅支持恢复 Codex 原生会话。");
          }
          const { turn, status, running } = candidate;
          if (running) {
            throw new Error("该会话仍在运行。");
          }
          if (turn?.id !== turnId || status === null) {
            throw new Error("会话状态已改变，请刷新列表。");
          }
        };
        await verify();
        // 原生 resume 恢复模型、工作目录和权限；前后复核最新回合。
        await options.sendRequest("thread/resume", { threadId });
        await verify();
        // 发送后结果可能因断连而未知，同一连接内不重发这个中断回合。
        submitted.set(threadId, turnId);
        const response = record(
          await options.sendRequest("turn/start", {
            threadId,
            input: [{ type: "text", text: nativeContinuationPrompt }],
            ...(model ? { model, effort: null } : {}),
          }),
        );
        const accepted = record(response.turn).id;
        if (typeof accepted !== "string" || !accepted.trim()) {
          throw new Error("续接结果未确认，请检查原会话，勿重复发送。");
        }
      } finally {
        pending.delete(threadId);
      }
    },
  };
}
