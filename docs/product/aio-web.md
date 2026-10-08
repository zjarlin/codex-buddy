# AIO 中复用原版 Codex 与 Buddy

AIO 连接设备已安装、正在运行的 Codex Buddy。网页加载该安装版本的 Codex Renderer 和同版本 Buddy 扩展，通过配对设备转发官方 preload、App Host、IPC 与 worker 消息。Host、Harness、模型账户、项目与执行均保持在原生运行时中，不在 AIO 实现另一套智能体循环。

Buddy 的设备发现接口复用 loopback Controller attachment server。持有本机 runtime descriptor nonce 的设备助手发送 `WEB <nonce>\n`，获得 `{schemaVersion:1,rendererCdpEndpoint,rendererPath}`。nonce 必须精确匹配；接口不激活窗口、不调用 ATTACH，也不改变当前运行会话。CDP 地址和 renderer 路径只供本机使用，不发往 AIO。

每个网页连接通过原生 `open-in-new-window` 建立独立 Native 窗口，使用该窗口的原版 preload 和 App View。网页关闭仅清理自己创建的窗口，不能复用或接管用户主窗口端口。Renderer 公共路由初始化与桌面使用同一入口；普通 Codex 和外部 Harness 的归属、草稿预热及发送语义保持现有实现。

AIO 平台和设备助手提供配对身份、网页授权、资源传输、固定帧校验、断线清理及 opaque iframe。Buddy 不引入网络监听或浏览器凭据，发现接口仍只绑定本机 loopback。详细协议由 `org-aio/aio-plugin-agent-codex` 和 AIO 平台 `worker_webview` 功能维护。

资源从当前安装版本读取，页面组件仍由原版模块渲染。官方 Renderer 和 IPC 会随版本变化，此入口不保证未来版本自动兼容。更新后必须验证 UI 启动、原生请求、聊天发送与流式回复、停止、审批、文件操作及 Buddy 路由。

网页文件拖拽、浏览器上传路径、浏览器菜单和 Electron 嵌套 webview 尚未完整接入。运行时发现、源码测试或页面显示不能代替完整生态验收；安装包仍通过 release-packages 工作流构建、发布并投递，设备安装和重启按用户指令执行。
