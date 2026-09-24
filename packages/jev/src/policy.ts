import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";

export interface DecisionPolicy {
  /** 达到此阈值才可自动采用判断；不授予工具执行权限。 */
  readonly automatic: number;
  /** 达到此阈值需复核，低于此阈值交回调用者兜底。 */
  readonly review: number;
}

export interface DecisionAssessment {
  readonly status: "automatic" | "review" | "defer";
  /** Noul 使用所选真假结果的概率，Choice 同时约束置信度与所选概率。 */
  readonly basis: "outcome-probability" | "confidence-and-probability" | "confidence";
  readonly strength: number;
}

export function validatePolicy(policy: DecisionPolicy | undefined, noul: boolean): void {
  if (
    !policy ||
    !Number.isFinite(policy.automatic) ||
    !Number.isFinite(policy.review) ||
    policy.automatic > 1 ||
    policy.review < 0 ||
    policy.review >= policy.automatic ||
    (noul && policy.review <= 0.5)
  ) {
    throw new Error(
      "Jev policy requires 0 <= review < automatic <= 1; Noul review must exceed 0.5.",
    );
  }
}

export function assessAnswer(
  answer: ChoiceResponse | ScoreResponse | NoulResponse,
  policy: DecisionPolicy,
): DecisionAssessment {
  let strength: number;
  let basis: DecisionAssessment["basis"];
  switch (answer.type) {
    case "noul":
      strength = Math.max(answer.noul, 1 - answer.noul);
      basis = "outcome-probability";
      break;
    case "choice":
      strength = Math.min(answer.confidence, answer.probabilities[answer.choice] ?? 0);
      basis = "confidence-and-probability";
      break;
    case "score":
      strength = answer.confidence;
      basis = "confidence";
      break;
  }
  const status =
    strength >= policy.automatic ? "automatic" : strength >= policy.review ? "review" : "defer";
  return { status, basis, strength };
}
