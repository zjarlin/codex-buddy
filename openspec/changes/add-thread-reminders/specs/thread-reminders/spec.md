# Spec Delta

## Purpose

定义用户为单个会话建立定时提醒后可观察的行为：入口位置、两种调度方式、到点表现、跨重启保留，以及与既有完成提醒卡片的关系。

## ADDED Requirements

### Requirement: Reminders are created from the conversation row menu

系统 SHALL 在侧栏会话行的行操作菜单中提供“提醒…”入口，并为该会话打开建立提醒的对话框。已有启用中提醒时，菜单文案 SHALL 直接显示该提醒的安排。

#### Scenario: Creating the first reminder of a conversation

- **WHEN** 用户打开某个会话的行操作菜单并选择“提醒…”
- **THEN** 系统 SHALL 打开一个预填该会话标题与项目的提醒对话框
- **AND** 保存后该提醒 SHALL 归属于同一 Host 与同一会话

#### Scenario: The row identity is unavailable

- **WHEN** 会话行缺少可解析的 Host 或会话身份
- **THEN** 系统 MUST NOT 显示提醒入口

### Requirement: Reminders support one-time and periodic schedules

系统 SHALL 支持一次性提醒与周期性提醒。一次性提醒 SHALL 在指定时刻触发一次后停用；周期性提醒 SHALL 按固定间隔推进到下一个未来时刻。提醒时刻 MUST 晚于保存时刻，周期 MUST NOT 短于 60 秒。

#### Scenario: A one-time reminder fires once

- **WHEN** 一次性提醒到达其指定时刻
- **THEN** 系统 SHALL 触发一次提醒并把它转为停用
- **AND** 再次到达原时刻 MUST NOT 重复触发

#### Scenario: A periodic reminder keeps its interval

- **WHEN** 周期性提醒触发或用户选择稍后提醒
- **THEN** 系统 SHALL 保留原间隔
- **AND** 下一次时刻 SHALL 落在触发之后的未来

#### Scenario: Several periods were missed

- **WHEN** 应用长时间未运行，导致周期性提醒错过多个周期
- **THEN** 回到前台后系统 SHALL 只补弹一次
- **AND** 下一次时刻 SHALL 从原定时刻按间隔跳到第一个未来时刻

#### Scenario: Invalid time or interval

- **WHEN** 用户提交早于当前时刻的提醒时间，或周期短于 60 秒
- **THEN** 系统 SHALL 拒绝保存并提示原因
- **AND** 已有提醒 SHALL 保持不变

### Requirement: Due reminders reuse the completion card shell

到点提醒 SHALL 使用与完成提醒相同的非模态弹窗外壳展示，并包含 Host 与项目、会话标题、按 Markdown 渲染的提醒正文与提醒时刻。卡片 SHALL 提供“打开会话”“稍后 10 分钟”与“知道了”动作。

#### Scenario: A reminder becomes due in the foreground

- **WHEN** 提醒到期且窗口可见并聚焦
- **THEN** 系统 SHALL 显示提醒卡片且不阻塞桌面其余操作
- **AND** 卡片 SHALL 显示该会话的 Host、项目与标题

#### Scenario: Opening the conversation from the card

- **WHEN** 用户点击“打开会话”
- **THEN** 系统 SHALL 通过侧栏原生行导航切换到该会话
- **AND** 成功打开后 SHALL 记一次触发

#### Scenario: Dismissing without acting

- **WHEN** 用户点击“知道了”、关闭按钮或按 `Esc`
- **THEN** 系统 SHALL 记一次触发
- **AND** MUST NOT 把该会话标为已读或改变侧栏未读状态

#### Scenario: The window is in the background when the reminder is due

- **WHEN** 提醒到期时窗口隐藏或失焦
- **THEN** 系统 SHALL 暂不展示卡片
- **AND** 回到前台后 SHALL 按到期情况补弹一次

### Requirement: Reminders persist locally per conversation

提醒 SHALL 以版本化结构保存在本机存储中，应用重启后保留，并支持同一会话的多条提醒。格式无效的记录 SHALL 被丢弃而不影响其余提醒。

#### Scenario: Restarting the application

- **WHEN** 用户重启应用
- **THEN** 未处理的提醒 SHALL 仍在原会话下列出并按原调度继续生效

#### Scenario: Another window edits the list

- **WHEN** 另一个窗口新增或删除提醒
- **THEN** 本窗口 SHALL 重新读取存储，而不是用旧快照覆盖
