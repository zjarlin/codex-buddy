# 翻译卡片

当模型回答的语言与 UI 语言不一致时，客户端自动翻译并展示译文。

## 触发条件

- UI 为简体中文且消息主要为英文
- 消息长度 ≥ 20 字符
- 仅 Codex Harness assistant 消息

## 翻译流程

采用两步策略，不调用公共翻译服务，不消耗 GPT/Claude token：

1. **Laya 语言判断**：通过 System One `/v1/systemone`（model=laya）快速判断文本是否主要为英文。Laya 是本地决策模型，延迟极低、不生成 token。若 Laya 不可用，回退到简单的拉丁字母占比检测。
2. **q3 模型翻译**：确认需要翻译后，使用 Codex 当前网关的自部署 q3-14b（回退 q3-4b）执行翻译。复用隐私模式的网关凭据和连接配置，保留原文 Markdown 格式和技术术语。

## 缓存

内存缓存 24 小时，上限 500 条，LRU 淘汰。同一内容不重复请求。

## 网关响应形状

Sub2API 的 `/api/v1/translate` 用 `{code,message,data}` 包一层，`host-runtime/buddy/translator.ts` 会先取 `data`，并把没有包裹的旧形状也当作有效响应；两种形状都不再静默失败。

## 架构

- `shared-contracts/buddy-translate.ts`: RPC schema + method name
- `host-runtime/buddy/translator.ts`: Laya 判断 + q3 翻译 + 缓存
- `renderer-extension/translate-card/`: DOM 挂载 + UI + 自动触发
