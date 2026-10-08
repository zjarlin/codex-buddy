# 侧栏会话定位与标题栏项目名

官方侧栏把所有项目放在同一个滚动容器里，项目多时当前会话常常滚出可视区，用户只能凭会话名猜它属于哪个项目。codexhost 在此之上补充两个只读的界面增强：标题栏显示当前会话所属项目名，左侧树自动对齐到当前会话及其所属项目。

两者都不改变原生状态：不切换项目分类 Tab、不展开折叠的项目、不写入会话行或会话历史，只读取原生已提交的 DOM 与 React Fiber 身份。

## 标题栏项目名

官方标题栏只显示会话名。Renderer 在标题栏内容节点（`[data-app-shell-titlebar-content]`）上维护一个自有属性 `data-codexhost-titlebar-project`，用 CSS `::after` 把项目名以 `· 项目名` 追加在会话名之后。

项目名优先取自标题栏项目图标 Fiber 上的 `project.name`（Desktop 自己的项目身份），其次是同一 tooltip 的 `tooltipContent`；两者都不可用时回退到左侧树中该会话所属项目头的 `data-app-action-sidebar-project-label`（远程项目可能带 `remote_` 前缀，与标题栏显示名不同，因此只作兜底）。不使用本地化的 `aria-label`（`项目：xxx` / `Project: xxx`），避免语言切换影响。

标题栏由 React 管理，插入的子节点会在重渲染时被移除，因此这里不插入真实节点，只用属性驱动伪元素；`MutationObserver` 在标题栏内容节点重挂或 Composer 目标变化时重新对齐。非会话路由（例如图片查看）没有该节点，此时清除标记。卸载扩展会移除属性、样式与观察者。

## 左侧树滚动聚焦到会话的项目

Renderer 在「右侧正在查看的会话发生变化」时，把该会话所属的项目头与其会话行一起滚动进可视区：

- 项目头与当前会话行都已完全可见（含少量边距）时不滚动，避免与用户的手动滚动打架；
- 项目头滚出可视区时，先把项目头对齐到滚动容器顶部，让用户同时看到会话及其所属项目；
- 项目较长、对齐项目头后会话行仍会落到可视区之外时，退回把会话行居中，始终保证当前查看的会话可见。

同一会话内不重复滚动，只有切换会话才重新对齐。目标行未被渲染（项目折叠、超出原生分页）时保持当前滚动位置，等它出现后再对齐；窗口不可见时不滚动。整个功能只读写滚动容器的 `scrollTop`，不触碰任何原生属性。

几何计算在 `sidebarProjectFocusDelta`：`header` 取不到（项目容器或项目头缺失）时按「已聚焦」处理，只保证会话行可见。

## 实现位置

- `packages/renderer-extension/src/renderer-titlebar-project-name.ts`：标题栏项目名的读取、属性对齐与样式。
- `packages/renderer-extension/src/renderer-sidebar-thread-align.ts`：侧栏滚动聚焦的几何计算与观察者。
- `packages/renderer-extension/src/renderer-binding-probe.ts`：共用「当前查看的会话」判定并安装两个模块。
