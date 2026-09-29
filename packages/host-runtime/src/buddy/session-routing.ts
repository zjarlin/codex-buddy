import { choice, evaluateDecisions, type TypeSafeClient } from "@codexhost/jev";

export interface SessionRouteCandidate {
  id: string;
  title: string | null;
  cwd: string;
  recent: string;
}

export interface SessionRouteDecision {
  threadId: string;
  title: string | null;
  cwd: string;
  confidence: number;
  reason: string;
}

export interface SessionRouteResult {
  candidates: Array<Omit<SessionRouteDecision, "reason"> & { preview: string }>;
  reason: string;
}

const automaticThreshold = 0.82;

/** Select a previously used Codex Thread without granting any execution authority. */
export async function chooseSessionWithSystemOne(
  client: TypeSafeClient,
  input: { message: string; candidates: readonly SessionRouteCandidate[]; model: string },
  signal?: AbortSignal,
): Promise<SessionRouteResult> {
  if (input.candidates.length === 0) return { candidates: [], reason: "没有可用的近期会话。" };
  const candidates = input.candidates.slice(0, 32);
  const criteria: Record<string, string> = {
    none: "没有足够把握，保留为新会话",
  };
  candidates.forEach((candidate, index) => {
    criteria[`c${index}`] = [
      candidate.title ? `标题：${candidate.title}` : "无标题",
      `项目：${candidate.cwd}`,
      candidate.recent ? `近期上下文：${candidate.recent}` : "近期上下文为空",
    ].join("\n");
  });
  const result = await evaluateDecisions(
    client,
    {
      model: input.model,
      state: {
        message: input.message.slice(0, 12_000),
        candidates: candidates.map(({ title, cwd, recent }, index) => ({
          id: `c${index}`,
          title,
          cwd,
          recent,
        })),
      },
      questions: {
        session: choice(
          "这条新消息最适合继续哪个已有 Codex 会话？只有上下文明确相关时才选择会话，否则选择 none。",
          criteria,
        ),
      },
    },
    { session: { automatic: automaticThreshold, review: 0.68 } },
    { timeout: 4_000, ...(signal ? { signal } : {}) },
  );
  const answer = result.answers.session;
  const confidence = result.decisions.session.strength;
  if (
    answer.choice === "none" ||
    result.decisions.session.status !== "automatic" ||
    !answer.probabilities[answer.choice]
  ) {
    return { candidates: [], reason: "System One 无法确认候选会话。" };
  }
  const index = Number(answer.choice.slice(1));
  const candidate = Number.isInteger(index) ? candidates[index] : undefined;
  if (!candidate) return { candidates: [], reason: "System One 返回了无效的会话候选。" };
  const scored = candidates.map((item, candidateIndex) => ({
    threadId: item.id,
    title: item.title,
    cwd: item.cwd,
    confidence: candidateIndex === index ? confidence : answer.probabilities[`c${candidateIndex}`] ?? 0,
    preview: item.recent,
  }));
  scored.sort((left, right) => right.confidence - left.confidence);
  return {
    candidates: scored,
    reason: `System One 已完成候选排序，最高置信度 ${confidence.toFixed(2)}。`,
  };
}
