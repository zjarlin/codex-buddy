import { expect, it } from "vitest";
import type { JsonObject } from "@codexhost/protocol-core";
import { BuddyPlanner, object } from "../../src/buddy/planner.js";

function verifyStrictObjects(value: unknown, path = "schema"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => verifyStrictObjects(item, `${path}[${index}]`));
    return;
  }
  const schema = object(value);
  if (schema.type === "object") {
    expect(schema.additionalProperties, path).toBe(false);
    const fields = Object.keys(object(schema.properties));
    expect(fields.length, path).toBeGreaterThan(0);
    expect(schema.required, path).toEqual(expect.arrayContaining(fields));
  }
  for (const [key, child] of Object.entries(schema)) {
    if (child !== null && typeof child === "object") {
      verifyStrictObjects(child, `${path}.${key}`);
    }
  }
}

it("sends a complete strict output schema and accepts the resulting native plan", async () => {
  const plan = {
    version: 1,
    goal: "检查 README",
    diagnosis: { problem: "确认内容", evidence: [], rootCause: "待检查", solution: "只读文件" },
    architecture: { recommendations: [], naming: [], placement: [], boundaries: [] },
    constraints: ["只读"],
    tasks: [
      {
        id: "read-readme",
        title: "检查 README",
        objective: "确认 README 包含 Buddy",
        kind: "inspect",
        steps: ["读取 README.md"],
        acceptance: ["内容包含 Buddy"],
        dependsOn: [],
        files: ["README.md"],
        packages: [],
        writeScope: "none",
        executorRole: "io",
        risk: "low",
        parallelizable: false,
      },
    ],
    checks: ["内容包含 Buddy"],
    clarification: null,
    execution: { delegateIndependentTasks: false, maxParallel: 1, delegationReason: "单项检查" },
  };
  let outputSchema: JsonObject | undefined;
  const planner = new BuddyPlanner(
    async (method, params) => {
      if (method === "thread/start") return { result: { thread: { id: "planner" } } };
      if (method === "turn/start") {
        outputSchema = params.outputSchema as JsonObject;
        planner.observe({
          method: "item/completed",
          params: {
            threadId: "planner",
            item: { type: "agentMessage", text: JSON.stringify(plan) },
          },
        });
        planner.observe({
          method: "turn/completed",
          params: { threadId: "planner", turn: { id: "plan-turn", status: "completed" } },
        });
        return { result: { turn: { id: "plan-turn" } } };
      }
      return { result: {} };
    },
    async () => undefined,
    () => undefined,
  );
  const packet = await planner.plan({
    model: "planner",
    cwd: "/tmp",
    task: [],
    context: "",
    signal: new AbortController().signal,
  });
  expect(outputSchema).toBeDefined();
  verifyStrictObjects(outputSchema);
  const properties = object(outputSchema?.properties);
  const taskProperties = object(object(object(properties.tasks).items).properties);
  expect(taskProperties).toHaveProperty("dependsOn");
  expect(taskProperties).toHaveProperty("acceptance");
  expect(object(properties.execution).required).toContain("maxParallel");
  expect(packet.plan).toEqual(plan);
  expect(packet.waves.map((wave) => wave.tasks.map((task) => task.id))).toEqual([["read-readme"]]);
});
