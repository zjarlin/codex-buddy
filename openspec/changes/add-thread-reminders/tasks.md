# Tasks

行为验收见 [spec](specs/thread-reminders/spec.md)。

## 1. 状态模型

- [x] 1.1 实现 `thread-reminders-state.ts`：一次性/周期性调度、到期判定、周期推进、稍后提醒、启用与停用、上限裁剪与存储归一化。验证：`packages/renderer-extension/test/thread-reminders-state.test.ts` 覆盖持久化、错过多个周期只补一次、停用后重新启用的顺延、删除、跨窗口 `reload` 与损坏数据丢弃。
- [x] 1.2 抽出 `notification-card.ts` 作为完成提醒与定时提醒共用的非模态弹窗外壳，并让 `renderer-pending-confirmations.ts` 改用它。验证：`tests/e2e/renderer-pending-confirmations.spec.ts` 19 项全绿，卡片尺寸、Markdown 摘要、语音重播与底部操作分组不变。

## 2. 界面与调度

- [x] 2.1 实现 `renderer-reminders.ts`：提醒对话框（方式/时间/间隔/内容/已有列表）、到点卡片、稍后提醒、`Esc` 与关闭按钮语义、前台与可见性判定、最长 60 秒的计时器重算。验证：`tests/e2e/renderer-reminders.spec.ts` 覆盖建立一次性提醒后到期弹卡片、关闭即停用、周期提醒稍后 10 分钟不改间隔、打开会话、列表删除。
- [x] 2.2 把提醒入口接入会话行操作菜单与绑定装配：`renderer-thread-actions.ts` 增加菜单扩展点，`renderer-binding-probe.ts` 负责安装、刷新与释放。验证：`renderer-binding-probe-host-catalog.test.ts` 38 项与 `tests/e2e/renderer-thread-folders.spec.ts` 3 项全绿，文件夹入口与提醒入口共存。

## 3. 文档

- [x] 3.1 新增 `docs/product/thread-reminders.md`，并在 `docs/index.md` 与 `docs/product/pending-confirmations.md` 记录共用外壳与两边语义边界。
