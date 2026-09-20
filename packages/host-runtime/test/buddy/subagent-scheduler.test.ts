import { describe, expect, it } from "vitest";
import { executePlanWaves, summarizeSubagentResults } from "../../src/buddy/subagent-scheduler.js";
import { validatePlan } from "../../src/buddy/plan-graph.js";

const task = (id: string, dependsOn: string[] = []) => ({
  id,
  title: id,
  objective: `完成 ${id}`,
  kind: "implement",
  steps: [`执行 ${id}`],
  acceptance: [`验收 ${id}`],
  dependsOn,
  files: [`${id}.ts`],
  packages: [],
  writeScope: "disjoint",
  executorRole: "executor",
  risk: "low",
  parallelizable: true,
});

const plan = validatePlan({
  version: 1,
  goal: "goal",
  diagnosis: { problem: "problem", evidence: [], rootCause: "cause", solution: "solution" },
  architecture: { recommendations: [], naming: [], placement: [], boundaries: [] },
  constraints: [],
  tasks: [task("alpha"), task("bravo"), task("final", ["alpha", "bravo"])],
  checks: ["done"],
  clarification: null,
  execution: { delegateIndependentTasks: true, maxParallel: 2, delegationReason: "independent" },
});

describe("buddy subagent scheduler", () => {
  it("runs independent tasks concurrently and waits for the next wave", async () => {
    const active = { count: 0, max: 0 };
    const order: string[] = [];
    const results = await executePlanWaves({
      plan,
      candidates: [
        { id: "cheap-a", capability: 60, economy: 90, level: "simple" },
        { id: "cheap-b", capability: 60, economy: 80, level: "simple" },
      ],
      parentThreadId: "parent",
      cwd: "/tmp/project",
      signal: new AbortController().signal,
      run: async ({ task, model }) => {
        active.count += 1;
        active.max = Math.max(active.max, active.count);
        order.push(`${model}:${task.includes("alpha") ? "alpha" : "bravo"}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active.count -= 1;
        return { taskId: task.includes("alpha") ? "alpha" : "bravo", model, status: "completed", summary: "ok" };
      },
    });
    expect(active.max).toBe(2);
    expect(results).toHaveLength(2);
    expect(order).toEqual(["cheap-a:alpha", "cheap-b:bravo"]);
    expect(summarizeSubagentResults(results)).toContain("alpha");
  });
});
