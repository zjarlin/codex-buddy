# Proposal

## Why

用户常在会话里留下“回头要确认”的事项（例如“clouddev 迁 macmini 做了嘛”），但现有提醒只有 Turn 完成时的一次性卡片，无法按自己的时间点回看某个会话。需要一个挂在会话上、可在指定时刻或周期触发提醒的入口，并且复用已经存在的完成提醒卡片，避免出现第二套弹窗样式。

## What Changes

- 侧栏会话行的三点菜单新增“提醒…”入口，已设提醒时显示为“提醒：<周期或时间>”。
- 新增会话提醒模型：一次性（指定时刻）与周期性（固定间隔）两种调度，按会话存多条，存于本机 `localStorage`。
- 到点弹出非模态提醒卡片，展示 Host/项目、会话标题、Markdown 提醒正文与时刻，提供“打开会话 / 稍后 10 分钟 / 知道了”。
- 抽出共用弹窗外壳 `notification-card`，让完成提醒与定时提醒共用遮罩、面板、标题行、正文区与操作栏样式。
- 不改 Host 协议：提醒只在本窗口弹窗，不发送消息、不改会话、不发系统通知。

## Decisions

- **复用完成提醒卡片外观**：新增 `notification-card` 外壳，两边各保留自己的队列、存储与动作；不在提醒模块里复制一份面板样式，也不把两种语义塞进同一个队列。
- **前台补弹而非后台唤醒**：提醒只依赖窗口内计时器与聚焦状态；应用未运行时不会唤醒进程，下次前台按到期情况补弹一次。错过多个周期只补一次，避免重开应用连弹。
- **多提醒按独立 id 存储**：同一会话允许并存多条（例如“每天复查”+“周五一次性”），不按会话折叠。
- **关闭即“知道了”**：卡片关闭、`Esc` 与“知道了”同义（记一次触发），但不像完成提醒那样把会话标为已读，也不影响侧栏蓝点。

## Capabilities

### New Capabilities

- `thread-reminders`：会话定时提醒的建立、调度、到点卡片与持久化行为。

### Modified Capabilities

无。完成提醒的队列语义、蓝点对应与已读规则保持不变；本变更只把它的弹窗外壳抽成共用实现。

## Impact

`packages/renderer-extension/`：新增 `thread-reminders-state.ts`、`renderer-reminders.ts`、`notification-card.ts`；`renderer-pending-confirmations.ts` 改用共用外壳；`renderer-thread-actions.ts` 增加一个菜单扩展点；`renderer-binding-probe.ts` 安装与刷新提醒。新增 `docs/product/thread-reminders.md` 并更新索引与完成提醒文档。无新增依赖、无 Host/Rust 改动。
