# 仓库维护自动化

PR 维护只做两件事：**明确标题自动标签、CI 结束后更新一条简短评论**。不调用模型，不执行 PR 代码，不重复运行 CI。

## 1. 明确标题自动标签

| 标题 | 标签 |
| --- | --- |
| `fix: 修复会话恢复` | `bug` |
| `feat: 增加某个 Harness` | `enhancement` |
| `docs: 更新安装说明` | `documentation` |
| `调整会话处理` | 跳过，不猜测 |

支持 Conventional Commit 的 `(scope)` 和 `!`。不从正文、提交列表、文件路径或历史讨论推断类型；其他前缀不处理。不处理 Issue，包括历史 Issue。

只同步有标签事件证明属于本机器人的三种类型标签。人工或其他工具改过这类标签后停止自动同步；来源不明的现有标签不覆盖。标题变得无法识别时不再修改标签。不会批量删除仓库原有标签或创建领域标签。

## 2. CI 完成后的简短评论

成功示例：

> ✅ 提交 abc1234 的 CI 全部通过。

失败示例：

> ❌ Windows CI 失败。[查看日志](https://github.com/BytePioneer-AI/codex-host/actions)
>
> ```text
> src/foo.ts(42,5): error TS2322: Type 'string' is not assignable to type 'number'.
> ```
>
> 提交 abc1234。

- 只读取 `.github/workflows/ci.yml` 中与 PR 当前 HEAD 对应的可信运行。等待工作流和所有 jobs 结束；排队、运行中或尚无运行时不新发评论。
- 只有工作流和所有 jobs 成功，且两项基线 job 均有唯一成功证据，才报告全部通过：`Check macos-14`、`Check windows-latest`。
- 等待批准、取消、跳过、超时、结果不完整分别说明，不能当作通过。CI API 读取失败不发布猜测结果。
- 每个 PR 只更新一条 `github-actions[bot]` 自有评论，兼容此前摘要标记；不会接管人工伪造的同名标记。结果未变化不重复写入，失败恢复后用成功结果替换。
- 评论显示短提交 SHA 并链接完整 SHA，避免新提交尚在运行时把上一轮结果误当成新结果；不会为了更新结果要求作者手填 SHA。
- 失败任务最多展示四个，每项最多摘录五行、每行最多 500 字符。保留错误原文，不翻译、不推断根因。优先提取 TypeScript、Rust、测试、npm 等可识别诊断；有失败 step 时间时只取该时间段。
- 移除日志时间戳和控制字符，脱敏凭据行、常见 Token、长疑似凭据、URL 和用户目录。脱敏是保守的模式匹配，不能保证发现所有未知秘密；CI 本身也不得输出秘密。
- 日志不可用、超过 8 MiB、下载超时或没有可识别错误时，只展示任务状态和 GitHub 日志链接，不复制完整日志或临时签名下载地址。

不再发布信息完整性、模板催补、审查汇总、规范风险、检查例外或长期等待提醒。不自动关闭、转 Draft、批准或合并。

## 触发与安全

入口：`.github/workflows/repository-maintenance.yml`。逻辑归属 `packages/repository-automation/`，可信工作流直接加载公共 `index.mjs`，无需安装依赖或构建。

- PR 创建、编辑、重开、提交或标签变化时同步；CI `workflow_run: completed` 时按实时 PR HEAD 查找目标。
- 不监听 Issue、讨论评论或 CodeRabbit status，不进行定时巡检。漏掉的事件可手动补跑。
- 手动执行必须选默认分支。`number` 指定 PR；留空处理开放 PR。默认 `dry_run=true`，不写评论或标签；指定编号时 Actions Summary 展示评论草稿。
- 已关闭、锁定或带 `automation:ignore` 的 PR 跳过。
- 使用可信默认分支代码、固定 Action SHA 和最小权限。不会 checkout / 执行 PR head、安装 PR 依赖、执行日志内容或传递凭据到日志下载站点。
- 评论和标签历史读取失败时不写入；写入前重新核对 PR 和 CI run/attempt，过期快照放弃。GitHub API 无跨接口事务，这不是分支保护或合并锁。
- 在 GitHub 中手动暂停的工作流，不会因本地代码修改自动恢复。重新启用和批量实际写入应由维护者明确决定。

## CI 执行范围和发布校验

`ci.yml` 保留 macOS 和 Windows 两项基线 job，不配置分支保护。为减少重复工作，执行范围如下：

| 检查 | Linux x64 | macOS / Windows | Linux ARM64 |
| --- | --- | --- | --- |
| 格式、ESLint、包边界、完整 TypeScript 类型检查（含测试） | 执行 | 不重复执行 | 不重复执行 |
| TypeScript 构建、预装插件构建 | 执行 | 执行 | 由安装包 smoke 构建 |
| TypeScript 测试 | 全量 | 平台敏感文件，另排除下述测试 | 不重复执行 |
| Rust Clippy、编译和测试 | 执行 | 执行 | 执行 |
| Linux npm 安装包 smoke | 执行 | 不适用 | 执行 |

Windows 不重复执行以下测试：

- `packages/repository-automation/test/**`：实际运行在 Linux GitHub Actions 中的仓库治理逻辑。
- `packages/shared-contracts/test/**`：Schema、序列化和浏览器打包边界验证。
- `packages/renderer-extension/test/**`：浏览器逻辑、模拟 DOM 和显式模拟的平台信息，不是真实 Desktop UI 验证。
- `tools/gate-claude-code/run.test.mjs`：入口测试会嵌套启动 Vitest，再次执行已被全量套件包含的 Gate 测试；其余 Gate 测试仍跨平台执行。

macOS 和 Windows 使用 `CODEXHOST_TEST_SCOPE=platform`，由 `tests/vitest.config.js` 的既有源码规则筛选涉及文件系统、进程、路径、环境变量等平台行为的测试文件；这是保守的文本筛选，不是完整依赖分析。纯逻辑测试保留在 Linux x64，不删除测试文件。Linux ARM64 不再执行 TypeScript 单测，保留 Rust 和真实 npm 安装包验证；因此不再单独覆盖 ARM64 上的 TS 会话、锁和持久化行为。各平台的 TypeScript 构建仍会检查生产代码类型；Rust 格式只在 Linux x64 的 `format:check` 中检查一次，各平台继续执行完整 Clippy 和 Rust 测试。

仅修改 `docs/**` 或 Markdown 文件的 PR 不触发 CI；没有新的 CI 运行时，维护自动化不会发布新的通过评论。这种路径过滤不适用于要求每个 PR 都产生 CI check 的分支保护，启用此类保护前须调整。`main push` 不做路径过滤，继续为确切发布 SHA 提供完整证据。

CI 使用全新 runner，且不持久化 Cargo `target` 目录，因此设置 `CARGO_INCREMENTAL=0`，不生成跨次编译使用的增量状态；Cargo 在同一 job 内仍可复用已构建且未变化的依赖产物。通过 `CARGO_PROFILE_DEV_DEBUG=0` 和 `CARGO_PROFILE_TEST_DEBUG=0` 关闭 Rust dev/test 编译的调试符号，减少编译、链接和产物开销；默认调试断言和溢出检查保持开启，但堆栈的源码定位信息会减少。不修改本地 Cargo 配置或 release profile，也不改变发布工作流。固定版本 npm 的安装和 `npm ci` 使用 `--prefer-offline` 优先利用现有 npm 缓存，缓存缺失时仍联网获取；不改变锁文件约束，也不关闭依赖审计。

同一 PR 有新提交时取消旧 CI；每个 `main push` 使用独立并发组，不因后续提交取消，保留确切发布 SHA 的成功证据。不启用测试重试，也不全局放宽超时。

本地 `npm run check` 和 `npm run check:rust` 保持不变，不受 CI 裁剪影响。复现 CI 的 TypeScript 范围：

```bash
# macOS：构建并运行完整测试
npm run test:typescript
# macOS / Windows：筛选平台敏感文件，另排除 Linux x64 专属测试
# Windows PowerShell 先执行 $env:CODEXHOST_TEST_SCOPE = 'platform'
CODEXHOST_TEST_SCOPE=platform npm run test:typescript -- \
  --exclude 'packages/repository-automation/test/**' \
  --exclude 'packages/shared-contracts/test/**' \
  --exclude 'packages/renderer-extension/test/**' \
  --exclude 'tools/gate-claude-code/run.test.mjs'
```

工作流将格式、Lint、类型检查、TypeScript 和 Rust 分为独立 step，便于观察瓶颈。Linux 两个平台的安装包 smoke 在依赖安装成功且任务未取消时，即使前面的检查失败仍会执行；冒烟步骤先显式执行 `npm run build:typescript`，确保打包脚本导入的 Workspace 构建产物存在，不依赖测试命令的构建副作用；复用当前 runner，不新增重复安装和构建的 job，也不掩盖前面的失败。修改执行范围后的实际耗时以 Actions 运行结果为准。

`release-packages.yml` 的发布校验继续保留，不属于 PR 评论功能：

1. 标签必须是合法 SemVer 的 annotated tag，正文包含 Release Notes；提交在 `main` 历史上。
2. `package.json`、`package-lock.json` 根版本及 Cargo workspace 版本必须与标签一致。
3. 确切发布 SHA 的本仓库 `main push` 或版本标签 `workflow_dispatch` CI 和两项基线 job 必须成功；标签提交仍必须属于 `main` 历史。
4. 构建和发布固定 commit SHA；发布前再次验证远端 tag object SHA、提交仍在 `main`、CI run ID / attempt 和结果。
5. 校验失败就停止发布，不自动改版本、等待后重试或放宽条件；维护者核实后手动重新准备发布。

`main` 的每次代码推送由 `auto-release-on-main.yml` 自动递增 patch 版本、提交版本文件并创建 annotated tag。使用内置 `GITHUB_TOKEN` 推送，随后显式 dispatch 标签上的 CI 和默认分支上的 `Release packages`，不依赖 `RELEASE_PAT`。内置令牌的普通推送不触发其他工作流，显式 dispatch 保证版本提交接受 CI 检查后才发布安装包。

fork 默认跳过上游 `@codexhost` npm 包发布，GitHub 安装包不依赖上游 npm 权限。npm 发布受阻时，也可从默认分支手动运行 `Release packages`，指定原 annotated tag 并启用 `skip_npm`。该模式跳过 npm 发布，仍从标签的固定提交构建安装包，保留全部版本、Tag 和确切提交 CI 校验，通过后只发布 GitHub Release。无需移动或重建标签；原仓库的默认发布仍要求 npm 发布成功。

如需让用户手动获取新版、但不向现有安装推送更新提示，可从默认分支手动运行 `Release packages`，指定原 annotated tag 并启用 `github_prerelease`。此选项只将新建的 GitHub Release 标记为 Prerelease 且不设为 latest；npm dist-tag 仍由版本决定，稳定 SemVer 发布到 `latest`。现有更新检查只读取 GitHub 正式 latest Release，因此不会提示这个预览发行。它不修改已有 Release 的状态，也不移动标签，仍要求确切标签提交的 CI 成功。


标签推送使用标签提交里的工作流定义，新校验不会追溯改写旧标签的发布逻辑。这不是不可绕过的权限控制；未设置分支、标签或发布环境保护。

安装包 Release 同时发布 codex-buddy-update.json，包含标签、更新说明、安装包 URL、字节数和 SHA-256；可信发布代码对准备上传的实际文件计算哈希。应用检查遇到 GitHub API 403/429 时，从 GitHub Releases 的 latest 下载地址读取该清单，不需要 API 配额或用户登录；仍校验仓库、版本、文件名和下载后的 SHA-256。清单缺失或无效时明确失败，不判定为最新版本。

更新页先通过本地状态接口读取当前安装版本和安装方式，同时执行联网检查。联网请求失败或超时保留本地版本；旧 Host 不返回本地字段时，页面仍可使用检查结果。当前版本未知时显示“未知”，不能据此判断已是最新。

### 应用内更新提示

本地 Desktop Host 发现新版后，导航栏显示独立的蓝色更新图标；不依赖当前 Composer 是否连接远程 Host。点击图标开始准备和下载，浮窗显示下载百分比与字节数；总大小未知时显示不定进度。浮窗和设置页共享一次状态轮询，关闭浮窗或离开设置页不会取消 Host 下载。下载失败可重试，重复点击不会启动第二次下载。

下载和校验完成后进入 `ready-to-restart`，浮窗提示“重启更新”或“稍后”，并停止下载轮询。此状态不会启动原生安装助手，也不会退出 Desktop。只有用户点击“重启更新”，固定的 `codexhost/update/restart` 请求才把状态切换为 `prepared`：macOS 由 Rust Launcher 启动助手、退出应用并重新启动；Windows 由 Host 启动临时 Updater，Launcher 先请求 Desktop 顶层窗口关闭、等待其正常退出，超时后再强制结束。Windows 安装包由 per-user Inno 安装程序静默替换，因此自动更新与 macOS 走同一条能力判断；仅当该 Release 没有当前目标的已验证安装包时，页面才回退到手动下载入口。npm 安装在准备阶段没有安装包下载进度，确认重启后才运行 npm 安装。

检查仅在本地客户端首次绑定时自动执行，失败按 1、3、10、30 秒做有限重试；DOM 重定位不会重复检查。Host 单次联网查版本最多等待 15 秒（`UPDATE_CHECK_NETWORK_TIMEOUT_MS`），Renderer 的整次检查预算必须宽于它（`UPDATE_CHECK_REQUEST_TIMEOUT_MS`，当前 20 秒），否则一次慢但成功的检查会先被页面判成「更新服务未响应」；两者都从 `@codexhost/shared-contracts` 读取，不各自写死。下载期间每 750 毫秒读取一次状态，最多 1200 次，网络请求也有独立超时。重启确认尚不跨 Host 进程恢复：若整个应用退出后再启动，需要重新准备更新，不会根据遗留文件自动安装。

### 安装包下载镜像

应用内更新下载公开的 `zjarlin/codex-buddy` Release 安装包时，默认依次尝试 `https://gh-proxy.com/`、`https://ghfast.top/`，最后回退 GitHub 原始地址。镜像采用“镜像前缀 + 完整 GitHub 下载 URL”的格式。可通过本地 Host 环境变量 `CODEXHOST_UPDATE_DOWNLOAD_MIRRORS` 指定逗号分隔的 HTTPS 前缀；设置为空字符串禁用镜像。前缀不能包含凭据、查询参数或片段；重复地址只尝试一次。其他仓库、非 GitHub 地址和带查询参数的地址不转发给第三方镜像。npm 更新不受影响。

每个入口等待响应头或下一块数据超过 15 秒则中止该请求并尝试下一入口；持续传输的大文件不受总时长限制。HTTP 错误、网络故障、流中断、非法重定向、大小或 SHA-256 不符都会切换入口。每次重试清空临时文件并将下载进度归零；所有入口失败时删除临时文件并保留失败原因，不创建安装请求。文件和进度写入失败直接终止，不通过镜像重试。

镜像仅改变安装包的传输地址。版本、资产大小和 SHA-256 继续从 GitHub 的认证 CLI / REST API 或官方 Release 更新清单读取；未签名清单不经过第三方镜像。每个下载入口均验证原始资产的大小和 SHA-256，下载落盘后仍执行现有的文件校验，原生安装助手继续校验 SHA-256。GitHub 元数据不可达时仍明确报错，不能仅凭镜像清单判定最新版本或执行更新；未来若需代理清单，必须先建立独立的签名验证。

## 验证

```bash
npm run test --workspace=@codexhost/repository-automation
```

定向测试覆盖标题与标签所有权、CI 完整性、等待/失败/恢复、日志提取与脱敏、分页、只读预览、过期快照和发布校验。真实 Actions 写入测试需部署到可信分支并明确启用后执行。
