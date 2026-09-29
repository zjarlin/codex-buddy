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

const automaticThreshold = 0.82;

/** Select a previously used Codex Thread without granting any execution authority. */
export async function chooseSessionWithSystemOne(
  client: TypeSafeClient,
  input: { message: string; candidates: readonly SessionRouteCandidate[]; model: string },
  signal?: AbortSignal,
): Promise<SessionRouteDecision | null> {
  if (input.candidates.length === 0) return null;
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
    return null;
  }
  const index = Number(answer.choice.slice(1));
  const candidate = Number.isInteger(index) ? candidates[index] : undefined;
  if (!candidate) return null;
  return {
    threadId: candidate.id,
    title: candidate.title,
    cwd: candidate.cwd,
    confidence,
    reason: `System One 选择了 ${candidate.title ?? candidate.id}（confidence=${confidence.toFixed(2)}）`,
  };
}
