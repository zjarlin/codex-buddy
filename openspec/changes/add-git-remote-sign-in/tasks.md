# Tasks

行为验收见 [spec](specs/git-remote-sign-in/spec.md)。

## 1. 契约与存储

- [x] 1.1 新增 `git-auth` 契约（识别、状态、登录、退出、公钥、验证）并导出。验证：`npx tsc -b` 通过，类型在 Renderer 与 Host 两侧可用。
- [x] 1.2 实现 Host 侧账号存储：按主机保存、0600 权限、原子写入、删除、只读投影不含令牌；并实现平台识别与 gh/glab 登录态读取。验证：`packages/host-runtime/test/git-auth-store.test.ts` 覆盖保存/读取投影/删除/损坏文件/平台识别。

## 2. 凭据注入

- [x] 2.1 Git 命令按远端主机注入认证（HTTPS 头或 SSH 身份），不写全局配置、不落临时文件；克隆同样生效。验证：`packages/host-runtime/test/git-auth-credentials.test.ts` 用本地 HTTP 服务器验证带令牌请求成功、无令牌失败，并覆盖自建 http+端口主机的验证协议。

## 3. 协议与界面

- [x] 3.1 Host 注册五个认证 RPC 方法，非法参数统一返回 `-32094`，任何结果都不回传令牌。验证：`packages/host-runtime/test/app-server-host.git-auth.test.ts` 走真实 JSONL 往返。
- [x] 3.2 设置页新增“Git 账号”：主机列表、平台徽标、登录对话框（令牌 + 申请链接）、SSH 公钥、退出、验证。验证：`packages/renderer-extension/test/settings/git-accounts-page.test.ts` 与 `npx tsc -b`。
- [x] 3.3 Git 侧栏在认证失败时给出“去登录”入口，点击打开设置页对应页面。验证：`packages/renderer-extension/test/renderer-git-auth-notice.test.ts` 覆盖认证失败/普通错误的判定分支与 `openSettings(..., "git-accounts")` 调用。

## 4. 文档

- [x] 4.1 新增 `docs/product/git-accounts.md` 并更新 `docs/index.md` 与 `docs/product/git-workspace.md` 的认证说明。
