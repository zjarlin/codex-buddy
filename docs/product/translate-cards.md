# 翻译卡片

当模型回答的语言与 UI 语言不一致时，客户端自动翻译并展示译文，包括同一回合内的多段进度消息。译文属于展示层，原生会话历史和模型上下文保留原文。

## 触发条件

- UI 为简体中文且消息主要为英文
- 消息长度 ≥ 20 字符
- 仅 Codex Harness assistant 消息

## 翻译流程

Renderer 与 Host 使用共享的正文语言判断，排除代码、URL、路径、文件名和技术标识符的干扰；英文按单词计数，避免长英文名称压过中文说明。Renderer 只提取 assistant 正文，排除传统 `pre` 和原生 `data-markdown-copy="code-block"` 代码块（含语言标题、复制按钮）、辅助朗读标签和 Buddy 卡片。行内 `code` 不参与语言判断，但保留在需要翻译的正文里。中文说明夹杂 API、文件名或长路径，以及只有代码或技术引用的消息不触发翻译；英文说明引用少量中文标签仍可翻译。每段消息独立挂载译文，正文变化后重新翻译；消息不再满足条件时移除旧卡片并忽略未完成的旧请求。

Host 复用当前 Codex 网关配置，调用 `POST /api/v1/translate` 的专用翻译服务，不使用聊天模型生成译文。凭据留在 Host，Renderer 只接收译文、服务商和耗时。

Host 在读取网关配置和翻译缓存之前跳过同语言正文及纯代码请求，返回 `model: "noop"`、`latencyMs: 0`；中文正文在 `zh`、`zh-CN`、`zh-TW` 界面均跳过，不请求网关或判断模型。

Host 不指定 `provider`，由网关统一负责免费/自建源优先、健康评分排序、失败降级和百度最后兜底，避免客户端绕过冷却或重复维护候选链。网关更新并部署后生效；Host 整个请求超时仍为 15 秒，网关须在剩余时间内完成降级，只有成功译文进入缓存。

SSH 会话优先使用远程 Buddy Host。官方 SSH app-server 明确不支持 `codexhost/buddy/translate` 时，回退到本机 Buddy Host 及其网关配置；网络、参数和翻译服务错误直接报告，不触发回退。方法不支持的结果按连接缓存，连接更换后重新检查。

翻译失败时，卡片显示具体原因并提供手动重试，不自动重放失败请求。Host 明确区分 15 秒超时、网关 HTTP 错误（含有界 JSON 错误原因和可用的请求 ID）、无效响应及结果缺失；仅选取响应中的错误消息，不展示请求正文、认证头或 HTML 错误页。

## 缓存

Host 内存缓存有效期 24 小时，上限 500 条，超限淘汰最早插入的记录。缓存键包含完整正文和目标语言；共享文本前缀的不同消息分别翻译。Renderer 在当前生命周期内复用相同正文的译文。

## 网关响应形状

Sub2API 的 `/api/v1/translate` 用 `{code,message,data}` 包一层，`host-runtime/buddy/translator.ts` 会先取 `data`，并把没有包裹的旧形状也当作有效响应；两种形状都不再静默失败。

## 架构

- `shared-contracts/buddy-translate.ts`: RPC schema + method name + 共享正文语言判断
- `host-runtime/buddy/translator.ts`: 网关翻译接口 + 缓存
- `renderer-extension/renderer-host-clients.ts`: SSH 翻译方法兼容与本机回退
- `renderer-extension/translate-card/`: DOM 挂载 + UI + 自动触发
