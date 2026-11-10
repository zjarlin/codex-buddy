# 目标模式会话标记

Sidebar 中带原生 Codex Goal 的 Thread 在标题前显示目标徽标，用于把目标模式会话与普通会话区分开。

## 数据来源

- 徽标读取官方 `thread/goal/get` 的 `goal`，不复制 Goal 生命周期，也不改动 Goal 状态。
- External Harness Thread 没有 Codex Goal，Host 对其 `thread/goal/get` 返回 `{ goal: null }`。
- Renderer 按 Host + Thread 缓存结果，30 秒后后台复核；请求失败按逐步放大的间隔重试，方法不可用时保持静默。
- 目标被清除后，下一次复核会移除徽标。

## 展示

- 标题前显示目标图标，颜色按状态区分：进行中、已暂停、受阻、用量受限、预算受限、已完成。
- Tooltip 包含状态文案和 Goal objective。
- 徽标只做装饰，不占用原生行点击区域，也不改变侧栏排序或筛选。
