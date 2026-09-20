# 原生隐私对话

隐私模式复用 Codex 当前供应商的网关地址和凭据，从 `/v1/models` 动态获取 `q3-4b`、`q3-14b`。用户已将这两个 ID 配置为自部署模型。即使任务复杂，也不经过 GPT/Claude 规划、在线分类、标题生成、摘要、压缩或工具执行。

## 使用

1. 从本 fork 启动桌面端，展开输入框上方的 Auto Router。
2. 在 chip 区启用“隐私”，无需手动选择模型。
3. 继续使用原生对话输入框发送。Host 不启动夯规划、不做普通自动路由，自动选择可用的自部署 q3 模型。已有可用 q3 偏好会保留，否则优先 `q3-14b`，再选 `q3-4b`；不覆盖普通模式的模型设置。
4. 隐私开启期间，普通外部 Harness 任务、工具类入口和非 q3 原生回合会被阻止；关闭隐私 chip 后恢复普通 Auto Router。

**不能将尚未启用隐私 chip 的普通对话框视为隐私入口。** `【隐私】`、`/private`、`隐私：` 等明确前缀及私钥标记会在 Host 本地拦截，但规则无法识别所有敏感信息。这不是依赖 AI 判断的自动 DLP；敏感内容必须先开启隐私 chip。仅更新源码或安装普通 `codex-buddy` CLI 不会改造已经运行的官方客户端。

## 复用网关配置

无需额外配置文件，旧的 `buddy-private.json` 不再读取。使用 `CODEX_HOME/config.toml` 中当前 `model_provider` 的配置，复用 Buddy 的 `readConnection` 解析 `base_url`、认证头、查询参数、`env_key`、认证命令和 `auth.json`。`requires_openai_auth` 优先使用 Codex 已登录的 API key，避免终端里其他供应商的 `OPENAI_API_KEY` 覆盖。凭据不返回界面、不写入诊断日志或请求正文。

网关应提供 `GET /v1/models` 和非流式纯文本的 `POST /v1/chat/completions`。每次发送前重新验证所选 q3 存在；缺失或不可用时停止，不改选在线模型。只有完整匹配的两个 q3 ID 可用，类似 `q3-4b-online` 的名称不会自动获得隐私资格。

这里信任用户在网关中的 q3 自部署映射。客户端保证自己不选择在线模型；网关服务端也须保持这些映射没有在线回退。模型名称本身不是服务端执行位置的证明。网关地址、查询参数或凭据改变时，需要清空会话才能继续，已有历史不会自动转移。

开关仍是 `buddy-router.json` 的 `privateMode`，与 Auto Router 的 `enabled` 独立。只需设置 `"privateMode": true` 即可默认进入隐私模式，无需配置 `executorModel`。隐私开启时隐藏手动模型选择和普通目录刷新控件。启动配置、功能目录、只读列表查询不应触发“普通发送被阻止”；无需关闭隐私保护来加载界面。

## 发送边界

- 原生输入区仍是唯一对话入口。隐私 chip 开启后，`turn/start` 会被 Host 改写为显式 q3 模型，并剥离内部标记后再交给官方 App Server。
- Host 隐私开关先于外部 Harness 和夯规划执行。打开时也阻止普通工具入口、外部任务和非 q3 普通发送。保留启动、只读元数据查询及无提示、历史注入的空任务预热和原生任务恢复；这不是完全断网模式。已经在开启前提交的在线内容无法撤回。
- 私密内容会进入 Codex 原生 Thread 历史，因为入口就是原生对话窗口。它不经过 Buddy 的夯规划线程、命令旁路或外部 Harness mapping store。
- 每次发送前重新从供应商 `/models` 和 Codex 原生 `model/list` 的交集中选择可用 q3。没有可用 q3 时停止，不改选在线模型。
- 本功能不提供操作系统级隔离。附件、工具、远程资源、输入法、剪贴板同步、屏幕录制以及网关端实际映射仍由部署和用户环境负责。

保护范围是本 fork 的模型发送链路。离线后端是否真正独立运行由部署负责；操作系统输入法/剪贴板同步、其他应用、浏览器扩展、屏幕录制，以及手动把文本复制到在线任务不受此功能控制。本功能不是操作系统级数据隔离或物理断网沙箱。

## 验证

```bash
npm run build:typescript
npm run typecheck
npm run lint
npx vitest run --config tests/vitest.config.js packages/host-runtime/test/app-server-host.test.ts
node tools/buddy/preview.mjs
```

测试使用混合网关目录、虚构 canary 文本和官方 App Server 输入流，覆盖 q3 白名单、自动选模、已有偏好、无可用 q3 阻断、启动查询放行、非 turn 入口阻断，以及原生 `turn/start` 改写后不泄漏内部 marker。浏览器夹具标明模拟数据；真实网关验证也只使用虚构文本。

实现入口：`host-runtime/src/buddy/router.ts` 管理隐私 q3 turn 改写；`renderer-extension/src/buddy/control.ts` 管理 chip 控件。旧的 `codexhost/buddy/private` RPC 仍保留为兼容边界，但不再由主界面挂载独立输入区。
