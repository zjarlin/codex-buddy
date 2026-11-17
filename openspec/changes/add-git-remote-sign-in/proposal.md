# Proposal

## Why

推送失败最常见的原因不是代码问题，而是 Host 上没有任何 GitHub / Gitee / GitLab 登录态：`git push` 报 `could not read Username`，SSH 远端报 `Permission denied (publickey)`。现在只能在外部终端手配凭据，而 Git 侧栏、克隆与自动推送都跑在 Host 进程里，用户在界面里看不到“没登录”这个事实，也没有登录入口。

## What Changes

- 新增 Git 远端账号能力：按远端主机自动识别托管平台（GitHub / Gitee / GitLab / 其他），列出当前项目涉及的远端主机及其登录状态。
- 支持两种登录方式：HTTPS 访问令牌，或由本产品生成/复用的 SSH 密钥（给出公钥并跳转该平台的公钥设置页）。
- 可直接复用本机已有的 `gh` / `glab` 登录态与系统 Git 凭据助手，不要求用户重复粘贴令牌。
- Git 工作区的推送、拉取、同步、克隆自动带上对应主机的登录态；未登录时给出“尚未登录该主机”的明确指引。项目清单同步等独立 Git 调用沿用系统凭据。
- 设置页新增“Git 账号”：登录、退出、查看公钥、验证连接，并显示该主机关联的仓库路径。

## Decisions

- **凭据按主机保存，不写入仓库配置**：账号存于 `CODEX_HOME/git-accounts/`，每个主机一份、权限 0600；界面只读取账号摘要，令牌永不回传浏览器。
- **注入方式用进程内 Git 配置，不改用户全局配置**：每次 Git 命令通过进程环境追加该主机的认证头或 SSH 身份，命令结束后不留下临时文件，也不改写 `~/.gitconfig`。
- **复用优先于新建**：本机已有 `gh`/`glab` 登录态或系统凭据助手可用时直接标记为可用，登录页只是“显式覆盖”的入口。
- **不做 OAuth 设备码**：三个平台的令牌入口只需一个可点击链接；设备码流程会引入浏览器回调与额外状态机，收益不抵成本。

## Capabilities

### New Capabilities

- `git-remote-sign-in`：远端主机的识别、登录态保存、凭据注入与验证行为。

### Modified Capabilities

无。

## Impact

`packages/shared-contracts`（新增 `git-auth` 契约与 RPC 方法）、`packages/host-runtime`（账号存储、平台识别、凭据注入、RPC 处理）、`packages/renderer-extension`（设置页与模型客户端方法）、`docs/product/git-workspace.md` 与 `docs/index.md`。
