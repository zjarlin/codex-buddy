# SSH 主机共享项目

「Git 侧栏 → 共享项目」用于发现同一 SSH 主机上其他 Codex 身份已经添加过的项目，并选择性恢复项目及其会话归属。它不是设备配对或 Git 清单同步：读取和写入都以当前 Desktop 保存的 SSH 连接为边界，本机不读取该连接的密钥文件，远端也不需要安装额外服务。

## 同步来源

「同步当前身份」由本机 Host 经已有的 SSH 连接，在远端 `CODEX_HOME/auth.json` 所在主机启动固定 Worker。Worker 使用远端原生 Codex app-server 读取 `project/list` 与这些项目下的 `thread/list`，然后把项目名称、远端绝对根目录、Thread ID、标题和更新时间写成项目索引。

身份标签使用 `auth.json` 中 API Key 的 SHA-256 短摘要，不保存或返回 API Key。多个身份在同一主机上的索引互相隔离；「共享项目」页会聚合所有已同步身份，同一远端根目录的项目可被当前或未来的身份看见。

索引默认位于远端 `CODEXHOST_DATA_DIR/codexhost-remote-projects/shared-projects.json`；未设置 `CODEXHOST_DATA_DIR` 时使用 `CODEX_HOME/.codexhost/codexhost-remote-projects/shared-projects.json`。目录权限 `0700`，文件权限 `0600`。索引不含凭据、Prompt、源码、未提交文件或本机路径。

## 一键恢复

用户勾选项目后点击「恢复已选」，Renderer 只调用当前 SSH Host 的原生 `project/import`；如果远端已经存在相同根目录的项目，则改用原生 `thread/metadata/update` 把 Thread 归入既有项目。恢复不复制 Session 文件或重写历史，项目和 Thread 仍由远端 Codex 原生数据库拥有，因此后续打开、继续对话和历史读取均走原 Host。

恢复前必须在 Desktop 中能够正常连接目标 SSH Host。连接失败、远端 Codex 未登录、项目根目录不存在或会话 ID 无效时不会落到本机同名路径，也不会自动改写其他项目。

## 边界

同步动作只发布元数据，不自动添加项目、不执行恢复。授权来自 Desktop 已保存的 SSH 连接；共享索引属于远端主机和远端身份，不是设备配对信任关系。删除或重命名项目不会自动传播，重新同步会以远端当前发现结果刷新当前身份的快照。
