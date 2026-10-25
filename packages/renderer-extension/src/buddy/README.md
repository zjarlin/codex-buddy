# Buddy 控件

`installBuddyControl` 从现有 renderer 绑定获取当前 Codex 任务、输入框锚点和 Host 客户端，只在收藏模型前保留默认展开、可收起的中断恢复列表，不再挂载 Auto Router 设置或任务包面板。仅通过共享浏览器安全契约调用 Host；不读取 Node、文件或供应商凭据。

恢复不依赖路由状态读取。`interrupted-queue.ts` 订阅各 Host 的回合终态、开始和归档事件，failed / interrupted / cancelled 当场入队，开始新回合、恢复成功或归档后移除。队列以 Host 与原生会话 ID 隔离，使用 `codexhost.interrupted-queue.v1` 持久保存标题、回合与已处理标记，重复和迟到通知不会复活旧记录。只按中断事件读取该会话元数据；启动、连接切换、聚焦、DOM 重绘和顶部点击均不扫描历史，无定时轮询。仅“补录历史中断”调用已有发现接口，补齐旧记录或离线期间错过的事件。

双语路由配置在 `settings/routing-page.ts`，按当前 Host 保存自动路由、System One、旁路、角色和单模型偏好，校验连接身份并保留失败草稿。`dispose()` 释放事件监听和 DOM。

System One 密钥在路由设置表单中维护，使用密码输入、保存与清除；Host 只回传是否配置。模型参与记录和旁路统计留在 Host 快照中，不占用输入区。等待自动恢复的任务可在路由设置页取消。

模型收藏由 `renderer-model-shortcuts.ts` 管理，复用 `renderer-model-favorites.ts` 的 Harness 隔离存储。收藏即 Pin，目录缺失的 ID 仍显示和可移除；仅声明 `supportsCustomModel` 的原生 Codex 绑定允许手填或选择目录外 ID，外部 Harness 的缺失项禁用。手填输入保留精确 ID，“使用此 ID”选择，“Pin 此 ID”仅持久化。打开会话、收藏和目录暂未就绪不触发目录同步，避免把原生分页或自定义 ID 当成刷新信号。原生绑定读取已发布的菜单属性并调用同一选择回调，不修改目录或发送请求；未知 ID 不携带旧模型的思考强度。手填和 chip 都通过 `renderer-fixed-model-selection.ts` 检查 Auto Router 接管和隐私改写，仅在策略仍开启时关闭，成功后才切换模型；已关闭时不重复写配置。选择完成后恢复面板仅更新本地显示。可在设置窗口的“路由”页再次开启自动路由。

手动模型刷新统一经过 `renderer-native-model-refresh.ts`：供应商同步完成后 refetch 原生模型查询；菜单没有活跃查询时，仅允许按完整查询键刷新该 Host 唯一且未禁用的缓存查询。等待 committed 菜单的 ID 集合与 Host 热目录一致，再显示计数。等待有两秒上限，每个异步阶段校验当前 Composer、Host、Harness 和请求版本；超时提示刷新重试，不再要求重启。Host 的 `buddy/live-model-catalog.ts` 负责将已验证同步目录投影到 `model/list`，Renderer 不改写原生 QueryClient 数据或 React 状态。

路由设置允许指定一个执行模型或自动选择，不再设置规划模型。原生 Plan Mode 和原生工具权限不变；Host 不自动分派子代理。

通过 `node tools/buddy/preview.mjs` 验证真实组件的模拟场景；执行 `npm run build:renderer` 后由主 renderer 扩展安装。夹具不能替代完整桌面绑定验收。参见 [功能说明](../../../../docs/product/buddy-auto-router.md)。

q3 模型沿用原生输入区、选模与工具能力，不再提供隐私开关或额外隔离。旧隐私配置迁移为普通固定模型设置。

`continuation.ts` 挂载侧栏状态颜色与恢复入口，只订阅共享队列并响应 DOM 变化，不查询历史。标题前的原生状态槽保留 React 节点，卸载时还原。展示和点击使用相同的 Host 前缀归一化会话 ID，切换连接后旧按钮不能提交请求。

`interrupted-panel.ts` 管理可折叠列表、手动补录、单条恢复、归档和批量恢复。批量逐条处理点击时的当前 Host 快照，成功项移除，失败项保留原因；切换 Host 或卸载停止剩余提交。归档使用原生 `thread/archive`，与恢复共用队列操作锁，执行前确认归属、最新回合和停止状态；归档失败不丢记录。恢复继续复用客户端的 Buddy / 原生续接能力，不建立第二套提交路径。

`recovery-header.ts` 展示顶部批量入口，紧邻“多供应商配置”，直接恢复队列，不先刷新。没有 Composer 时由当前 Host 绑定提供客户端。顶部与列表共享进度、结果和重复点击保护；布局扫描只重新定位节点，不触发历史读取或重复改写 DOM。
