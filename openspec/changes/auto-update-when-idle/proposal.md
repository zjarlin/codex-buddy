# Proposal

## Why

已下载并校验完成的更新目前停在 `ready-to-restart`，必须由用户点击“重启更新”才会把状态切换为 `prepared` 并退出 Desktop。用户明确要求：发现新版本后自动下载，并在整个 Desktop 没有进行中的任务时自动重启完成更新，而不是一直等一个手动确认。

## What Changes

- 本地 Desktop Host 自动检查并自动开始准备/下载可安装的新版本，不再依赖更新浮窗或设置页被打开。
- 下载完成后，Host 等待整个 Desktop 空闲：本次 Desktop 进程内所有 Host 都报告无进行中工作，且至少一个能读取原生任务列表的 Host 完整读取后确认没有 `active` 任务。
- 空闲后先经过 30 秒宽限，期间每 15 秒复查；任何工作开始或结束都会重新计时。宽限结束后再复查一次，仍空闲才调用已有的 `codexhost/update/restart`。
- 无法证明空闲（读取失败、分页异常、没有原生权威 Host）时不重启。
- 同一版本自动准备失败或自动重启失败后不再定时重试；手动“重试 / 重启更新”入口保留。
- `ready-to-restart` 时浮窗的次要按钮从“稍后”改为“关闭”，只收起浮窗，不取消自动重启；文案改为“没有进行中的任务时自动重启安装”。
- 自动重启仅在本机 Launcher 管理的 Desktop 上启用；`CODEXHOST_REMOTE_SSH_MANAGED=1` 的远程 SSH Host 永不自动重启。

## Decisions

- **策略放在 Host，而不是 Renderer**：只有 Host 能看到 Turn、外部 Harness 会话、Subagent、Delegation、排队消息、审批/问题、Git 工作流和 Harness 版本操作。Renderer 只能看到自己窗口的状态，不能授权重启。
- **下载与重启分离**：`ready-to-restart` 之前不需要空闲；只要发现可安装版本就下载，避免用户必须先点一次。空闲判定只在重启前生效。
- **保守的空闲证明**：任一 Host 有工作即为不空闲；任一探针返回未知或不读取原生列表的 Host 无法单独授权重启。宁可继续等待，也不在无法证明空闲时中断用户工作。
- **一个 Desktop 进程共享一个协调器**：本地 Host、Windows Remote Control 的后端 Host 与会话 Host、Unix 远程 listener 的 external-only Host 与会话 Host 注册同一实例，全部空闲才重启。
- **不新增开关**：用户要求的就是默认自动更新；保留手动入口用于失败恢复。因此不引入只增加协议面的设置项。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `github-release-background-update`：新增“下载完成后仅在 Desktop 空闲时自动重启”的行为；手动确认路径保持不变。

## Impact

`packages/host-runtime/`：新增 `host-auto-update.ts`，`AppServerHost` 注册空闲探针并通过 `activityChanged()` 通知变化，`run-host-runtime.ts` 在本地 Host、Windows Remote Control 与 Unix 远程 listener 中共享一个协调器；`ExternalThreadQueue` 暴露队列是否非空，`HarnessInstallationTasks` 暴露是否有进行中的安装任务。`packages/renderer-extension/`：更新浮窗文案与次要按钮语义。`tests/e2e/`：更新就绪状态的断言。`docs/operations/repository-maintenance.md`：更新行为说明。无 Rust、Launcher 协议或安装包格式变化。
