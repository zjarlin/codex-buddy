# Buddy 控件

`installBuddyControl` 从现有 renderer 绑定获取当前 Codex 任务、输入框锚点和 Host 客户端，只在收藏模型前保留中断恢复列表，不再挂载 Auto Router 设置或任务包面板。仅通过共享浏览器安全契约调用 Host；不读取 Node、文件或供应商凭据。

路由与恢复能力独立检测。路由状态明确不支持时仍查询恢复接口；恢复接口缺失时显示当前连接的接入提示。瞬时路由读取失败会禁止恢复，最终恢复授权仍由 Host 检查。

双语路由配置在 `settings/routing-page.ts`，按当前 Host 保存自动路由、隐私、System One、旁路、角色和单模型偏好，校验连接身份并保留失败草稿。输入区不轮询路由状态；配置变更通过 `BUDDY_SETTINGS_CHANGED_EVENT` 重新读取隐私开关。中断列表只在绑定连接或用户手动刷新时读取，侧边栏状态图标也可恢复。`dispose()` 释放事件监听和 DOM。

System One 密钥在路由设置表单中维护，使用密码输入、保存与清除；Host 只回传是否配置。模型参与记录和旁路统计留在 Host 快照中，不占用输入区。等待自动恢复的任务可在路由设置页取消。

模型收藏由 `renderer-model-shortcuts.ts` 管理，复用 `renderer-model-favorites.ts` 的 Harness 隔离存储。收藏即 Pin，目录缺失的 ID 仍显示和可移除；仅声明 `supportsCustomModel` 的原生 Codex 绑定允许手填或选择目录外 ID，外部 Harness 的缺失项禁用。手填输入保留精确 ID，“使用此 ID”选择，“Pin 此 ID”仅持久化。原生绑定读取已发布的菜单属性并调用同一选择回调，不修改目录或发送请求；未知 ID 不携带旧模型的思考强度。手填和 chip 都通过 `renderer-fixed-model-selection.ts` 先关闭 Auto Router 接管和隐私改写，成功后才切换模型；可在设置窗口的“路由”页再次开启自动路由。

模型刷新统一经过 `renderer-native-model-refresh.ts`：供应商同步完成后 refetch 原生模型查询，等待 committed 菜单的 ID 集合与 Host 热目录一致，再显示计数。等待有两秒上限，每个异步阶段校验当前 Composer、Host、Harness 和请求版本；超时提示刷新重试，不再要求重启。Host 的 `buddy/live-model-catalog.ts` 负责将已验证同步目录投影到 `model/list`，Renderer 不改写原生 QueryClient 数据或 React 状态。

路由设置允许指定一个执行模型或自动选择，不再设置规划模型。原生 Plan Mode 和原生工具权限不变；Host 不自动分派子代理。

通过 `node tools/buddy/preview.mjs` 验证真实组件的模拟场景；执行 `npm run build:renderer` 后由主 renderer 扩展安装。夹具不能替代完整桌面绑定验收。参见 [功能说明](../../../../docs/product/buddy-auto-router.md)。

隐私模式不挂载独立输入区，也不隐藏原生 composer。启用隐私开关后，隐藏手动选模和普通目录刷新，发送仍来自原生输入框；Host 自动选择可用的自部署 q3 模型并改写 `turn/start`，同时阻止非 q3 普通入口。

`continuation.ts` 独立挂载侧边栏状态图标恢复入口，按 Host 分页读取未归档会话；读取由事件驱动：连接绑定后读取一次，切换 Host 时经 `refresh()` 重新读取，窗口重新聚焦时刷新，不做后台定时轮询。仅对确认归属 Codex 且最新回合中断的行覆盖原生状态槽，保留 React 节点，支持重绘及卸载还原；运行中、隐私模式下移除按钮，关闭路由仍允许手动恢复。展示和点击校验使用相同的 Host 前缀归一化会话 ID。请求期间防重复点击，失败显示可重试错误；Host 再次校验回合身份和运行状态。

`interrupted-panel.ts` 管理独立展开的恢复列表、手动刷新、单条恢复和“全部继续”。批量只逐条提交点击时的当前 Host 列表，成功项移除，失败项保留并显示原因；切换 Host、卸载或开启隐私时停止剩余提交。列表读取失败保留已知记录，用户可再次手动刷新，部分历史不可读时显示数量，成功恢复的回合不会被滞后的列表响应重新加入。固定模型模式保留完整入口，隐私模式显示不可续接原因。
