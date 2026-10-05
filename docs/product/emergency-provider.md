# 应急供应商（Emergency Provider）

当主上游不可达时，codexhost 自动将推理请求路由到用户配置的应急供应商。覆盖主对话和 Host 所有 AI 功能。

## 工作原理

1. Host 启动时读取 `~/.codex/emergency-provider.json`（权限 `0600`）。
2. 若已配置且启用，Host 在本机 `127.0.0.1` 上启动轻量 HTTP 反向代理。
3. Host spawn 官方 `codex app-server` 时通过 `-c` 注入覆盖，将推理流量导向本地代理。
4. 代理优先转发到主上游；连接失败或超时时自动切换到应急上游。

## 配置

### 通过 UI
设置 → 应急供应商 → 填写 Base URL 和 API Key → 保存。

### 通过文件
```json
{ "apiKey": "sk-xxx", "baseURL": "https://sub2api.shrimpman.top", "enabled": true }
```
写入 `~/.codex/emergency-provider.json`，权限 `0600`。

## 安全与隐私
- API 密钥仅保存在本机，不回传浏览器、不写入日志。
- 代理在本机运行，不持久化任何请求/响应数据。
- **故障转移期间，对话内容会发送到应急上游**。
