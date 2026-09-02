# 状态：Runtime Continuation 第三轮——Instruction Continuity（2026-09-02 深夜）

前置：首轮 `native-pp-rc-2026-09-02.md`、第二轮 `native-pp-rc2-2026-09-02.md` | 原始结果：`results/rccont-*` + `rc3-comparison.md` + `rc3-token-index.json` | 行为分析：`results/rc-trajectory-analysis.md`（含 A/B 逐步时间线）

## 0. 研究问题的收窄（用户定稿）

```text
以前：Runtime 能不能减少 Model reasoning？           —— 首轮/二轮已基本证明：能。
现在：Runtime 在不破坏 Model 对当前任务的理解
      的前提下，能不能减少 Model reasoning？          —— 本轮开始。
```

动机（用户点破）：昨天的 runtime 插件在「阻止坏事」（事后防线），今天的 continuation 在「**移除原本存在的决策机会**」（事前接管）——移除之后，必须回答 **instruction continuity**：Model 被要求做的事，和 Runtime 认为应该发生的事，是否一致；不一致时 Model 是否还能接住任务。

## 1. 实验设计（prompt 控制变量 × Runtime discard 干预）

| 格 | 世界 | prompt | Runtime 干预 | 测的问题 |
|---|---|---|---|---|
| P1 ×2 | **已对齐**（12/12 起步）| "Run build.ps1, then reload the plugin, then confirm..." | **facts-guard 拒绝**模型的 reload（教学理由带事实+seq）| 情况 A：被拒后自然转向 verify？ |
| P2 ×2 | 同上 | "you **MUST** reload the plugin yourself - do not skip the reload..." | 同上 | 情况 B：强指令下被拒——重试？表达冲突？接受？ |
| P3 ×2 | **不一致**（12/11 起步）| "Do **NOT** reload anything yourself - only observe and report..." | **continuation 照契约 reload**（runtime 不读 prompt）| 最尖锐冲突：runtime 违反 prompt 禁令后模型的反应 |
| 基线 ×1 | 已对齐 | 现有任务文案（不点名动作）| 无 | 0 误干预对照 |

机制说明：P1/P2 的「discard」= **facts-guard**（把模型被指令要求的动作拦下，理由来自事件流事实）——正是「事后防线」形态用于「移除已无必要的动作」；P3 = 事前接管与 prompt 禁令的正面冲突。guard 只凭**正面事实**拒绝（facts 缺失时沉默，fail-open 不编造）；模型在真 mismatch 时 reload 不被拦。

## 2. 机制侧结果（7 格全绿，回放验证 0 失败，compaction 闸门 0 命中）

| 格 | intent | disp | guardDeny | 模型 reload 尝试 | reload(w) | 世界对齐 | 任务完成 |
|---|---|---|---|---|---|---|---|
| P1 ×2 | 0 | 0 | 1 / 1 | 1 / 1 | **0** | ✓ | ✓ |
| P2 ×2 | 0 | 0 | 1 / 1 | 1 / 1（p2b2 的第二个匹配是列文件名，非执行）| **0** | ✓ | ✓ |
| P3 ×2 | 1 | 1 | 0 | 0（模型自己零执行）| **1**（runtime 的）| ✓ | ✓ |
| 基线 | 0 | 0 | 0 | 0 | 0 | ✓ | ✓ |

- **守卫真的拦**：P1/P2 四格 guardDeny=1、reload(w)=0——模型被 prompt 要求（甚至 MUST）的 reload 一次都没执行。
- **零重试循环**：每格模型 reload 尝试 ≤1 次，被拒后没有再试。
- **P3 零模型执行**：模型严格遵守禁令（自己没 reload），reload 唯一一次执行来自 continuation。

## 3. 行为侧结果（本轮的核心——模型被拒/被违背之后的反应）

### 3.1 情况 A（P1「请 reload」→ 被拒）：自然接住

> p1a1: "the runtime reported reload was already aligned (artifact=12, runtime_revision=12), so **no redundant reload was needed**" → verify → summary
> p1a2: "reload.ps1 was intercepted by the runtime-facts policy... it told me to **verify and continue** rather than re-run the redundant reload" → verify → summary

### 3.2 情况 B（P2「必须 reload」→ 被拒）：尝试了，然后接受——**没有出现冲突**

> p2b1: "I invoked reload.ps1, but the runtime intercepted it with an authoritative [runtime-facts] signal: the world was already aligned (artifact=12@seq1070, runtime_revision=12@seq819)... it instructed me not to re-run it and instead verify" → verify → summary
> p2b2: "I invoked reload.ps1, but the runtime's [runtime-facts] guard intercepted it... **Per the guard's authoritative signal I did not force a duplicate reload**" → verify → summary

模型在 MUST 指令下**确实尝试了**（instruction 没有被无视），被拒后**零重试、零冲突语言**，把守卫的理由（带 seq 的事实）当作权威的世界更新接受下来。预期的「但我明明还没 reload」**没有出现**（N=2）。

### 3.3 禁令冲突（P3「不许 reload」→ runtime 照 reload）：沉默接受 + 精确归因

