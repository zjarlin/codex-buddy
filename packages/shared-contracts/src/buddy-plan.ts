import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const taskId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

export const buddyPlanTaskSchema = z.object({
  id: taskId,
  title: nonEmpty.max(120),
  objective: nonEmpty.max(1000),
  kind: z.enum(["inspect", "implement", "test", "docs", "release"]),
  steps: z.array(nonEmpty.max(500)).min(1).max(12),
  acceptance: z.array(nonEmpty.max(500)).min(1).max(12),
  dependsOn: z.array(taskId).max(32),
  files: z.array(nonEmpty.max(300)).max(80),
  packages: z.array(nonEmpty.max(160)).max(20),
  writeScope: z.enum(["none", "disjoint", "shared-coordination"]),
  executorRole: z.enum(["io", "git", "executor"]),
  risk: z.enum(["low", "medium", "high"]),
  parallelizable: z.boolean(),
});

export const buddyPlanSchema = z.object({
  version: z.literal(1),
  goal: nonEmpty.max(2000),
  diagnosis: z.object({
    problem: nonEmpty.max(2000),
    evidence: z.array(nonEmpty.max(1000)).max(12),
    rootCause: nonEmpty.max(2000),
    solution: nonEmpty.max(3000),
  }),
  architecture: z.object({
    recommendations: z.array(nonEmpty.max(1000)).max(12),
    naming: z.array(nonEmpty.max(500)).max(12),
    placement: z.array(nonEmpty.max(1000)).max(12),
    boundaries: z.array(nonEmpty.max(1000)).max(12),
  }),
  constraints: z.array(nonEmpty.max(1000)).max(20),
  tasks: z.array(buddyPlanTaskSchema).min(1).max(32),
  checks: z.array(nonEmpty.max(1000)).min(1).max(20),
  clarification: z.string().trim().max(2000).nullable(),
  execution: z.object({
    delegateIndependentTasks: z.boolean(),
    maxParallel: z.number().int().min(1).max(3),
    delegationReason: nonEmpty.max(1000),
  }),
});

// 规划输出与运行时校验共用契约，确保所有嵌套对象都声明字段并禁止额外属性。
export const buddyPlanOutputSchema = z.toJSONSchema(buddyPlanSchema, { target: "draft-7" });

export type BuddyPlanTask = z.infer<typeof buddyPlanTaskSchema>;
export type BuddyPlan = z.infer<typeof buddyPlanSchema>;
