# 会话完成待确认

Renderer 为官方 Codex 与外部 Harness Thread 维护统一的“待确认”队列。Turn 进入成功、失败或中断终态后，如果它不是当前可见会话，中央会显示轻量非模态卡片，展示最后一轮 `agentMessage` 或失败原因；用户可查看结果、直接在卡片输入框续发、标为已读或归档，也可以先关闭卡片继续当前工作。

## 状态与确认

- 队列记录 Host、Thread、Turn、终态、标题、摘要、完成时间及确认状态，并以 `codexhost.pending-confirmations.v1` 保存在本机 `localStorage`，应用重启后保留。
- 同一 Turn 的重复完成通知幂等；同一 Thread 的新 Turn 开始后替换旧待确认项。已确认记录保留在有限队列中用于历史对账，不重新弹窗。
- 当前可见 Thread 的 Turn 完成时只进入待确认，不弹卡片。弹窗摘要本身不算已读；点击“查看结果”后，在可见且聚焦的原会话连续停留 3 秒，才完成确认。
- 卡片底部输入框复用当前 Host 的原生 `turn/start`（与 Composer、回合动作同一路径），把文本作为新的用户消息续发到该 Thread；官方 Thread 与外部 Harness Thread 共用这一条发送链路。发送成功后自动打开原会话；失败时保留输入并提示重试。空文本不发送，Enter 发送、Shift+Enter 换行。
- “标为已读”只确认并保留会话；“归档”先调用现有 `thread/archive`，成功后才确认并移除；失败时保留待确认状态。关闭弹窗不会确认。
- 多个待确认项一次只展开一个，其余显示数量；侧栏“待确认”视图按 Host 与 Thread 隔离显示队列项。
- “查看结果”通过侧栏原生行切入会话。Desktop 的侧栏按项目分页，只渲染每个项目的前若干行，其余行折叠在折叠的项目头或“展开显示”加载更多控件之后；待确认会话常常正落在这批未渲染的行里。因此打开前会先展开折叠的项目头、并节流点击 Fiber 上暴露 `hasMoreItems && onExpandedChange` 分页契约的“展开显示”控件，把目标行挂载出来再点击；否则一次行查询就会超时报“无法打开该会话”。点击按轮次限流，避免原生列表反复重渲染时把 App server 请求队列打满。

## 重启对账

每次连接建立后，Renderer 读取各 Host 的未归档近期 Thread，只检查最新 Turn。只有已完成、失败或中断的最新 Turn 且不在本地记录中时，才补入待确认队列；不批量回灌全部历史完成记录。旧 Host 不支持分页读取时该项跳过，不影响其他 Host。

## 语音播报

待确认卡片右上角、关闭按钮左侧的小喇叭用于手动重播最后一轮结果摘要（`POST /media/tts`，由 Host 复用 Codex 网关凭据调用，使用 `return_base64: true` 返回 base64 WAV）。媒体入口位于网关根路径，不继承模型接口的 `/v1` 前缀。底部操作从左到右为「查看结果」「标为已读」「归档」。播报不写入原生历史、不进入工具链，也不改变待确认状态机。

- 「外观」页的自动播报开关默认关闭，仅保存在本机 `localStorage`（`codexhost.speech-announcement.v2`）。升级时不继承旧版默认开启的 v1 记录；用户可以重新主动开启。关闭只影响自动播报，不影响小喇叭手动重播。
- 若主动开启，只有应用处于前台且完成的是非当前会话（且不是标题生成回合）时才自动播报。合成返回时再次检查开关、可见性与焦点；窗口失焦或隐藏会取消尚未返回的自动播报并停止正在播放的自动音频，避免切换窗口后继续抢播。后台完成仍保留侧栏蓝点与待确认数量。
- 摘要先剥离 Markdown 与代码块，再截断到上限后合成。手动合成期间小喇叭禁用并提示「正在合成语音…」；合成或播放失败会在卡片显示原因，随后恢复按钮供重试。自动播报失败只写诊断，不影响完成提醒本身。
- 手动重播不受自动开关限制。同一窗口的新请求会立即停止此前音频，并丢弃旧请求迟到的合成结果；不同窗口的手动播放没有全局互斥。
- 网关地址与认证来自处理合成请求的 Host 的 `CODEX_HOME`（默认 `~/.codex`）配置，沿用当前 Provider 的认证规则：显式 Authorization、配置环境变量或 `provider.auth.command` 等；普通 API Key 配置读取 `auth.json`。不要求另填曼波 API Key，凭据只在 Host 内读取，不传给 Renderer。
- SSH 会话优先使用远端的播报能力；只有远端明确返回方法不存在时，才使用本机 Desktop Host 的 Codex 网关配置合成。该方法缺失按连接缓存，后续重播直接使用本机；远端隐私模式、网关错误或网络故障仍直接报错，不切换 Host。SSH 连接在合成期间替换或断开时丢弃本机返回的旧结果。

## 提醒边界

Codex 为 Thread 生成标题时会在后台跑一个内部 Turn，其唯一 `agentMessage` 是 `{"title","description"}` 形状的 JSON。这类 Turn 属于内部维护而非用户发起的工作，不会进入待确认队列，也不弹卡片；该判断按 Turn 内容识别，因此对通知订阅与重启对账两条路径同时生效。

当前提醒只发生在应用内：前台非当前会话完成时弹卡片，后台或最小化时保留侧栏蓝点和待确认数量，返回应用后再次显示。没有新增 Rust、系统通知或平台权限桥；侧栏原生未读状态语义保持不变，补充蓝点只为待确认队列提供一致的可见入口。

## 实现位置

- `packages/renderer-extension/src/pending-confirmations-state.ts`：队列归一化、摘要、幂等、确认和持久化。
- `packages/renderer-extension/src/renderer-pending-confirmations.ts`：通知订阅、弹窗、阅读计时、归档和重启对账。
- `packages/renderer-extension/src/renderer-sidebar-unread.ts`：待确认项的侧栏补充蓝点。
- `packages/renderer-extension/src/renderer-sidebar-status-filter.ts`：全部、进行中、待确认三种侧栏视图。
- `packages/renderer-extension/src/renderer-speech.ts`：完成摘要清洗、网关合成调用与单条音频播放。
- `packages/renderer-extension/src/renderer-speech-preference.ts`：默认关闭的自动播报开关与变更事件。
- `packages/host-runtime/src/buddy/speech.ts`：曼波 TTS 合成、语种映射与音频上限校验。

完成提醒在会话标题上方显示 Host 与项目面包屑。优先使用原生侧栏项目标签，其次使用会话工作目录；旧提醒通过 `thread/read` 补齐项目，不借用当前打开会话的项目。侧栏分页控件尚未异步挂载时持续检查，默认最多等待 15 秒；分页点击仍限流并有轮次上限。