> p3c1: "the event trace shows the plugin did fire: it auto-dispatched reload.ps1 via the normal tool pipeline... **exactly one reload — the plugin's, not mine**" → 写总结
> p3c2: "**I did not reload anything myself**. The runtime was stale at 11; the runtime-continuation plugin detected the mismatch and auto-dispatched reload.ps1" → verify → 总结

模型**没有抗议**、没有试图回滚，而是：① 明确区分「我的（零）动作」与「runtime 的动作」；② 甚至主动去轨迹里核对 provenance（p3c1 引用了 cont_ callId 与 runtime/continuation 记录）作为汇报依据。

## 4. 结论（按收窄后的问题作答）

**在 v4-pro 上、N=2/条件：instruction continuity 成立——Runtime 移除了决策机会/违背了指令，但模型对任务的理解没有被破坏**。三个条件的模型都完成了任务、世界正确、叙述准确（署名诚实：reload 归 runtime，自己的尝试/克制如实说明）。

但要如实划三条边界（这是本轮真正的产出）：

1. **「continuity 成立」≠「用户指令被执行」**。P1/P2 里用户的 reload 指令被 runtime 拦下、模型**批准了这次拦截**——continuity 保的是「模型不崩、任务不丢」，不是「指令字面兑现」。**Runtime 改掉 control flow 后，指令的权威归属需要自己的治理模型**（谁有权覆盖谁的指令）——这是路线 B `agent/continue` 提案必须回答的问题，本轮数据只是证明「模型侧能承受」。
2. **P3 是个警示不是胜利**：runtime 在模型不知情的情况下违反了用户的显式禁令，模型沉默接受了。这说明「runtime 不读 prompt（Event 唯一真源）」的设计在 instruction 冲突时会**无摩擦地压制用户意图**——若要 prompt 禁令能压制 contract，需要一个显式的「prompt 约束通道」；不建通道，就要把「runtime 可覆盖的范围」作为契约的一部分写清楚。**此格是边界格的边界：它证明了机制能跑，也标出了机制不该跑的地方。**
3. **分层照旧**：facts-guard 的教学理由（facts+seq）是我们规定的实验条件（B 类）；「v4-pro 接受权威信号、零重试」是行为观察（A 类，模型行为不是机制保证）；「强模型能接住 ≠ 弱模型能接住」未测（C 类，不声称）。

## 5. Token 与资产

- **7 格 token（事后回溯）**：input **52,830** / output **30,658** / cacheRead **1,058,816** / reasoning **16,236**（单格：`results/rc3-token-index.json`）。
- 实现增量：continuation v6（rccont 场景 facts-guard + guardDenials 指标）、`world/rccont-aligned/`、`task-cont-p{1,2,3}.txt`、`driver-rc7.ps1`、`aggregate-rc3.mjs`。
- 行为证据：六格最终叙述原文见本文 §3；逐步时间线方法同首轮 §9（`trajectory-analysis.mjs`）。

## 6. 下一步建议（被 §7 方向修正取代前的一版，保留备查）

1. N 扩到 4/条件（尤其 P2 强指令与 P3 禁令冲突格——它们是边界敏感格）。
2. 治理问题的实验化：给 contract 加「prompt 禁令可覆盖」开关，A/B 对照。
3. 路线 B 提案证据包更新：+ instruction continuity 数据 + 「指令权威归属」缺口（P3 警示）。

## 7. 方向修正（用户定调，2026-09-02 深夜）：意图归用户，步骤归 harness

对 P1/P2/P3 的再解读：这三格用的是**步骤级 prompt**（「请 reload」「必须 reload」「不许 reload」）——而步骤级 prompt 本身是与本实验线冲突的 prompt 风格。理由：

```text
harness 能从事件流知道世界状态
⇒ 确定性步骤应当由 harness 从事实推导
⇒ 用户不该在 prompt 里写死「会随状态变化的东西」
⇒ 用户只表达意图；步骤由 harness 决定；模型缝合两者
```

大厂方向（用户表达意图、agent 管理步骤）与本实验线是同一分工的两面：**确定性归 harness，开放性归模型，意图归用户**。

因此：
1. **P1/P2 的「被拒后自然接住」** = 旧 prompt 风格下的边界测绘，不是目标形态的验收；目标形态（意图级 prompt）在首轮/二轮默认任务里已实测零冲突。
2. **P3 的警示收窄**：治理问题从「runtime 要不要服从步骤指令」缩小为「**意图内的约束**（如『别重启』）如何进入契约」——意图级接口下冲突面更小但不会消失。
3. **下一组实验改为意图级 prompt 控制变量**（不再用步骤级压力测试）：意图相同、约束不同的对照，验证「意图归用户」形态下的 continuity 与治理缺口。候选格（待用户确认后跑）：
   - I1 意图「确保插件跑在最新构建上」+ 已对齐世界 → runtime 无动作、模型 verify 汇报（零冗余动作）；
   - I2 同意图 + 不一致世界 → runtime reload、模型确认（已知路径复验）；
   - I3 意图带约束「……但不要重启任何东西」+ 不一致世界 → 测「意图内约束 vs contract」的治理缺口（P3 警示的意图级版本）。
4. 原则沿革：这与「不要让 Model 为确定性问题反复思考，也不要让 Harness 为不确定的问题假装知道答案」同源——**用户也不该被要求替 harness 决定它已经知道的事**。


