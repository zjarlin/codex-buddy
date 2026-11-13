import type { RendererThreadTurnState } from "../renderer-model-client.js";
import { isMissingNativeThreadError } from "../renderer-native-thread.js";

/** 一次清理最多核对的记录数：单击不该把连接上全部历史同时打满。 */
export const INTERRUPTED_SWEEP_LIMIT = 200;
const SWEEP_CONCURRENCY = 3;

/**
 * 按原生状态判定一条队列记录是否还该留在队列里：
 * - `archived`：rollout 已移入 archived_sessions，用户已经处理过；
 * - `subagent`：父会话派生的执行单元，没有独立会话语义；
 * - `gone`：原生明确报告会话不存在（rollout 丢失或被删除）；
 * - `keep`：可恢复的中断，原样保留；
 * - `unreadable`：超时、断连等暂时读不到，保留记录等下次再试。
 */
export type SweepVerdict = "archived" | "subagent" | "gone" | "keep" | "unreadable";

export interface SweepCandidate {
  threadId: string;
}

export interface SweepResult<T extends SweepCandidate> {
  verdicts: { entry: T; verdict: SweepVerdict }[];
  /** 本轮没有核对到的记录数，供调用方提示用户是否再点一次。 */
  unchecked: number;
}

// 判定逻辑与队列存储解耦：调用方负责读取原生状态和落墓碑，这里只做分批与归类。
export async function classifyInterruptedRecords<T extends SweepCandidate>(
  candidates: readonly T[],
  readState: (threadId: string) => Promise<RendererThreadTurnState>,
  options: { limit?: number; shouldContinue?: () => boolean } = {},
): Promise<SweepResult<T>> {
  const limit = options.limit ?? INTERRUPTED_SWEEP_LIMIT;
  const shouldContinue = options.shouldContinue ?? (() => true);
  const batch = candidates.slice(0, limit);
  const verdicts: SweepResult<T>["verdicts"] = [];
  for (let index = 0; index < batch.length; index += SWEEP_CONCURRENCY) {
    if (!shouldContinue()) break;
    const settled = await Promise.all(
      batch.slice(index, index + SWEEP_CONCURRENCY).map(async (entry) => {
        try {
          const state = await readState(entry.threadId);
          const verdict: SweepVerdict = state.archived
            ? "archived"
            : state.subagent
              ? "subagent"
              : "keep";
          return { entry, verdict };
        } catch (failure) {
          return {
            entry,
            verdict: isMissingNativeThreadError(failure) ? "gone" : "unreadable",
          } satisfies { entry: T; verdict: SweepVerdict };
        }
      }),
    );
    if (!shouldContinue()) break;
    verdicts.push(...settled);
  }
  // 连接中途断开时没扫到的条目也算未核对，面板据此提示用户再点一次。
  return { verdicts, unchecked: Math.max(0, candidates.length - verdicts.length) };
}
