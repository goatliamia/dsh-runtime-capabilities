# 定稿：Progress 从语义抽象到实测 Harness Primitive（2026-09-02）

前置：`native-pp-2026-09-02.md`（语义成立）、`native-pp-consumer-2026-09-02.md`（两核心格实测）
原始结果：`experiments/native-pp/results/`（23 格）| 对比表：`results/consumer-comparison.md`

## 1. 四个格子：全部补齐，全部实测

| execution | effect | policy | 实测结果 |
|---|---|---|---|
| success | progressed | continue | 对照格 interventions=0 ✓ |
| success | stalled/claimed | **investigate / reconcile** | 静默错误 baseline 2/2 → aware **0/2**；世界正确率 0/2 → **2/2**（observe→discover→recover 成立） |
| failure | stalled | circuit | 真实执行 6→2（N=4 全格一致）；cacheRead 均值 **−27%**；任务完成率 8/8 |
| failure | progressed | do not blindly retry | 真实执行 4→1、**重复副作用 4→1**（N=4 全格一致，−75%）；cacheRead 均值 −24%；任务完成率 8/8 |

## 2. 架构三层（定稿）

```text
Event（唯一真源）
  ↓
Projection（纯 fold：execution / effect / progress）
  ↓
Policy（消费事实做决策）
  ↓
tools.guard / pre-step inject（原生介入面）
```

- **Guard 负责「执行前能不能做」；Progress 负责「执行后到底发生了什么」；Circuit 负责「根据这个事实下一步怎么办」。**
- Projection 包零改动；Policy 不重新计算世界状态，只消费 fold 出来的事实（每次拒绝/注入的证据都从 fold 实时重导出）。
- Progress 是事实层，Circuit 是决策层。

## 3. 核心命题（本轮数据支持的表述）

```text
tool error ≠ world didn't change
tool success ≠ world changed
```

- 第一个不等式由 nonatomic 格证明（响应丢失 ≠ 无副作用；盲目重试造成 4× 副作用）；
- 第二个不等式由 pretend 格证明（谎报成功 ≠ 世界已变；aware 臂通过 verify→discover→repair 把静默错误变成可恢复流程）。
- `unknown` 边界被保护：看不到 effect 时不擅自说 stalled（成功+claimed 的 policy 是「去验证」，不是「判定失败」）。

## 4. Progress 的价值定位（定稿）

**Progress 的价值不是帮 Agent 更会推理，而是给 Agent loop 提供比 tool result 更接近现实的判据。**
它不进入模型思考，而是让 policy 在「工具的说法」和「世界的状态」之间有一个事件派生的独立视角。

## 5. Runtime 的重新定位

**Runtime 不是 Progress 的拥有者，而是 Progress 的消费者之一。**
Runtime seam（docs/14）暴露确定性事实；Progress 从 Event 流派生 effect 投影；两者在 policy 层汇合。这条研究线压成一句话：

> **Event 是唯一真源；Progress 是从 Event 得到的 effect projection；Policy 消费 Progress 做控制。**

## 6. 正式化判断（谨慎措辞，与用户共识一致）

- **可以说的**：该机制在特定场景（重复失败循环、非原子失败、谎报成功）下产生了实测优化——N=4 稳定：无用执行 −67%、重复副作用 −75%、cacheRead −24~−27%，任务完成率不变。
- **暂不说的**：不扩大成「通用 Agent 都会更省、更可靠」。N=4 只覆盖两个确定性世界；agent 遵从教学理由是模型行为而非机制保证；investigate 格是正确性收益而非成本收益（aware 臂更贵）。
- **正式化前提**（若继续）：契约来源通用化（pure/non-atomic/claimed 目前硬编码于 policy）；更多世界形态；更长链路的成本复测。

## 7. Token 总账（全部事后回溯，循环内零计量）

| 阶段 | 格数 | input | output | cacheRead | reasoning |
|---|---:|---:|---:|---:|---:|
| Consumer 核心（round 2） | 11 | 28,412 | 28,440 | 571,136 | 13,716 |
| 补实验 + N=4（round 3） | 12 | 32,908 | 38,198 | 691,200 | 22,484 |
| **Consumer 线合计** | **23** | **61,320** | **66,638** | **1,262,336** | **36,200** |

单格明细：`results/token-index.json`。

## 8. 资产

- 实现：`experiments/native-pp/{fixture,projection,policy}/`（投影包零改动；policy=薄 consumer）
- harness：`experiments/native-pp/harness/`（driver-pp/pp2/pp3、task-*、verify-fold、token-index、aggregate-consumer、decode-log）
- 隔离环境：`<HOME>\.dsh-native-pp-exp`（profiles pp-a/pp-b/pp-c/pp-r）
