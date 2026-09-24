# Buddy Host 路由

`models.ts` 从当前 Codex 供应商动态获取模型、与 App Server 目录取交集，并按 GPT/Claude 为夯、其他为垃选择。`planner.ts` 管理独立只读规划线程、结构化任务包、取消及交互确认。`router.ts` 在回合开始前应用策略、复用 Buddy 精确命令旁路、保留原生事件和执行权限。

公共边界是 `BuddyRouter`；Host 注入原生请求、回复、向客户端发送、转发与诊断函数。生产入口默认启用，库调用者需显式传入 `buddyRouting: true`。`hasActiveWork` 参与 Host 的退出等待；关闭时取消规划并释放旁路状态。

`judgment.ts` 是 JEV System One 的唯一接入点：普通在线回合批量判断路由、复杂度、破坏性、推送意图和执行角色，失败时回退本地规则；密钥只从 Host 环境读取。`git-push-bypass.ts` 识别推送操作、为垃模型附带原生 Git/平台技能并统计本次 Host 运行期间每个模型的旁路回合完成率。它在规划前生效，不调用夯、不扩大权限、不把回合完成率当作 Git 推送验收，也不自动重放失败写操作。

状态只在内存保留最近 100 个任务。规划输入请求通过 `pendingInput` / `codexhost/buddy/answer` 等待用户真实回答并继续原线程，等待期间暂停超时；过期、跨会话或重复提交被拒绝。模型请求失败、规划失败、不支持的交互、超时、取消均停止当前启动，不重放用户任务。执行模型只有收到原生成功响应后才能记为已接受。

详见 [功能契约与验证](../../../../docs/product/buddy-auto-router.md)。测试位于 `../../test/buddy/router.test.ts`，修改协议后同时执行 Host 现有测试和显式真实验证脚本。

`private-chat.ts` 和 `private-transport.ts` 提供独立 q3 隐私通道：复用 `readConnection` 读取 Codex 网关和认证头，每次发送前读取实时目录并取两个 q3 ID 的交集；仅进程内存历史、不跟随重定向、不继承环境代理、不提供工具。Host 在普通及外部请求路由前检查隐私开关，允许启动所需的只读元数据和无输入的原生任务预热、恢复；不能把私密文本放入原生任务、路由决策或诊断日志。验收包含 `private-chat.test.ts` 和 Host 边界测试，详见 [隐私功能说明](../../../../docs/product/buddy-private-chat.md)。
