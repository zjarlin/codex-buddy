import { describe, expect, it } from "vitest";
import { isGitPushRequest } from "../../src/buddy/git-push-bypass.js";

describe("Git push bypass intent", () => {
  it.each([
    "推送代码",
    "帮我推送当前的代码到 GitLab",
    "提交并推送代码",
    "git push",
    "Please push the current changes to GitHub",
    "推送代码，检查跨仓库冲突",
    "推送代码，走旁路，不要高级模型规划",
  ])("matches an operation: %s", (text) => {
    expect(isGitPushRequest([{ type: "text", text }])).toBe(true);
  });
  it.each([
    "不要推送代码",
    "don't git push",
    "如何推送代码？",
    "Explain git push",
    "检测到推送代码字眼时走旁路",
    "实现推送代码按钮",
    "重构认证模块后推送代码",
    "> 推送代码\n说明这段文档",
    '文档内容："git push"',
    "“推送代码”",
    "```sh\ngit push\n```\n说明命令",
    "查看 git 状态",
    "提交代码",
    "继续",
  ])("does not turn a mention into a push operation: %s", (text) => {
    expect(isGitPushRequest([{ type: "text", text }])).toBe(false);
  });
  it("does not match attachment names or skill metadata", () => {
    expect(isGitPushRequest([{ type: "localImage", path: "/tmp/推送代码.png" }])).toBe(false);
  });
});
