import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const score = z.number().min(0).max(100);
const modelAssessment = z.object({
  capability: score.optional(),
  economy: score.optional(),
  purpose: z.enum(["general", "specialized", "unknown"]).optional(),
  tools: z.boolean().nullable().optional(),
});
const clientCapabilities = z.object({
  observedAt: z.string(),
  models: z.array(z.object({ id: z.string(), efforts: z.array(z.string()) })),
});
const policySchema = z.object({
  models: z.record(z.string(), modelAssessment).default({}),
  capabilityThresholds: z.object({ standard: score.default(70) }).default({ standard: 70 }),
  planning: z
    .object({
      plannerModel: z.string().nullable().optional(),
      executorCapabilities: clientCapabilities.optional(),
    })
    .optional(),
});
const adviceSchema = z.object({
  at: z.number(),
  binding: z.string(),
  provider: z.string(),
  endpoint: z.string(),
  models: z.array(modelAssessment.extend({ id: z.string() })),
});

export interface SelectionPolicy {
  assessments: Map<string, z.infer<typeof modelAssessment>>;
  standardThreshold: number;
  planner?: string | null;
  clientModels: Map<string, string[]>;
}

async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new Error("无法读取 Buddy 模型选择策略。");
  }
}

export async function readSelectionPolicy(
  home: string,
  connection: { providerId: string; url: URL; headers: Headers },
  now = Date.now(),
): Promise<SelectionPolicy> {
  const directory = join(home, "model-router");
  const policy = policySchema.parse((await optionalJson(join(directory, "policy.json"))) ?? {});
  const advice = adviceSchema.safeParse(await optionalJson(join(directory, "advice.json")));
  const assessments: SelectionPolicy["assessments"] = new Map();
  const fresh = (at: number): boolean => at <= now && now - at < 24 * 60 * 60 * 1000;
  // 与现有 Buddy 建议文件的供应商和账号绑定算法保持一致，不暴露认证头。
  const binding = createHash("sha256")
    .update(`${connection.url.origin}\n${connection.headers.get("authorization") ?? ""}`)
    .digest("hex");
  if (
    advice.success &&
    fresh(advice.data.at) &&
    advice.data.binding === binding &&
    advice.data.provider === connection.providerId &&
    advice.data.endpoint === connection.url.href
  ) {
    for (const model of advice.data.models) {
      assessments.set(model.id, model);
    }
  }
  for (const [id, override] of Object.entries(policy.models)) {
    assessments.set(id, { ...assessments.get(id), ...override });
  }
  const capabilities = policy.planning?.executorCapabilities;
  const clientModels = new Map<string, string[]>();
  if (capabilities && fresh(Date.parse(capabilities.observedAt))) {
    for (const model of capabilities.models) {
      clientModels.set(model.id, model.efforts);
    }
  }
  return {
    assessments,
    standardThreshold: policy.capabilityThresholds.standard,
    planner: policy.planning?.plannerModel ?? null,
    clientModels,
  };
}
