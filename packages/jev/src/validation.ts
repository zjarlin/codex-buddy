import { isDeepStrictEqual } from "node:util";

import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { z } from "zod";

const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability,
    probabilities,
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: probability,
    probabilities,
    legend: z.record(z.string(), z.json()),
  }),
]);
const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

/** 协议异常仅报告位置，避免把用户 state 或服务端正文写入诊断日志。 */
export class JevResponseError extends Error {
  constructor(message: string) {
    super(`Invalid Jev response: ${message}`);
    this.name = "JevResponseError";
  }
}

function sameKeys(value: object, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateDistribution(value: Record<string, number>, keys: string[], id: string): void {
  const sum = Object.values(value).reduce((total, entry) => total + entry, 0);
  if (!sameKeys(value, keys) || Math.abs(sum - 1) > 0.0001) {
    throw new JevResponseError(`question ${JSON.stringify(id)} has an invalid distribution`);
  }
}

export function validateResponse<Q extends Questions>(
  response: unknown,
  questions: Q,
): SystemOneResult<Q> {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) {
    throw new JevResponseError("answer or metadata fields do not match the System One schema");
  }
  const result = parsed.data;
  if (!sameKeys(result.answers, Object.keys(questions))) {
    throw new JevResponseError("answer ids do not match question ids");
  }
  for (const [id, question] of Object.entries(questions)) {
    const answer = result.answers[id];
    if (!answer || answer.type !== question.type) {
      throw new JevResponseError(`question ${JSON.stringify(id)} has the wrong answer type`);
    }
    if (answer.type === "choice" && question.type === "choice") {
      validateDistribution(answer.probabilities, Object.keys(question.criteria), id);
      const selected = answer.probabilities[answer.choice];
      if (
        !Object.hasOwn(question.criteria, answer.choice) ||
        selected === undefined ||
        selected + 0.0001 < Math.max(...Object.values(answer.probabilities))
      ) {
        throw new JevResponseError(`question ${JSON.stringify(id)} selected an invalid option`);
      }
    }
    if (answer.type === "score" && question.type === "score") {
      const keys = question.criteria.map((_, index) => String(index));
      validateDistribution(answer.probabilities, keys, id);
      if (
        answer.score < 0 ||
        answer.score > question.criteria.length - 1 ||
        !sameKeys(answer.legend, keys) ||
        !question.criteria.every((entry, index) => isDeepStrictEqual(entry, answer.legend[index]))
      ) {
        throw new JevResponseError(`question ${JSON.stringify(id)} has an invalid score or legend`);
      }
    }
  }
  // 问题 id、类型和 rubric 已逐项校验，恢复 SDK 根据问题推导的精确返回类型。
  return result as SystemOneResult<Q>;
}
