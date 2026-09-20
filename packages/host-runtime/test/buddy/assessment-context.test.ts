import { describe, expect, it } from "vitest";
import { assessWithContext, refersToPreviousTask } from "../../src/buddy/assessment-context.js";

const project = { root: null, stacks: [], keywords: [], commands: [] };
const input = (text: string) => [{ type: "text", text }];

describe("follow-up task assessment", () => {
  it("rates the proposed cross-service migration before a short approval", async () => {
    const assessment = await assessWithContext(input("按你说的修"), undefined, project, [
      { type: "userMessage", content: input("修复登录不一致") },
      { type: "agentMessage", text: "方案：跨服务统一鉴权，迁移数据库会话，补充并发事务回归。" },
    ]);
    expect(assessment.tier).toBe("advanced");
    expect(assessment.reason).toContain("结合最近任务");
  });

  it("uses an available compaction summary or the retained planning packet", async () => {
    for (const [recent, plan] of [
      [[{ type: "contextCompaction", summary: "待执行：跨模块迁移数据库事务。" }], null],
      [[], JSON.stringify({ goal: "修复认证", steps: ["跨服务更新权限校验"] })],
    ] as const) {
      expect(
        (await assessWithContext(input("继续"), undefined, project, [...recent], plan)).tier,
      ).toBe("advanced");
    }
  });

  it("does not inflate a bounded change or contaminate an independent request with old work", async () => {
    expect(
      (
        await assessWithContext(input("按你说的修"), undefined, project, [
          { type: "agentMessage", text: "把按钮文案从保存改成提交。" },
        ])
      ).tier,
    ).toBe("standard");
    const answer = await assessWithContext(input("你好"), undefined, project, [
      { type: "agentMessage", text: "跨模块迁移数据库" },
    ]);
    expect(answer.intent).toBe("conversation");
    expect(answer.tier).toBe("simple");
    expect(refersToPreviousTask(input("修复当前按钮样式"))).toBe(false);
  });

  it("does not claim a context-free confirmation is an easy task", async () => {
    const assessment = await assessWithContext(input("按你说的修"), undefined, project, []);
    expect(assessment.tier).toBe("advanced");
    expect(assessment.reason).toContain("没有可读取");
  });
});
