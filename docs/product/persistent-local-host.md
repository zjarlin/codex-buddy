# 本地常驻 Host

本地项目默认使用随 Codex Desktop 启动的 Host Runtime。Desktop 退出或重启时，Shim 会结束该 Host；正在执行的回合可能被中断，重新打开后只能恢复已落盘的历史。

「本地常驻 Host」把本地 Host 变成独立于 Desktop 生命周期的后台进程。工作区路径、文件、Git 仓库和 Harness 都仍在当前电脑上，不需要 SSH 工作区、反向 SSH、EasyTier 或任何入站端口。

## 启用

需要与已安装的 Codex Buddy 使用同一版本的 `codexhost` CLI；没有全局命令时先执行：

```bash
npm install -g @codexhost/cli
```

然后启用：

```bash
codexhost local-host enable
```

然后完全退出并重新启动 Codex Desktop。启用后，Desktop 的本地 `app-server` 连接经 Shim 代理到后台 Host，项目仍然显示为本地项目。

```bash
codexhost local-host status   # 查看是否启用、后台进程和 socket 状态
codexhost local-host stop     # 停止后台 Host；进行中的任务可能中断
codexhost local-host disable  # 关闭并停止后台 Host
```

`enable` 在下一次 Desktop 启动时生效；`disable` 会同时停止当前后台 Host，避免旧 Host 继续持有 Mapping Store 锁并影响新的本地 Host。

## 生命周期

- 后台 Host 监听当前用户私有目录下的 Unix socket，默认位于 `CODEXHOST_DATA_DIR/local-host-runtime-v1/app-server.sock`；未设置 `CODEXHOST_DATA_DIR` 时使用 `~/.codexhost/local-host-runtime-v1/`。命令行和 Codex Buddy 必须使用同一个 `CODEXHOST_DATA_DIR`。
- 每个 Desktop 连接只启动一个轻量代理进程。Desktop 关闭时代理退出，后台 Host 保留；连接断开后，后台 Host 等待正在执行的回合自然结束，再释放该连接的 Session。
- 重新打开 Desktop 会连接同一个后台 Host，项目、Thread 映射和已落盘历史继续可用；空闲的 Harness Session 按现有恢复路径重新解析。
- 更新 codexhost 后，下一次启动会检测后台 Host 使用的 Host Runtime 路径；版本不一致时停止旧 listener 并启动新 listener。需要保留正在执行的任务时，先等待任务结束或手动执行 `codexhost local-host stop`。
- 后台 Host 不会随 Desktop 退出而停止，也不再受 Desktop 进程树清理影响。`status` 与 `stop` 是显式的兜底入口。

## 边界

- 仅支持 macOS 和 Linux。Windows 仍使用随 Desktop 启动的本地 Host。
- 只改变本地 Host 的生命周期，不把文件同步到另一台机器。工作区、Harness、Provider 和凭据仍在本机。
- 如果目标是「文件在本机、计算在另一台机器」，远端进程必须能访问这些文件，需要独立的文件传输或挂载层（例如同步镜像或反向挂载）。EasyTier 只提供网络可达性，不能替代文件语义、冲突处理和权限边界；本功能不把网络组网当作工作区能力。
- 后台 Host 仍使用同一份 Mapping Store 和 Adapter 生命周期；不要在 Desktop 仍连接旧 Host 时手动删除数据目录或 socket。
- 私有目录权限为 `0700`，socket 权限为 `0600`，不监听 TCP 端口。

## 故障排查

- `status` 显示 `enabled` 但 `runtime: stopped`：后台 Host 未启动或已退出。重新启动 Desktop；仍失败时执行 `codexhost local-host disable` 后再 `enable`。
- 启动后新项目无法打开，日志提示 Mapping Store 已有所有者：通常是切换启用状态时旧 Host 仍在运行。执行 `codexhost local-host stop`，完全退出 Desktop 后重新启动。
- 升级后仍是旧行为：确认安装的是包含本功能的 codexhost 版本，然后重启 Desktop，让 Shim 加载新的 Host Runtime。
