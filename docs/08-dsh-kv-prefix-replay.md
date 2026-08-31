# DSH KV Prefix Replay 实验

实验日期：**2026-08-31**  
当前状态：**离线机制已验证；真实 DSH/provider KV 未验证**

## 目的

这项实验只验证一个窄问题：不同 Runtime 放置方式是否会改变请求的**可复用序列化前缀**。

它不调用模型、不安装 DSH、不读取 provider 内部 KV 张量，也不测真实缓存命中率。所有 token 字段都使用固定的 `surrogate-lexical-v1` 词法切分器，`simulatedProviderUsage` 只是为了让前缀关系容易比较。

## DSH 形状

fixture 保留了与 DSH 请求边界相关的最小结构：

- `header`：provider、model、session，以及可选的工具面；
- `messages`：system、user、Runtime baseline/delta、action result；
- Runtime 变化：工具面增加/移除、可选插件卸载；
- 两种模式：Runtime 只放在 context，或把工具面放在 DSH-shaped request header。

这不是 DSH 真实请求对象的兼容实现，而是用于比较前缀位置的匿名回放。

## 对照策略

| 策略 | Runtime 在模型可见请求中的形态 |
|---|---|
| `full-rebuild` | 每轮替换完整 Runtime state |
| `append-delta` | 第一次建立 baseline，后续只追加 action/delta |
| `guard-only` | Runtime 不进入模型可见 context，只保留为模型外部约束 |

## 当前 fixture 观察

在 `runtime-context-only` 模式、16 个 surrogate token 的块大小下：

| 策略 | 请求数 | 保持完整前缀的 warm 请求 | 模拟 cache read tokens | 模拟输入 tokens |
|---|---:|---:|---:|---:|
| `full-rebuild` | 6 | 2 | 688 | 1357 |
| `append-delta` | 6 | 5 | 1296 | 1819 |
| `guard-only` | 6 | 5 | 592 | 831 |

在 `dsh-request-header-tools` 模式，工具面变化位于 header，因此 `append-delta` 在工具变化步骤从 `header` 开始失效；后面的 Runtime delta 无法挽回这段早期前缀。

这些数字只描述本 fixture 的序列化关系，不代表真实 provider 的 `cacheReadTokens`、延迟、显存或成本。真实 provider 还可能受到 tokenizer、块边界、最小缓存长度、TTL、模型版本和淘汰策略影响。

## 运行

```text
node src/cli.mjs dsh kv-experiment --compact
node src/cli.mjs dsh kv-experiment
npm run dsh-kv-experiment
```

公共 API 位于：

```text
src/adapters/dsh/simulate-kv-prefix-replay.mjs
```

并通过根入口和 `project-context-bridge/dsh/kv-experiment` 导出。实验结果中的所有检查必须为 `true`，默认 host cost 为：

```json
{
  "modelCalls": 0,
  "promptDeltaChars": 0,
  "toolSchemaDelta": 0,
  "blockingHostCalls": 0
}
```

这里的 `promptDeltaChars: 0` 表示没有修改宿主默认 Prompt；它不表示实验构造的模型可见 Runtime payload 为零。

## 已验证与未验证

已验证：

- 稳定序列化不会因对象键顺序产生伪变化；
- `append-delta` 在 Runtime 变化时仍保持已有请求的精确前缀；
- `full-rebuild` 在 Runtime block 处发生替换失效；
- `guard-only` 不产生模型可见 Runtime block；
- request/header 工具面变化会在 header 处造成早期失效；
- 固定 fixture 可重复运行，且默认无模型、网络、阻塞 Host 调用。

未验证：

- 真实 DSH Hook 是否能按同样边界取得事件；
- DSH Agent 的真实行为、错误率和探索次数；
- provider 实际 tokenizer 与 KV 命中率；
- KV 命中对延迟、费用、显存的影响；
- 并发、乱序事件、revision gap 和缓存淘汰；
- `append-delta` 是否适合所有 provider 或所有工具面布局。

下一步应在 Windows disposable DSH Profile 中接入真实 request/header、Agent step 和 provider usage，使用相同任务做 A/B；在那之前不要把离线结果标记为 `host-verified` 或 `behavior-verified`。
