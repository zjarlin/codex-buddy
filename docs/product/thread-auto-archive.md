# 长期不用自动归档

## 当前行为

设置页的“资源管理”提供“长期不用自动归档”开关和未使用时长（默认 30 天）。开启后，Host 会在设置应用时检查一次，此后每小时检查，并把达到条件的 Thread 从活动会话列表移入已归档会话。

归档不等于删除。Thread 的 Native Session 历史仍由对应 Harness 保存；官方 Codex Thread 使用原生 `thread/archive`，外部 Harness Thread 将归档状态持久化到 Mapping Store。用户仍可从已归档会话中恢复查看。

## 时间依据

- 官方 Codex Thread 以 `thread/list` 返回的 `recencyAt`（缺失时使用 `updatedAt`）为准。
- 外部 Harness Thread 以 Mapping Store 的最近更新时间与 Host 当前加载实例的活动时间为准，取较新的时间。
- 检查使用升序未归档列表，并在时间已超过截止点后停止继续分页；读取失败会隔离到对应来源，不阻断另一来源。

## 安全边界

只有同时满足以下条件的 Thread 才会自动归档：

- 未归档，且处于可恢复的 ready 状态。
- 没有运行中的 Turn 或待处理的 Host 操作。
- 外部 Thread 不存在进行中的子任务、命令、steering 或持久化错误。
- 归档前再次读取并核对最近活动时间，避免扫描与执行之间状态变化。

隐私模式会暂停后台检查。自动归档设置只下发给本地 Host，不通过当前远程 Composer 路由执行。

## 实现位置

- `packages/shared-contracts/src/thread-auto-archive.ts`：设置契约、默认值和边界。
- `packages/host-runtime/src/thread-auto-archive.ts`：定时调度、候选去重和失败隔离。
- `packages/host-runtime/src/app-server-host.ts`：官方与外部 Thread 的列表、资格复核和归档接线。
- `packages/renderer-extension/src/renderer-thread-auto-archive-preference.ts`：Renderer 持久化与连接同步。
- `packages/renderer-extension/src/settings/idle-release-controls.ts`：资源管理中的开关和天数输入。
