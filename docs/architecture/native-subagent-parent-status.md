# 原生子代理运行期间的父 Thread 状态

Codex 的原生子代理（`thread_spawn`，`threadSource: "subAgentThreadSpawn"`）不是外部 Harness Thread：它们和父 Thread 一样走官方透传路径，Host 不替它们投影 Turn 或 Item。但官方协议把「父 Turn 停止生成」当作父 Thread 结束，`thread/status/changed` 立刻报 `idle`，而它派生的子 Thread 仍是 `active`。

Desktop 用 `thread/list` 行的 `threadRuntimeStatus` 与 `thread/status/changed` 通知决定是否转圈（`hasInProgressOwnedWork` → `threadRuntimeStatus.type === "active"` → `loading`）。因此父 Thread 一 idle，桌面就不再转圈，但子代理仍在干活——这正是「不转圈了，子代理还在跑」的现象。它不是 Host 断流，也不是模型路由问题。

## Host 的投影规则

Host 在官方流量上维护一份原生父子边与活跃子 Thread 集合，并据此改写状态：

| 位置 | 规则 |
| --- | --- |
| `thread/started`、`thread/list` 行、`thread/read` 结果 | 学习 `parentThreadId`，或嵌套形态 `source.subAgent.thread_spawn.parent_thread_id` |
| `thread/status/changed`（子） | 维护活跃集合；集合变化时驱动父状态重发 |
| `thread/status/changed`（父，非 active） | 若仍有活跃子 Thread，**丢弃该通知**，不转发 |
| 父状态重发 | 有活跃子 Thread 时补发 `active`；最后一个子 Thread idle 后补发 `idle` |
| `thread/list` 行、`thread/read`/`thread/resume` 结果 | 父行为 `idle` 但仍有活跃子 Thread 时改写为 `active` |

外部 Harness 派生的子 Thread 走另一条路径（Host 自己投影 Turn），同样按「子代理仍在跑则父保持 active」处理；两条路径共用 `#threadWorkContinues` 判定，列表、`thread/read`、`thread/resume` 重发 Thread 值时都必须使用它，否则桌面会在委派中途看到 idle。

父 Thread 自己开始新的 Turn 时，官方已报 `active`，Host 丢弃自己发明的状态，让原生报告重新生效；否则 Host 的 `idle` 会和原生 `active` 互相覆盖。

## 边界

- 只处理 Host 转发链路上的原生流量。`externalOnly` Host 不持有官方连接，不介入。
- 子 Thread 的父子边一旦学到就保留，活跃集合才是运行时判据；父 Thread 被归档或删除不影响判定，官方不再报活跃即可自然回落。
- 不改变 `turn/completed` 语义：父 Turn 仍然按时完成，Host 只是不把「父 idle」当作「整棵子树结束」。
