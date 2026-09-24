# @codexhost/jev

供 Node.js 侧 Agent 循环调用的 Jev 决策包。复用官方 `@typesafe-ai/sdk`，增加响应校验和逐问题阈值策略；支持批量 Choice / Score / Noul，保留原始概率、置信度、模型和用量。

完整示例、错误处理和接入边界见 [Jev 决策层](../../docs/architecture/jev-decisions.md)。

```sh
export TYPESAFE_API_KEY='你的 TypeSafe API Key'
npm run build --workspace=@codexhost/jev
```

从 `@codexhost/jev` 导入 `TypeSafeClient`、`choice`、`score`、`noul` 和 `evaluateDecisions`。凭据通过 SDK 构造参数或环境变量提供，不写入仓库。
