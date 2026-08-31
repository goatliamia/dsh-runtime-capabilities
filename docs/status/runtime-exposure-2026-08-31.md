# Runtime Exposure Timing 验收记录

日期：**2026-08-31**  
验证等级：**mechanism-verified / simulated**  
环境：Node.js 24.19.0，macOS；未安装 DSH

## 已执行

```text
node --check src/runtime/exposure.mjs
node --check src/runtime/simulate-exposure.mjs
node --check src/adapters/dsh/runtime-observer.mjs
node src/cli.mjs runtime experiment --compact
node src/cli.mjs dsh kv-experiment --compact
node --test test/runtime-exposure.test.mjs test/dsh-runtime-observer.test.mjs
```

实验 fixture 共 7 个时间点、5 种策略，所有机制断言通过：

- 稳定快照不重复暴露；
- 工具能力增加/移除只产生 delta；
- 删除在 JSON 中可重放；
- 宿主未提供的依赖拓扑保持 `unknown`；
- Runtime 是下一轮 Reason 的字段，不是新聊天角色；
- 默认模型调用、Prompt 增量、Tool schema 增量和阻塞 Host 调用均为 0。
- DSH-shaped KV 前缀回放中，`append-delta` 保持已有请求的精确前缀；`full-rebuild` 在 Runtime block 失效；工具面放在 request header 时，工具变化在 header 处提前失效；`guard-only` 不产生模型可见 Runtime block。

## 未执行/不能宣称

- 未在 Windows DSH Profile 安装或加载 bundle；
- 未把观察器接入真实 DSH Agent 的模型请求发送链；
- 未测真实 tokenizer、KV cache hit rate、端到端 latency 或行为成功率；
- KV 回放只使用 `surrogate-lexical-v1`，不能替代 provider 的 tokenizer 或 `cacheReadTokens`；
- 未证明某个 Runtime fact 在真实 DSH 中一定比 ReAct discovery 更好。

## 下一次验收入口

在 Windows disposable DSH Profile 固定版本后，使用 `docs/07-runtime-exposure-experiment.md` 的 A/B 表格，至少回放：

1. `request/header` 工具面增加/移除；
2. Plugin mounted 与 ready；
3. Scope/dependency 缺失并显式 unknown。

只有真实 Agent 轨迹数据重复显示收益，才把某类观察提升为默认能力或稳定协议。
