import { describe, expect, it } from "vitest";
import { assessWithContext } from "../../src/buddy/assessment-context.js";

const project = { root: null, stacks: [], keywords: [], commands: [] };
const input = (text: string) => [{ type: "text", text }];

// System One 可达时不走这里；本用例只保证离线兜底的保守下限。
describe("offline context assessment", () => {
  it("plans conservatively when no decision service or history is available", async () => {
    const assessment = await assessWithContext(input("按你说的修"), undefined, project, []);
    expect(assessment.tier).toBe("advanced");
  });

  it("includes readable history as range data without inventing a confident tier", async () => {
    const assessment = await assessWithContext(input("继续"), undefined, project, [
      { type: "agentMessage", text: "方案：跨服务统一鉴权，迁移数据库会话。" },
    ]);
    expect(assessment.reason).toContain("结合最近任务");
    expect(assessment.tier).toBe("advanced");
  });

  it("keeps an explicit project entry at the bounded-fallback tier", async () => {
    const assessment = await assessWithContext(input("跑起来看看"), "/tmp/project", {
      root: "/tmp/project",
      stacks: ["node"],
      keywords: [],
      commands: [
        { action: "run", command: "npm run dev", cwd: "/tmp/project", source: "package.json" },
      ],
    });
    expect(assessment).toMatchObject({ tier: "standard", intent: "project" });
  });
});
