# Buddy Host 路由

`models.ts` 从当前 Codex 供应商动态获取模型、与 App Server 目录取交集，并按 GPT/Claude 为夯、其他为垃选择。`planner.ts` 管理独立只读规划线程、结构化任务包、取消及交互确认。`router.ts` 在回合开始前应用策略、复用 Buddy 精确命令旁路、保留原生事件和执行权限。

公共边界是 `BuddyRouter`；Host 注入原生请求、回复、向客户端发送、转发与诊断函数。生产入口默认启用，库调用者需显式传入 `buddyRouting: true`。`startGitWorkflow` 复用实时执行模型与 Git 技能，为明确的提交并推送入口跳过分类和规划；`activeThreadIds` 包含规划、执行及待续接任务，供项目空闲判断使用。`hasActiveWork` 参与 Host 的退出等待；关闭时取消规划并释放旁路状态。

`judgment.ts` 是 System One（JEV 或本地 Laya）的唯一接入点，也是意图识别、工具路由与执行角色判断的唯一来源：普通在线回合批量判断路由、复杂度、破坏性、Git 动作、是否需要生成提交消息、推送意图、执行角色、普通问答、承接上文与精确 CLI 入口，失败时回退本地兜底；密钥只从 Host 环境读取，模型名按网关平台选择。`git-push-bypass.ts` 为旁路回合附带原生 Git/平台技能、按 Git 动作生成提交／提交并推送／推送／拉取同步／继续合并的执行指导与冲突消解、推送被拒恢复路径，并统计本次 Host 运行期间每个模型的旁路回合完成率；它在 System One 确认 Git 动作或项目推送工作流的明确入口中生效，不调用夯、不扩大权限、不把回合完成率当作 Git 推送验收，也不自动重放失败写操作。

状态只在内存保留最近 100 个任务。规划输入请求通过 `pendingInput` / `codexhost/buddy/answer` 等待用户真实回答并继续原线程，等待期间暂停超时；过期、跨会话或重复提交被拒绝。模型请求失败、规划失败、不支持的交互、超时、取消均停止当前启动，不重放用户任务。执行模型只有收到原生成功响应后才能记为已接受。

详见 [功能契约与验证](../../../../docs/product/buddy-auto-router.md)。测试位于 `../../test/buddy/router.test.ts`，修改协议后同时执行 Host 现有测试和显式真实验证脚本。

`private-chat.ts` 和 `private-transport.ts` 提供独立 q3 隐私通道：复用 `readConnection` 读取 Codex 网关和认证头，每次发送前读取实时目录并取两个 q3 ID 的交集；仅进程内存历史、不跟随重定向、不继承环境代理、不提供工具。Host 在普通及外部请求路由前检查隐私开关，允许启动所需的只读元数据和无输入的原生任务预热、恢复；不能把私密文本放入原生任务、路由决策或诊断日志。验收包含 `private-chat.test.ts` 和 Host 边界测试，详见 [隐私功能说明](../../../../docs/product/buddy-private-chat.md)。
