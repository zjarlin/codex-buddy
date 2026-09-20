import { describe, expect, it } from "vitest";
import { formatExecutionTopology, validatePlan } from "../../src/buddy/plan-graph.js";

const task = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: id,
  objective: `完成 ${id}`,
  kind: "implement",
  steps: [`执行 ${id}`],
  acceptance: [`验收 ${id}`],
  dependsOn: [],
  files: [`packages/${id}.ts`],
  packages: ["host-runtime"],
  writeScope: "disjoint",
  executorRole: "executor",
  risk: "low",
  parallelizable: true,
  ...overrides,
});

const plan = (tasks: unknown[]) => ({
  version: 1,
  goal: "完成任务",
  diagnosis: { problem: "问题", evidence: [], rootCause: "根因", solution: "方案" },
  architecture: { recommendations: [], naming: [], placement: [], boundaries: [] },
  constraints: [],
  tasks,
  checks: ["通过测试"],
  clarification: null,
  execution: { delegateIndependentTasks: true, maxParallel: 3, delegationReason: "任务独立" },
});

describe("buddy plan graph", () => {
  it("topologically orders dependent tasks and keeps independent tasks in one wave", () => {
    const result = validatePlan(
      plan([
        task("write-api"),
        task("write-ui", { dependsOn: ["write-api"] }),
        task("inspect-docs", { kind: "inspect" }),
      ]),
    );
    expect(result.waves.map((wave) => wave.tasks.map((item) => item.id))).toEqual([
      ["write-api", "inspect-docs"],
      ["write-ui"],
    ]);
    expect(formatExecutionTopology(result)).toContain("wave-1: write-api (executor), inspect-docs (executor)");
  });

  it("rejects cycles and overlapping writes in a parallel wave", () => {
    expect(() => validatePlan(plan([task("aa", { dependsOn: ["bb"] }), task("bb", { dependsOn: ["aa"] })]))).toThrow(
      "循环依赖",
    );
    expect(() =>
      validatePlan(
        plan([
          task("aa", { files: ["shared.ts"] }),
          task("bb", { files: ["shared.ts"] }),
        ]),
      ),
    ).toThrow("写入范围重叠");
  });
});
