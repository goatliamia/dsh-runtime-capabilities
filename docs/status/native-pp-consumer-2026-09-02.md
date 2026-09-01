# 状态：Progress Consumer 实验（Circuit / Retry Policy，2026-09-02 续）

前置：`docs/status/native-pp-2026-09-02.md`（语义成立）| 原始结果：`experiments/native-pp/results/` | 对比表：`results/consumer-comparison.md`

## 0. 结论摘要

**Progress 语义接上 policy 后，产品价值在两个最小格上实测成立：**

1. **failure+stalled（loop 场景）**：circuit 消费 `execution=failed, effect=stalled`，把无用执行从 **6→2（−67%）**，均值 cacheReadTokens **−26%**（80,640→59,520），steps 11→8，modelCalls 13→9；任务完成率不变（4/4）。
2. **failure+progressed（nonatomic 场景）**：non-atomic 拒绝把**重复副作用从 4 次→1 次（−75%）**；每次拒绝的证据来自投影 fold 重导出（calls=1/2/3 + anyFailure）——policy 真的在消费 Progress，不是自己猜。
3. **零误介入**：success+progressed 对照格 interventions=0；success+stalled（noop）格只记录不介入；两个 aware 格任务全部完成（taskOk 4/4）。
4. **成本方向**：cacheRead 在 loop 格明确下降；nonatomic 格持平（a2 的 3 次被拒尝试抬高了往返成本——拒绝本身也要走一次工具往返，见不确定项）。input/output 方向混合，属 N=2 噪声带。

## 1. 设计（Projection 包零改动）

- 新增 `dsh-native-pp-policy`（`experiments/native-pp/policy/`）：极薄 consumer。
  - 消费：projection 包的纯 fold（`foldProjection` 作为库调用）+ policy 自有的 capability-effect **契约模型**（`pure/non-atomic/noop`）；
  - 介入：仅原生 `tools.guard`——拒绝时工具体不执行（零副作用）、模型收到 `Error: [progress-policy …]` 教学理由；
  - 零工具注册、零 prompt 编辑、零模型调用（policy.json 的 surface 字段可审计）。
- 效应模型归属说明：execution 事实来自投影（Event 流），effect 契约（谁 stalled/谁非原子）由 policy 声明——与四象限语义一致（effect 可观察性声明本就是契约）。
- 四格 policy：
  | execution | effect | policy |
  |---|---|---|
  | success | progressed | continue（对照格验证 0 介入） |
  | success | stalled | 本轮仅记录（noop 格） |
  | failure | stalled | circuit：同工具失败 ≥2 → 拒绝+教学理由 |
  | failure | progressed/unknown | non-atomic：任何先前调用后拒绝重试（防重复副作用） |

## 2. 数据

### loop（重复失败，N=2/臂）

| run | 真实执行 | retries | steps | modelCalls | cacheRead |
|---|---|---:|---:|---:|---:|
| baseline | 6 / 6 | 5 / 5 | 13 / 9 | 14 / 11 | 97,280 / 64,000 |
| aware | 2 / 2 | 2 / 2 | 7 / 9 | 8 / 10 | 47,104 / 71,936 |

### nonatomic（非原子失败，N=2/臂）

| run | 真实执行 | **重复副作用** | steps | modelCalls | cacheRead |
|---|---|---:|---:|---:|---:|
| baseline | 4 / 4 | **4 / 4** | 9 / 10 | 10 / 11 | 58,112 / 69,120 |
| aware | 1 / 1 | **1 / 1** | 6 / 10 | 7 / 11 | 45,824 / 84,480 |

### 对照

- noop（success+stalled）：两臂均 1 次调用、completed、0 介入。
- ok 对照（success+progressed，aware）：exp_reportCalls=1，interventions=0。

### 世界正确性

- nonatomic baseline：外部系统被写了 4 次（3 次是重复副作用）；aware：恰好 1 次。**这是非成本收益——世界更干净。**

## 3. Token 用量（本轮全部事后回溯，循环内零计量）

- input **28,412** | output **28,440** | cacheRead **571,136** | reasoning **13,716**（11 格合计）
- 单格明细见 `results/token-index.json`。

## 4. 不确定项

1. N=2，agent 行为方差大（如 nonatomic-b1 input=7,302 异常、a2 三次被拒仍继续尝试）；方向性结论可靠，幅度不能外推。
2. 拒绝本身也要走一次工具往返（denied 尝试计入 steps/toolCalls）——aware 臂的成本下界包含「agent 不听话时的反复被拒」。真实收益依赖 agent 遵从理由（本实验全部遵从，但这是模型行为不是机制保证）。
3. success+stalled 的 investigate 介入本轮未做（仅记录）；这是四个格中唯一未测 policy 行为的一格。
4. 契约模型（pure/non-atomic）当前由 policy 硬编码；扩展到任意 capability 需要契约来源（工具描述声明或 host 注册）——超出本轮范围。

## 5. 下一步（若继续）

- 若继续：Progress + polling/compaction/completion 之前，先补 success+stalled 的 investigate 介入与 N 扩到 ≥4；
- 若行为无改善则停——本轮**有改善**（两个核心格），理由成立。

## 6. 资产

- 实现：`experiments/native-pp/policy/`（consumer）+ `experiments/native-pp/fixture/`（exp_apply/exp_noop 与新场景）
- harness：`experiments/native-pp/harness/driver-pp2.ps1`、`task-loop|nonatomic|noop.txt`、`aggregate-consumer.mjs`
- profile：隔离 home `profiles/pp-c`（= pp-b + policy）
- 结果：`experiments/native-pp/results/`（11 格 + `consumer-comparison.md` + `token-index.json`）
