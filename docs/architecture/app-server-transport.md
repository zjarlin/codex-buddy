# 原生 app-server 大消息传输

Codex 的历史分页响应可能包含图片和较长的工具输出。分页限制约束 Turn 数量，并不保证单个响应小于 128 MiB。Host 必须完整转发这些原生响应，保留内容和分页语义。

`packages/host-runtime/src/remote-official-connection.ts` 把私有官方 WebSocket 连接转换为 LF 分隔的字节流。该客户端仅连接本机 loopback、Unix socket 或 Windows 命名管道；受管理的 loopback 后台使用 capability header。接收原生响应时不另设 WebSocket 消息大小上限，与 stdio 保持一致，避免大历史页关闭连接并连带中断其他请求。Host 对外监听端的请求大小限制独立维护。

`packages/protocol-core/src/jsonl.ts` 只在新收到的数据块中查找换行。跨块帧保留字节片段，收到终止换行时合并一次，复制和扫描成本随输入字节数线性增长。单块内的完整帧直接使用子视图；多个帧、空帧和跨块 UTF-8 内容均保留原始字节。显式传入的 `maxFrameBytes` 仍按单帧检查，不按传输块检查；没有终止换行的尾段仍报错。

这不是流式 JSON 解析：完整帧及其解析结果仍需要与响应大小相应的内存。Host 不截断图片、不改写历史，也不通过自动重试掩盖传输失败。

回归验证位于 `packages/protocol-core/test/jsonl.test.ts` 和 `packages/host-runtime/test/remote-official-connection.test.ts`，覆盖分块复制量、帧边界与限额，以及超过 128 MiB 的真实 WebSocket 响应和同连接后续请求。

## Host 推理流投影

外部 Harness 的推理文本通过 `CodexTurnProjector` 投影到 Desktop 的推理预览与持久 Transcript。尾部 CR/LF 暂不显示，后续非换行文本到达时，再把暂存换行作为内部换行发出；原始文本仍完整保留，完成快照仍与原始流校验。

`reasoning-text.ts` 只规范化新增片段并暂存尾部换行，不再对每次追加前后的完整文本各扫描一次。普通推理增量的规范化扫描量随输入字节数线性增长；启动、完成和历史投影仍允许一次全文处理。不增加定时合并、延迟发送或截断，也不减少原生消息数量。

可先运行 `npm run typecheck` 生成当前 TypeScript 产物，再运行 `node tools/performance/reasoning-stream.mjs`。基准使用 8,000 个 64 字节片段，每段以 LF 结尾，累计 512,000 字节，重复五轮并输出中位数。2026-10-07 在同一 Linux 开发环境的修改前后测量，更新投影循环中位数由约 4,536 ms 降至约 7.3 ms；每轮均产生 16,003 条消息。此基准仅覆盖投影循环，不含完成快照、JSON 编码、管道背压、网络、模型生成或 Desktop 渲染，不能作为整机加速倍数或终端等效证据。

`reasoning-text.test.ts` 与 `codex-ui-projector.test.ts` 覆盖初始文本、空增量、分段 CR/LF、连续换行、后续文本释放换行，以及完成快照的一致性。终端与 Desktop 的体验验收需要在同一机器、同一 Harness / Model / Provider、相同历史和输出负载下，另行测量首字延迟、显示延迟、输入响应、CPU 与内存；仓库基准不代表已安装客户端加载了新代码。
