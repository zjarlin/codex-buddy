# Tasks

- [x] 新增 `HostAutoUpdate`：定时检查、自动开始下载、轮询状态、空闲宽限与自动重启。
- [x] `AppServerHost` 注册空闲探针：本地工作、排队消息、审批/问题、Delegation、外部命令、Harness 版本任务，以及分段读取的原生 `thread/list`。
- [x] `externalOnly` Host 只贡献自身工作，不单独授权原生空闲。
- [x] `run-host-runtime.ts` 在本地 Host、Windows Remote Control 和 Unix 远程 listener 中共享同一 `HostAutoUpdate`，并排除 `CODEXHOST_REMOTE_SSH_MANAGED=1`。
- [x] 同一版本自动准备/重启失败后不重试；手动入口不受影响。
- [x] 浮窗在 `ready-to-restart` 时改为“关闭”，并说明空闲时自动重启。
- [x] Renderer 在状态读取中先看到 `ready-to-restart` 时立即接入空闲策略，不等下一次小时检查。
- [x] 单元测试：下载→就绪→宽限→重启；有工作不重启；无法证明空闲不重启；失败不重试；`prepared` 继续轮询；迟到的 Host 触发复查。
- [x] 集成测试：Host 探针注册/注销、外部 Turn、原生分页与异常响应；`runHostRuntime` 共享实例与 SSH 排除。
- [x] 更新 `docs/operations/repository-maintenance.md` 与 OpenSpec delta。
- [x] 远端 CI 流水线验证 TypeScript 构建与测试、Rust 检查与跨平台测试（本机为 Mac mini，按仓库规定不本地构建）。
