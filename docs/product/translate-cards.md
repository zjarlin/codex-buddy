# 翻译卡片

当模型回答的语言与 UI 语言不一致时，客户端自动翻译并展示译文，包括同一回合内的多段进度消息。译文属于展示层，原生会话历史和模型上下文保留原文。

## 触发条件

- UI 为简体中文且消息主要为英文
- 消息长度 ≥ 20 字符
- 仅 Codex Harness assistant 消息

## 翻译流程

Renderer 按字符占比判断语言，只提取 assistant 正文，排除代码块、辅助朗读标签和 Buddy 卡片。每段消息独立挂载译文，正文变化后重新翻译。

Host 复用当前 Codex 网关配置，调用 `POST /api/v1/translate` 的专用翻译服务，不使用聊天模型生成译文。凭据留在 Host，Renderer 只接收译文、服务商和耗时。

Host 不指定 `provider`，由网关统一负责免费/自建源优先、健康评分排序、失败降级和百度最后兜底，避免客户端绕过冷却或重复维护候选链。网关更新并部署后生效；Host 整个请求超时仍为 15 秒，网关须在剩余时间内完成降级，只有成功译文进入缓存。

SSH 会话优先使用远程 Buddy Host。官方 SSH app-server 明确不支持 `codexhost/buddy/translate` 时，回退到本机 Buddy Host 及其网关配置；网络、参数和翻译服务错误直接报告，不触发回退。方法不支持的结果按连接缓存，连接更换后重新检查。

## 缓存

Host 内存缓存有效期 24 小时，上限 500 条，超限淘汰最早插入的记录。缓存键包含完整正文和目标语言；共享文本前缀的不同消息分别翻译。Renderer 在当前生命周期内复用相同正文的译文。

## 网关响应形状

Sub2API 的 `/api/v1/translate` 用 `{code,message,data}` 包一层，`host-runtime/buddy/translator.ts` 会先取 `data`，并把没有包裹的旧形状也当作有效响应；两种形状都不再静默失败。

## 架构

- `shared-contracts/buddy-translate.ts`: RPC schema + method name
- `host-runtime/buddy/translator.ts`: 网关翻译接口 + 缓存
- `renderer-extension/renderer-host-clients.ts`: SSH 翻译方法兼容与本机回退
- `renderer-extension/translate-card/`: DOM 挂载 + UI + 自动触发
