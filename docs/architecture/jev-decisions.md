# Jev 决策层

`packages/jev`（`@codexhost/jev`）提供 Node.js 侧可调用的 System One 决策能力。Jev 接收 state 和类型化问题，回答原子判断；LLM 继续负责推理和生成，调用者负责规则、授权、兜底和副作用。

当前实现是独立 Workspace 包，已纳入 TypeScript 构建，并已接入 Buddy Auto Router 的回合判断。需要使用它的 Node.js 包应声明 `@codexhost/jev` 依赖和 TypeScript project reference，通过公共导出调用。它不是拥有 Agent Loop 的 Harness，不注册到 Harness 插件列表或生成模型选择器；Renderer 和 shared-contracts 不应依赖此包。

## Host 接入

Host Runtime 的 `packages/host-runtime/src/buddy/judgment.ts` 是唯一 JEV 接入点。`createJevClient(environment, storedApiKey?)` 在密钥非空时构造 `TypeSafeClient`，并显式传入 `TYPESAFE_BASE_URL` / `TYPESAFE_DEFAULT_MODEL`，避免 SDK 读取进程级环境变量；缺密钥时返回 `null`，所有判断退回本地规则。密钥来源优先级为界面持久化配置 > `TYPESAFE_API_KEY` 环境变量。

界面可在 Auto Router 面板的“JEV 判断”下方输入并保存 API Key 与网关地址，通过 `codexhost/buddy/jev-key` 方法提交给 Host。Host 把连接配置写入 `CODEX_HOME` 下的 `buddy-jev.json`（文件权限 `0600`，独立于 `buddy-router.json`），并在每次回合前重新加载以重建客户端。快照只回传布尔 `jevKeyConfigured` 与 `jevBaseUrl`，绝不回传密钥；密钥输入框为密码类型且保存后立即清空，网关地址可回填显示，`settings` 中不含密钥。`apiKey` / `baseURL` 省略表示保持原值，null/空串表示清除该项；两项都为空时删除配置文件。外部通过 `BuddyRouter` 注入 JEV 客户端时（测试或高级用法），界面不允许覆盖连接配置。

`baseURL` 可指向自建 Sub2API 网关，只要该网关把 `/v1/systemone` 转发到上游。Sub2API 侧复用内容审计的 TypeSafe 档案（`base_url`、Key 池、代理），新增 `POST /v1/systemone` 中继：客户端携带 Sub2API Key 鉴权，网关注入档案中的上游 Key 再转发，只做透传、不解析或改写 System One 语义。这样 JEV 的功能、模型与行为仍由上游决定，只是把出口换成了自有网关。

`judgeWithJev(client, input, signal)` 对每个普通回合发起一次批量 System One 请求，一次性判断五件事：路由入口（code / inspect / plan / other）、复杂度档位、是否具破坏性、当前请求是否要求推送，以及应由哪类执行角色处理。返回的 `tier`、`intent`、`role`、`isPush` 由 `BuddyRouter` 采用；逐题 `decisions` 以 `judgment` 字段写入 `BuddyDecision`，面板可展示模型与依据。

接线语义：

- 用户显式指定的执行角色（`settings.role != "auto"`）优先于 JEV；未指定时 JEV 判定优先，缺少 JEV 时回退本地 `specialist` 规则。
- 推送模型旁路以 JEV 的 `isPush` 为准；缺少 JEV 时退回正则预筛 `isGitPushRequest`。正则只作为“是否值得询问 JEV”的预筛，不再单独决定旁路。
- JEV 超时（默认 4 秒）、认证、限流、网络或协议错误全部由 `BuddyRouter` 捕获并 `diagnose`，随后使用 `assessWithContext` 的本地规则完成该回合，不阻断原生请求。
- `buddySettingsSchema.jev`（默认开启）关闭时完全不调用 JEV，退回本地规则。
- 隐私模式不经过普通 `#route`，因此不会调用 JEV；JEV 只服务在线普通路由。

## API 与配置

复用官方 `@typesafe-ai/sdk@0.6.0`，使用 `POST https://api.typesafe.ai/v1/systemone`，默认模型 `jev-latest`。`TypeSafeClient` 和问题构造函数直接导出自 SDK，保留原生类型推导和错误。SDK 支持 `TYPESAFE_API_KEY`、`TYPESAFE_BASE_URL`、`TYPESAFE_DEFAULT_MODEL`；显式构造参数优先。API Key 仅在 Node.js 侧读取。

`evaluateDecisions(client, request, policies, options?)` 一次提交全部问题，返回 `answers`、`model`、`usage` 和逐问题 `decisions`。策略只在本地执行，不发送给 Provider。SDK 负责 HTTP、重试、超时与取消；本包校验答案后应用策略，不执行工具或调用 LLM。

