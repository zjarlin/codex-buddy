# SSH 远程 Harness Host

通过 Codex Desktop 原生 SSH 工作区，在本机使用只安装、只登录在被控机器上的 Harness（包括 Claude Code）。凭据始终留在被控机器上，不会通过 SSH 转发。

## 前置条件

- 本机：已安装 Codex Desktop 和 codexhost，系统可以是 macOS、Linux 或 Windows。
- 被控机器：macOS 或 x64/ARM64 Linux（暂不支持 Windows），已安装 Codex CLI 和**与本机相同版本**的 codexhost。
- 目标 Harness 已在被控机器上安装并登录。
- Codex Desktop 原生 SSH 工作区已能正常使用（**设置 → 连接 → SSH**）。

## 安装

在被控机器上执行：

```bash
npm install -g @codexhost/cli
codexhost remote install
codexhost remote start
codexhost remote status
```

`remote install` 只在 SSH 会话的 Shell 配置中加入一段带标记的配置（修改前会自动备份），不影响本地 Shell 和原有 `codex` 命令。在 macOS 上还会安装一个当前用户的 LaunchAgent，用于在登录会话中启动 Claude Code；它不读取 Keychain 或任何凭据。

## 使用

1. 在本机通过 codexhost 启动 Codex Desktop。
2. 打开 SSH 工作区。
3. 在输入框的 Agent / Model 选择器中选择目标 Harness。

## 常用命令

```bash
codexhost remote status     # 查看运行状态和安装完整性
codexhost remote start      # 启动（可重复执行）
codexhost remote stop       # 停止，不影响其他 Codex 进程
codexhost remote uninstall  # 卸载，保留 Thread 映射数据
```

启动、停止或卸载后，需要在 Desktop 中重新连接 SSH 工作区。

## 升级

在两台机器上用相同的包管理器升级到同一版本，然后在被控机器上重新执行 `codexhost remote install`。等待远端现有任务结束，再执行 `codexhost remote stop` 和 `codexhost remote start`，最后重新连接 SSH 工作区。单独执行 `start` 会复用正在运行的 Host，不能保证已加载新版本。

## 常见问题

- **`codexhost/harness/inspect is unsupported on this Host connection`**：当前 SSH 连接没有接入 codexhost。确认被控机器已安装并启动相同版本的 codexhost，然后重新连接 SSH 工作区。
- **Auto Router 或会话恢复提示当前连接不支持**：该连接未提供对应扩展接口，可能仍连接官方原生服务或旧版本 Host。模型同步不启用这些接口；确认远端 codexhost 版本和运行状态，按上述升级流程切换服务后重新连接。Auto Router 与会话恢复独立检测，任一接口缺失不代表另一接口也缺失。
- **`remote status` 提示 degraded 或需要重新安装**：重新执行 `codexhost remote install`，再执行 `codexhost remote start`。
- **看不到某个 Harness**：在被控机器上检查该 Harness 是否已安装并登录，然后在设置中点击「重新诊断连接」。
- **macOS 上安装失败，提示 launchd / `gui/$UID` 错误**：被控机器需要有已登录的图形会话，登录后重新执行 `codexhost remote install`。

## SSH 功能归属

模型目录和探测、Auto Router、自动会话推荐、中断会话恢复、Git 与文件操作、会话导入及已加载会话列表使用当前 SSH Host。远端 Provider、System One 和 Harness 的配置与登录留在远端；不会用本机凭据代替。会话导入后及打开已有推荐会话时保留原 Host，切换连接后不会把旧结果提交到另一台机器。

基础 Git 操作也支持原生 SSH 服务：远端明确不提供 Git RPC 时，本机 Buddy Host 使用 Desktop 已保存的 SSH 连接，在远端执行 Git。状态、暂存／取消暂存、手动提交、推送、同步和子模块无需远端安装 codexhost。Git 凭据和文件仍在远端；该通道的关联仓库记录按连接保存在本机。AI 提交消息生成仍需远端服务。连接或操作失败不会换通道再次执行。详见 [Git 工作区](../../product/git-workspace.md)。

官方 Codex 会话菜单的“从终端打开”在 Desktop 所在机器打开所选终端，使用 Desktop 已保存的 SSH 连接，再以远端工作目录、Codex 可执行文件和 CODEX_HOME 执行 `codex resume`。远端无需图形终端；本机需有 SSH 客户端。“在 VS Code 中打开”在本机使用 Remote SSH 打开远端目录；需要 VS Code Remote SSH 扩展。单独指定密钥文件的连接应先配置 SSH 别名，确保 VS Code 使用同一密钥。

终端偏好、Desktop 更新和桌面应用入口属于本机。外部 Harness 保留自身原生能力，不能用 Codex CLI 恢复。远程 Windows 仍不受支持。

`npx -y codex-buddy sync` 只同步模型配置，不会替换持续运行的原生服务。如果配置目录已有 `auto`，但菜单缺失或扩展接口不可用，需要在现有任务结束后启动远程 Buddy Host 并重新连接。运行中的任务应先完成，避免服务切换中断执行。
