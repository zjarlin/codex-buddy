# 项目 Tab

Renderer 管理项目分类偏好：`model.ts` 定义前缀规则、稳定项目键和手动覆盖；`native-binding.ts` 只读原生已提交的项目行与菜单所有者；`dialog.ts` 管理配置表单；`index.ts` 挂载分类栏、菜单入口和过滤视图。

配置由本地 Host 原子写入数据目录的 `project-tabs.json`，Renderer 的 localStorage 仅作为旧版迁移源与同源窗口镜像；不写项目或 Harness 状态。原生状态筛选、展开加载与分区继续由 Desktop 管理，分类作用于已渲染的项目行。`recent-section.ts` 在初次挂载和切换分类 Tab 时通过原生按钮收起“最近”分区；普通刷新保留手动展开状态，原生标记不匹配时不操作。手动指定优先于按顺序匹配的名称前缀；有 Tab 归属的项目仅在对应 Tab 显示，“项目”只显示没有归属 Tab 的项目。契约失效时保留无法识别的原生项目行。
