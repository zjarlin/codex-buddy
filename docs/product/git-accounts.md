# Git 远端账号

## 当前行为

“设置 → Git 账号”维护 Host 上的 Git 远端登录态，作用等价于编辑器内置的源码管理登录：用户在一个页面里看到当前项目用到的远端主机、是否已登录，并就地完成登录、验证与退出。Git 工作区的推送、拉取、同步与克隆自动复用这份登录态，不再依赖用户先在外部终端配好凭据。项目清单同步等独立的 Git 调用不在本范围内，沿用系统凭据。

主机列表由两部分合并：传入项目目录且该目录是 Git 仓库时，读取这个仓库声明的全部远端地址；以及已经保存过账号的主机。同一主机的 HTTPS 与 SSH 地址（例如 `https://github.com/...` 与 `git@github.com:...`）合并为一条记录，主机名与全部远端地址都相同的多条远端只保留一条。已保存但当前项目不再引用的主机仍显示，用户可以在那里退出或复用它。列表按主机名排序，卡片显示“平台 · 主机”、登录状态、站点地址、该主机关联的仓库路径和本产品 SSH 密钥状态。

平台识别只看主机名：`github.com` 与 GitHub Enterprise 域名为 GitHub，`gitee.com` 为 Gitee，`gitlab.com` 及常见自建 GitLab 主机名为 GitLab，其余归为通用主机。平台只影响界面文案与注册链接；实际认证按主机名和传输协议执行，因此内网 GitLab 与其他自建服务同样可用。

## 登录态来源

每个主机有三类可用来源，优先级从高到低：

1. **本产品保存的账号**：用户在页面里提交的 HTTPS 令牌，或启用 SSH 密钥后保存的记录。状态显示“已登录”并给出账号标识与验证时间。
2. **本机命令行登录态**：`gh` 的 `hosts.yml`（必要时用 `gh auth token` 补齐钥匙串中的令牌）与 `glab` 的 `config.yml`。命中时状态显示“复用已有登录态”并注明来源，不要求用户再次粘贴令牌。
3. **系统 Git 凭据助手**：通过 `git credential fill` 只读查询，命中后同样标记为复用。

三类都未命中时状态为“未登录”。界面不把“命令行工具未安装”当作错误，只在用户主动登录失败时说明原因。

## 令牌与 SSH 密钥

HTTPS 登录提交访问令牌，可选用户名；平台有安全默认用户名（GitHub 为 `x-access-token`，GitLab 为 `oauth2`），未填写时使用默认值。令牌保存在 `CODEX_HOME/git-accounts/`，每个主机一份 JSON，权限 0600，写入使用临时文件加 `rename`。提交后立即调用平台接口验证：GitHub 走 `api.github.com/user`（企业主机走 `/api/v3/user`），Gitee 走 `api/v5/user`，GitLab 走 `api/v4/user`。验证失败不删除账号，只标记为未验证并说明原因；平台不可达时若当前项目有该主机的仓库，会再用一次真实 `git ls-remote` 复核，避免把网络问题当成令牌失效。

SSH 方式由本产品生成 ed25519 无口令密钥，固定在 `CODEX_HOME/git-ssh/id_ed25519`，已存在时不覆盖，避免用户已粘贴到平台的公钥失效。页面只展示公钥和指纹，并提供该平台的“添加公钥”链接；私钥路径与内容不出现在任何 RPC 结果里。

任何 RPC 结果都不包含令牌原文。对外的账号投影只有主机、平台、登录方式、用户名、标签、创建时间与验证时间；界面据此渲染，不缓存令牌。

## 凭据注入

注入只发生在 Host 发起的网络类 Git 命令：`push`、`fetch`、`pull`、`clone`、`ls-remote` 与 `submodule update`。状态读取、暂存、提交等本地操作不查询凭据，避免拖慢侧栏刷新。

- HTTPS 远端使用进程内 Git 配置 `http.<origin>/.extraheader` 携带 Basic 认证头，通过 `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` 环境变量传给单次子进程。命令结束即失效，不改写 `~/.gitconfig`，不落临时文件。
- SSH 远端使用 `GIT_SSH_COMMAND -i <本产品私钥>`。只有在 Git 账号页显式启用 SSH 登录后才追加 `-o IdentitiesOnly=yes`；其余情况保留 `~/.ssh` 中已有密钥作为候选，避免排他后挤掉原本可用的身份。本产品私钥不存在时完全不注入，用户自己的 `GIT_SSH_COMMAND` 保持原样。
- 已保存令牌优先于命令行登录态；两者都没有时仍会尝试本产品密钥，覆盖“用户已把公钥加到平台但没在界面点过登录”的情况。
- 克隆与本机关联仓库走同一入口，因此克隆私有仓库同样先登录再执行。

远端地址按命令判定：`clone` 取 `--` 之后的目标，其余命令先看显式地址参数，再读仓库当前上游对应的 remote，最后回落到 `origin`。自定义 remote 名与分支上游都能覆盖。

未登录时的失败由 Host 统一改写为“Git 认证失败：请在设置 → Git 账号中登录该远端主机，或确认账号有仓库访问权限。”，错误文本不含凭据。Git 侧栏的提示条在该类错误旁显示“去登录”，点击直接打开 Git 账号页；网络错误、分支冲突等其他失败不显示这个入口。

## 验证与边界

“验证”对已保存账号重新调用平台接口；SSH 方式与平台不可达时的兜底执行一次真实 `git ls-remote`。结论以 `verified` 与一条面向用户的说明返回，成功时记录验证时间，失败时说明具体原因而不是静默通过。

当前实现只覆盖当前连接上的 Host：远端 SSH 项目的 Git 在远端主机执行，认证仍使用远端环境，不由本机 Host 代为注入。Desktop 侧栏提示针对本机 Host 的 Git 执行路径；扩展只读取本机 Host 的账号状态，不把远端项目的凭据写回本机。

测试覆盖：`packages/host-runtime/test/git-auth-store.test.ts`（平台识别、主机归一化、0600 权限、原子写入、损坏记录丢弃与投影不含令牌）、`packages/host-runtime/test/git-auth-credentials.test.ts`（认证头作用域、与既有 `GIT_CONFIG_*` 合并、SSH 身份保留、真实 HTTP 服务器验证带令牌推送成功）、`packages/host-runtime/test/app-server-host.git-auth.test.ts`（五个 RPC 的往返、参数校验与令牌不回传）、`packages/renderer-extension/test/settings/git-accounts-page.test.ts`（主机卡片、登录对话框、SSH 公钥与退出）与 `packages/renderer-extension/test/renderer-git-auth-notice.test.ts`（侧栏登录入口只在认证失败时出现）。
