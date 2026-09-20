import { assess as assessTask } from "./vendor/routing/assessment.mjs";

export async function assess(input, cwd, project) {
  if (
    Array.isArray(input) &&
    input.length > 0 &&
    input.every((item) => item?.type === "text" && typeof item.text === "string")
  ) {
    const text = input
      .map((item) => item.text)
      .join("\n")
      .normalize("NFKC")
      .trim();
    // 只匹配完整问候或致谢，不把确认执行、继续任务或混合请求当作闲聊。
    const conversation =
      /^(?:hi|hello|hey|你好|您好|嗨|哈喽|早上好|下午好|晚上好|早安|晚安|在吗|谢谢|多谢|thanks|thank you|thx)[\s!?.。,~]*$/iu;
    const identityQuestion =
      /^(?:你是谁|你(?:是|用的(?:是)?|使用的(?:是)?)(?:什么|哪个)模型|你能做什么|who are you|what model are you(?: using)?|which model are you(?: using)?|what can you do)[\s!?.。,~]*$/iu;
    const informationRequest =
      /^(?:(?:请|麻烦|帮我)\s*)?(?:什么是|为什么|为何|怎么理解|如何理解|解释|说明|介绍|讲解|讲讲|比较|对比|翻译|总结|概括|定义|what\b|why\b|who\b|when\b|where\b|which\b|how\b|explain\b|define\b|describe\b|compare\b|translate\b|summari[sz]e\b)/iu;
    const informationQuestion =
      /(?:是什么|什么意思|有哪些|是多少|有什么区别|有何区别|有什么用|怎么回事|如何工作|吗|呢|\?)[\s?!.。]*$/u;
    // 问答可以包含复杂领域词，但附带实际改动或执行要求时仍按任务评估。
    const actionRequest =
      /(?:^|[，,。;；\n]|然后|并且|同时|顺便|并|\band\b|\bthen\b)\s*(?:(?:请|帮我|麻烦|再|继续|直接|立即|进行|你|能不能|能否|可以|能|can you|could you|please)\s*)*(?:重构|修复|修改|删除|新增|添加|创建|实现|开发|部署|提交|推送|运行|执行|启动|停止|重启|安装|卸载|合并|迁移|fix\b|refactor\b|modify\b|delete\b|create\b|implement\b|deploy\b|commit\b|push\b|run\b|execute\b)/iu;
    const informational =
      (informationRequest.test(text) || informationQuestion.test(text)) &&
      !actionRequest.test(text);
    if (conversation.test(text) || identityQuestion.test(text) || informational) {
      return {
        tier: "simple",
        intent: "conversation",
        reason: "普通问答或简短交流，直接使用轻量模型，不调用规划模型",
        assessmentSource: "local-rules",
      };
    }
  }
  const assessment = await assessTask(input, cwd, project);
  // 没有明确复杂信号时由执行模型处理，不因本地规则未识别就额外调用规划模型。
  if (assessment.reason === "开发、分析或尚不能确定范围的任务") {
    return {
      ...assessment,
      tier: "standard",
      reason: "未命中复杂任务规则，直接处理；需要重大设计决策时再报告",
    };
  }
  return assessment;
}
