import { describe, expect, it } from "vitest";
import { assess } from "../index.mjs";

const project = { root: null, stacks: [], keywords: [], commands: [] };

describe("conversational assessment", () => {
  it.each([
    "hi",
    "Hi!",
    "hello",
    " HEY ",
    "你好！",
    "您好",
    "嗨～",
    "哈喽",
    "在吗？",
    "早上好",
    "谢谢。",
    "Thank you!",
    "你是什么模型",
    "你用的是什么模型？",
    "What model are you?",
    "解释数据库事务",
    "认证是什么意思？",
    "什么是数据库迁移？",
    "为什么并发会出现竞态条件？",
    "请介绍一下加密和认证的区别",
    "Explain database transactions",
    "What is authentication?",
    "How does database migration work?",
    "1+1是多少",
    "数据库支持事务吗",
    "跨服务鉴权怎么做？",
  ])("routes %s without a planner", async (text) => {
    await expect(assess([{ type: "text", text }], undefined, project)).resolves.toMatchObject({
      tier: "simple",
      intent: "conversation",
    });
  });

  it.each([
    "hi，帮我重构数据库",
    "hello\n修复鉴权",
    "hi; rm -rf /",
    "好的",
    "继续",
    "ok",
    "hi there, design a migration",
    "解释数据库事务，然后修复事务代码",
    "说明问题并修改鉴权模块",
    "Explain authentication and implement the fix",
    "可以帮我重构数据库吗？",
    "Can you refactor authentication?",
  ])("does not bypass task semantics for %s", async (text) => {
    const result = await assess([{ type: "text", text }], undefined, project);
    expect(result.intent).not.toBe("conversation");
  });

  it("does not bypass attachments or split mixed requests", async () => {
    for (const input of [
      [
        { type: "text", text: "hi" },
        { type: "image", url: "fixture.png" },
      ],
      [
        { type: "text", text: "hi" },
        { type: "text", text: "重构数据库" },
      ],
    ]) {
      await expect(assess(input, undefined, project)).resolves.toMatchObject({ tier: "advanced" });
    }
  });
  it.each(["一句话概括这个项目", "用一个词回应", "用英文回复我"])(
    "defaults unmatched ordinary text to the executor: %s",
    async (text) => {
      await expect(assess([{ type: "text", text }], undefined, project)).resolves.toMatchObject({
        tier: "standard",
      });
    },
  );
  it.each(["设计跨服务鉴权", "修复数据库迁移冲突"])(
    "keeps explicit complexity for %s",
    async (text) => {
      await expect(assess([{ type: "text", text }], undefined, project)).resolves.toMatchObject({
        tier: "advanced",
      });
    },
  );
});
