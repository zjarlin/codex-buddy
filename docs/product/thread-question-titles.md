# 会话短标题

普通会话的名称跟随该 Thread 最后一次用户提问。Host 在 `turn/start`、`turn/steer`、`thread/queue/add` 和 `thread/queue/update` 携带文本输入时，取提问正文开头的 24 个 Unicode 字符作为标题，并立即发布 `thread/name/updated`。

附件上下文存在时，只使用 `## My request:` 之后的正文，不把文件名、路径或附件说明放进标题。标题中的连续空白会压成一个空格；按 Unicode 字符截断，不会拆开代理对。

原生 Codex Thread 使用 `thread/name/set` 保存标题，External Harness Thread 使用 Mapping Store 保存标题。原生提问先按原协议投递，再异步设置标题，避免重命名请求插到提问之前。`ephemeral: true` 的内部 Thread 不参与命名。

Codex Desktop 的标题生成模型不再运行。标题只由用户文本确定，不会在后续 Turn、标题刷新或 Desktop 重启后改回模型生成结果；重命名失败只影响显示名称，不影响提问投递。
