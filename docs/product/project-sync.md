# 项目清单同步

CodexBuddy 的「设置 → 项目」维护独立项目清单，不修改 Codex Desktop 私有数据库或原生项目侧边栏。它不是 Harness Adapter 插件。两种传输方式共享同一份本机清单，可单独使用，也可同时使用。

## 设备配对

配置 `CODEXHOST_PROJECT_SYNC_RELAY_URL=wss://your-relay.example` 后，两台客户端主动连接同一个中继，不需要公网 IP、入站端口、用户账号或 frpc。设备 A 点击「生成配对码」，设备 B 输入八位码，设备 A 在「待确认的配对」中核对名称与指纹并点击「同意」。邀请码五分钟有效；拒绝不会建立信任。配对完成后选择设备「同步」，交换项目名称和 Git origin URL。

中继只转发短码、设备公钥、审批信令与加密消息，不持久保存清单。设备身份使用本机 Ed25519 密钥，项目消息由 X25519 派生密钥后用 AES-256-GCM 加密。客户端仅允许 WSS；`ws://127.0.0.1` 和 `ws://localhost` 仅供本机测试。重启后配对关系保留，客户端在设置页可用时重新注册；撤销只清除本机信任，另一台设备仍需自行撤销。中继是传输服务，不是严格的 P2P 直连。

自托管：在仓库根目录执行 `npm run build:typescript`，然后运行 `CODEXHOST_RELAY_HOST=127.0.0.1 CODEXHOST_RELAY_PORT=8642 node scripts/project-sync-relay.mjs`。生产环境需将该端口置于 HTTPS 反向代理之后，公开 WSS 地址，并配置访问限流及运行监控。不要把生产 frps 的共享 token 交给客户端。当前未部署默认公网中继，也没有在两台真实公网设备上验收。

## Git 清单

在「私有 Git 清单仓库」中配置一个已有初始提交的仓库 HTTPS/SSH 地址，使用本机 Git 凭据。点击「发布清单」会先读取远端清单、合并本机新增项目，提交并普通推送 `codexbuddy-projects.json`；另一台可点击「拉取清单」。并发推送冲突、认证失败或受保护分支会报错，不强推。Git 仓库地址不得带凭据。此路径不依赖中继和配对。

两种方式都只同步项目名与 Git origin URL，不上传源码、本机路径、未提交文件、会话或凭据。对本机缺失的项目可绑定已有的同 origin 仓库或克隆到空目录，然后通过 Codex Desktop 自身入口打开项目。删除、重命名不会自动传播。

本机状态与设备密钥保存在 `CODEXHOST_DATA_DIR/project-sync/`，默认 `~/.codexhost/project-sync/`。旧本机清单的项目和目录绑定继续可读；此前原型里的隧道地址记录不再作为新配对凭据使用。
