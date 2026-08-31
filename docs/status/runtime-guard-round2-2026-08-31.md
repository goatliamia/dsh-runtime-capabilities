# Round-2：Guard / Provenance / 承诺兑现 实验结果

日期：**2026-08-31**（环境：隔离 DSH `.dsh-runtime-exp`、`exp` profile、`minimal` preset、`deepseek-v4-flash`、N=3、27 次运行全部 exit=0）
前置：`docs/10-guard-teaching-experiment-design.md`

## 关键冒烟验证（先于全量）

- 拒绝 reason **逐字到达模型**：`EXP_NO_PROBE=1`（探测工具被 deny）时，模型仅凭拒绝 reason 正确引用 `required_by_host = true` 与谓词并写出 `cannot`——行为隔离证明，非推断；
- 27/27 次运行 `runtimeFailures=0`、`agentErrors=0`。

## 结果

### E1 永久约束（unload 永非法）—— 强制的核心价值

| 指标 | none | guard-plain | guard-authority |
|---|---:|---:|---:|
| steps | 5.67 | 4.33 | 4 |
| 探测数 | 6.33 | 3.33 | 2.67 |
| 拒绝数 | 0 | 1 | 1 |
| 拒绝后复核 | 0 | 0 | 0 |
| payload | 93.6k | 65.9k | 59.2k |
| **worldCorrect** | **0%** | **100%** | **100%** |

**发现 1（最重要）**：无守卫时，模型平均探测 6.33 次、**明知 `required_by_host=true` 仍然执行 unload**——知识 ≠ 合规。守卫把世界正确率从 0% 拉到 100%，成本 = 1 次拒绝，教学失败 0（任何 (fact,action) 对从未被拒第二次）。
**H1（provenance）**：两臂拒绝后复核均为 0——天花板效应，H1 未被证实也未被证伪；方向性上 gauth 在所有成本指标 ≤ plain（N=3，弱证据）。

### E2 临时约束（activate 需 ready）—— 承诺兑现是真正有效的机制

| 指标 | none | guard-authority | gauth+promised-delta |
|---|---:|---:|---:|
| steps | 4.33 | 9.67 | 7.67 |
| 探测数 | 1.33 | 4 | 2.33 |
| 拒绝后复核 | 0 | 3 | 1.67 |
| 收敛 step | 1.33 | 6.67 | 5 |
| payload | 62.8k | 172.1k | 130.4k |
| **worldCorrect** | **0%** | **100%** | **100%** |

**发现 2**：none 臂提前 activate（0% 正确）。gauth 臂被拒后**轮询状态 3 次**直到 ready；gauthdelta 臂（拒绝时承诺 + step5 兑现 delta）轮询降至 1.67 次、收敛提前 1.67 step、payload −24%。**压掉复核的不是 provenance 文本，而是"承诺会通知"这个契约本身**——模型停止轮询是因为它被许诺了通知并等待兑现。

### E3 过期行动（run 需 ready，step5 变 disabled）—— L1 vs L3 正面对决

| 指标 | guard-plain | guard-authority | injection-only |
|---|---:|---:|---:|
| steps | 10.33 | 9.33 | 8.67 |
| 探测数 | 10 | 9.67 | 5.33 |
| 拒绝数 | 1 | 1 | 0 |
| payload | 206.7k | 195.7k | 195.4k |
| **worldCorrect** | **100%** | **100%** | **0%** |

**发现 3**：注入臂最便宜（最少探测/步数/payload），但**没有强制力**——模型被注入告知 disabled 后仍按任务要求执行了 exp_run（"ran-again"），世界违反 3/3。守卫臂把违规动作挡在 body 之外（100% 正确），但代价是**变更前约 10 次轮询**（任务要求"等状态变化后再试"，而守卫臂没有变更通知——模型只能轮询探时机）。
**发现 4**：E2+E3 合成——最优组合是 **guard + 承诺的变更通知**（E2-gauthdelta 模式）。E3 守卫臂缺的正是这个通知，其成本大头是轮询，不是拒绝。

## 结论

1. **强制层成立**：教学式守卫 = 1 次拒绝教会永久/过期约束，零教学失败、零复核；无守卫时模型即使有全部知识也会违规（E1-none：探测 6 次仍 unload）——"模型不需要相信"在数据上成立。
2. **真正的成本项是轮询，不是注入也不是拒绝**：临时/运动中的事实让模型轮询（E2 3 次、E3 ~10 次）。**承诺兑现（promised delta）是唯一实测有效的轮询抑制机制**（E2：−45% 复核探测、−24% payload）。
3. **L3 注入便宜但无强制力**（E3-inject：最便宜、0% 世界正确）；L1 强制但缺通知时昂贵。两者不是二选一，而是互补：L1 保正确性，承诺通知保便宜。
4. **H1（provenance 减少复核）本轮未得到有效检验**（两个场景都出现天花板）；方向性证据 gauth ≤ plain。需要专门场景：拒绝内容与模型既有信念**矛盾**且无轮询诱因时，测 plain vs authority 的复核差异。
5. 认识纪律：N=3、单模型（v4flash）、微型任务——以上均为方向性结论；`teachingFailures=0` 与 `worldCorrect` 二值结果是本轮最硬的数据。

## 下一轮建议

- **H1 专项**：E3 变体——不告知状态会变（任务只说"稍后再试一次"），step5 静默变 disabled；模型带着 ready 信念被拒，测 plain/authority 两臂拒绝后是否探针复核；
- **guard + promised-delta 组合臂**在 E3 场景复测（预期同时拿下 100% worldCorrect 与注入臂级成本）；
- 换生产同款模型 + N≥5 复测上述结论。

## 环境与文件

- 插件：`<HOME>\Documents\runtime-exp\plugin\dsh-runtime-experiment\lib\index.js`（round-2：场景动作工具 + 守卫 + 教学 reason + 承诺兑现）
- 结果：`<HOME>\Documents\runtime-exp\results\`（`e*-<arm>-r*.metrics.json/.events.jsonl/.result.txt/.stdout.txt`、`summary2.md/.json`）
- 聚合：`runtime-exp/aggregate2.mjs`（含 E3 worldCorrect 度量修正：guard 拒绝=防止违规，不计入违规）
- 隔离环境：`<HOME>\.dsh-runtime-exp\`
