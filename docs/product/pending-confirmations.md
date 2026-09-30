# 会话完成待确认

Renderer 为官方 Codex 与外部 Harness Thread 维护统一的“待确认”队列。Turn 进入成功、失败或中断终态后，如果它不是当前可见会话，中央会显示轻量非模态卡片，展示最后一轮 `agentMessage` 或失败原因；用户可查看结果、标为已读或归档，也可以先关闭卡片继续当前工作。

## 状态与确认

- 队列记录 Host、Thread、Turn、终态、标题、摘要、完成时间及确认状态，并以 `codexhost.pending-confirmations.v1` 保存在本机 `localStorage`，应用重启后保留。
- 同一 Turn 的重复完成通知幂等；同一 Thread 的新 Turn 开始后替换旧待确认项。已确认记录保留在有限队列中用于历史对账，不重新弹窗。
- 当前可见 Thread 的 Turn 完成时只进入待确认，不弹卡片。弹窗摘要本身不算已读；点击“查看结果”后，在可见且聚焦的原会话连续停留 3 秒，才完成确认。
- “标为已读”只确认并保留会话；“归档”先调用现有 `thread/archive`，成功后才确认并移除；失败时保留待确认状态。关闭弹窗不会确认。
- 多个待确认项一次只展开一个，其余显示数量；侧栏“待确认”视图按 Host 与 Thread 隔离显示队列项。

## 重启对账

每次连接建立后，Renderer 读取各 Host 的未归档近期 Thread，只检查最新 Turn。只有已完成、失败或中断的最新 Turn 且不在本地记录中时，才补入待确认队列；不批量回灌全部历史完成记录。旧 Host 不支持分页读取时该项跳过，不影响其他 Host。

## 提醒边界

当前提醒只发生在应用内：前台非当前会话完成时弹卡片，后台或最小化时保留侧栏蓝点和待确认数量，返回应用后再次显示。没有新增 Rust、系统通知或平台权限桥；侧栏原生未读状态语义保持不变，补充蓝点只为待确认队列提供一致的可见入口。

## 实现位置

- `packages/renderer-extension/src/pending-confirmations-state.ts`：队列归一化、摘要、幂等、确认和持久化。
- `packages/renderer-extension/src/renderer-pending-confirmations.ts`：通知订阅、弹窗、阅读计时、归档和重启对账。
- `packages/renderer-extension/src/renderer-sidebar-unread.ts`：待确认项的侧栏补充蓝点。
- `packages/renderer-extension/src/renderer-sidebar-status-filter.ts`：全部、进行中、待确认三种侧栏视图。