```ts
import { TypeSafeClient, choice, noul, score, evaluateDecisions } from "@codexhost/jev";

const client = new TypeSafeClient({
  timeout: 2_000,
  retry: { maxRetries: 0 },
  logLevel: "off",
});

const result = await evaluateDecisions(
  client,
  {
    state: {
      request: "检查测试结果，判断是否需要继续修复",
      tool: { name: "read_file", path: "test-results.txt" },
      evidence: { testsPassed: true, runtimeVerified: false },
    },
    questions: {
      route: choice("应该进入哪个处理入口？", {
        code: "需要修改代码",
        inspect: "只需读取和检查结果",
        other: "以上都不适用或信息不足",
      }),
      destructive: noul("拟调用工具是否会删除已有数据？"),
      readiness: score("当前验收证据处于哪个档位？", [
        "没有测试或运行证据",
        "已有测试通过证据，缺少运行验证",
        "测试和运行验证均已通过",
      ]),
    },
  },
  {
    route: { automatic: 0.85, review: 0.6 },
    destructive: { automatic: 0.95, review: 0.75 },
    readiness: { automatic: 0.9, review: 0.6 },
  },
  { signal: AbortSignal.timeout(3_000) },
);

const route = result.decisions.route;
if (route.status === "automatic" && result.answers.route.choice !== "other") {
  console.log("可采用的路由建议", result.answers.route.choice);
} else {
  console.log("交回复核或原有路由", route.status);
}
```

示例阈值由业务自行校准，不是所有风险场景的默认值。将同一次判断所需的路由、风险、质量等问题放入一个请求；每题只问一个事实，多因素组合留给代码。只传本次判断必要且允许发送给 TypeSafe 的 state，不自动收集 Thread 历史。

## 决策语义

每个问题必须显式指定 `{ automatic, review }`，满足 `0 <= review < automatic <= 1`。Noul 额外要求 `review > 0.5`，确保“不确定”无法进入自动采用或复核区。

| 问题 | 用于阈值比较的 strength | 保留的原始语义 |
| --- | --- | --- |
| Choice | `min(confidence, probabilities[choice])` | 选项和完整分布；所选项必须是有效且概率最高的选项。 |
| Score | `confidence` | `score` 在 `0..档位数-1`，可为小数；高 confidence 不表示高分或验收通过。 |
| Noul | `max(noul, 1-noul)` | 原始 `noul` 是“为真概率”。0.01 表示强否定，0.99 表示强肯定，0.5 表示不确定；本包不伪造 SDK confidence。 |

`strength >= automatic` 返回 `automatic`；否则达到 `review` 返回 `review`；再低返回 `defer`。`basis` 标明 strength 来自置信度、真假结果概率或两者约束。

`automatic` 仅表示判断可自动采用，绝不是“允许执行”。风险问题即使得到高置信度，也必须读取答案方向；质量问题还需检查实际分数；Choice 的 `other` 由调用方显式兜底。真实工具授权始终遵守所在 Harness 的权限与审批流程。

## 校验、错误与取消

响应必须包含匹配的问题 ID 和类型、有效用量、有限的概率与置信度。Choice / Score 分布必须覆盖全部 criteria 且总和接近 1（容差 `0.0001`）。Score 的 legend 必须与请求档位一致，score 不得超出档位范围。请求与策略在调用开始时快照，避免异步等待期间被修改。

协议不匹配抛出 `JevResponseError`，不生成猜测答案。HTTP、认证、限流、网络、超时和运行中的取消保留 SDK 错误；调用前或返回后的 signal 检查可直接抛出 signal 的取消原因。所有失败都应由调用者捕获，停止当前决策或使用事先规定的兜底，不能默认为允许工具执行。

SDK 默认每次尝试超时 10 秒并最多重试 2 次，没有跨重试的总预算。Agent 循环可像示例一样禁用重试并提供总预算 signal；需要重试时通过 `RequestOptions.retry` 显式配置，沿用 SDK 的退避和 Retry-After 支持。

SDK 的 debug 日志会包含请求正文，示例关闭日志。调用者应仅记录必要的错误类型和状态码，避免直接记录包含服务端正文的原始错误。

## 验证与官方资料

定向测试使用仓库 Vitest 配置和注入 fetch，覆盖真实 SDK 请求序列化、混合批量问题、类型推导、阈值边界、异常响应、认证与限流、重试、超时和取消，不使用真实凭据。

- [官方 TypeScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [HTTP API](https://docs.typesafe.ai/api)
- [概率与置信度](https://docs.typesafe.ai/confidence)

服务可用性、性能和价格以 TypeSafe 官方为准；本包没有内置毫秒级延迟或成本承诺。
