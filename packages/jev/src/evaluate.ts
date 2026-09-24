import type {
  Questions,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

import { assessAnswer, validatePolicy } from "./policy.js";
import type { DecisionAssessment, DecisionPolicy } from "./policy.js";
import { validateResponse } from "./validation.js";

export type DecisionPolicies<Q extends Questions> = {
  readonly [K in keyof Q]: DecisionPolicy;
};

export type JevEvaluation<Q extends Questions> = SystemOneResult<Q> & {
  readonly decisions: { readonly [K in keyof Q]: DecisionAssessment };
};

/** 一次批量评估并应用本地阈值；不执行动作、不推断授权，失败直接交回调用者。 */
export async function evaluateDecisions<const Q extends Questions>(
  client: Pick<TypeSafeClient, "systemOne">,
  request: SystemOneRequest<Q>,
  policies: DecisionPolicies<NoInfer<Q>>,
  options: RequestOptions = {},
): Promise<JevEvaluation<Q>> {
  // 固定本次调用的输入快照，防止等待网络期间的对象修改改变校验或阈值。
  const { state, questions, model } = structuredClone(request);
  const policySnapshot = structuredClone(policies);
  for (const [id, question] of Object.entries(questions)) {
    const policy = Object.hasOwn(policySnapshot, id) ? policySnapshot[id] : undefined;
    validatePolicy(policy, question.type === "noul");
    if (question.type === "choice") {
      const count = Object.keys(question.criteria).length;
      if (count < 1 || count > 255) {
        throw new Error("Jev Choice requires between 1 and 255 options.");
      }
    }
  }
  options.signal?.throwIfAborted();
  const response = await client.systemOne(
    { state, questions, ...(model === undefined ? {} : { model }) },
    options,
  );
  options.signal?.throwIfAborted();
  const result = validateResponse(response, questions);
  const decisions = Object.fromEntries(
    Object.entries(result.answers).map(([id, answer]) => {
      const policy = policySnapshot[id];
      if (!policy) {
        throw new Error("Jev decision policy is missing.");
      }
      return [id, assessAnswer(answer, policy)];
    }),
  ) as JevEvaluation<Q>["decisions"];
  return { ...result, decisions };
}
