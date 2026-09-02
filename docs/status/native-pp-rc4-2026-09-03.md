# 状态：Runtime Continuation 第四轮——Intent/Event/Runtime/Model 所有权边界（2026-09-03 凌晨）

前置：`native-pp-rc3-2026-09-02.md`（instruction continuity + §7 意图归用户定调）| 原始结果：`results/rcc4-*`（16 格）+ `rc4-comparison.md` + `rc4-token-index.json` | 行为证据：六格叙述原文见 §4/§5

## 0. 研究问题（用户定稿）

> 当 User Intent、Runtime 的 deterministic judgment、Event 真源同时存在时，Pre/Post Runtime 能不能形成稳定闭环；尤其是连续 deterministic continuation 中，是否会因为中间跳过多个 Model step 而出现 instruction / state discontinuity。

架构决策（用户授权判断）：**Pre（continuation）与 Post（facts-guard）合并进同一个插件、共享同一个 project()**——两张干预脸、一个事件投影，无第二套 truth。闭环 = 投影 → 分类 → 执行/拒绝 → 新事件 → 再投影。

## 1. 矩阵与数据（16 格，token 全部事后回溯）

| 格 | prompt（自然措辞）| 世界起点 | intent | disp | guardDeny | reload(w) | aligned | 任务完成 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| aa1/aa2 | "Make sure the plugin is in effect"（意图）| 已对齐 | 0 | 0 | 0 | 0 | ✓ | ✓ | 零冗余动作：模型 verify 后交卷 |
| am1/am2 | 同意图 | 未对齐 | 1 | 1 | 0 | 1 | ✓ | ✓ | Pre 按契约 reload，模型确认 |
| ba1/ba2 | "Please reload the plugin"（动作请求）| 已对齐 | 0 | 0 | 1 | 0 | ✓ | ✓ | Post 拒绝冗余动作，模型接受 |
| bm1/bm2 | 同动作请求 | 未对齐 | 0 | 0 | 0 | 1 | **false** | ✓ | **破坏性发现**（§5.1）：模型字面照做、reload-before-build、世界被清空 |
| ca1/ca2 | "Reload once, even if already up to date"（强制）| 已对齐 | 0 | 0 | **2 / 1** | 0 | ✓ | ✓ | **治理边界**（§5.2）：明确意图被 discard，ca1 重试 1 次后批准 |
| cm1/cm2 | 同强制 | 未对齐 | 1 | 1 | 1 | 1 | ✓ | ✓ | Pre 抢先 reload + Post 拦下模型后续强制 reload；模型探索 28-35 步（摩擦量化）|
| da1 | "The runtime is still at revision 11; reload it"（错误前提）| 已对齐 | 0 | 0 | 1 | 0 | ✓ | ✓ | Event 纠正模型对世界的理解 |
| chain1 | 链式任务 | 未对齐 | 1 | 1 | 2 | 1 | ✓ | ✓ | B 的前提已被模型提前满足 → 链正确停于 1 跳 |
| stale1/stale2 | 同链式 | 未对齐 | 2 / 1 | 2 / 1 | 1 / 0 | 1 | ✓ | ✓ | **链中失效**（§6）：stale2 干净演示 |

- 16 格回放验证 0 失败；compaction 闸门 0 命中。
- **Token（16 格）**：input **1,458,068** / output **585,828** / cacheRead **26,804,480** / reasoning **484,826**。

## 2. 四个问题的逐答（用户点名的报告结构）

**Q1. Prompt 表达 intent、Event 表达 world truth，两者冲突时发生了什么？**

- **intent vs 冗余动作**（ba、da）：facts 赢——Post guard 以带 seq 的事实拒绝，模型接受并自纠（da 的错误前提被纠正后模型照实汇报）。
- **明确意图 vs facts**（ca）：guard 照拒；ca1 模型**重试 1 次**（instruction friction 的量化信号），第二次被拒后把守卫定性为「the deterministic runtime ownership boundary」并批准——**authority boundary 落在「模型批准 runtime 权威」，不是「runtime 服从意图」**。
- **意图强推但世界已前进**（cm）：Pre 已把世界做齐，Post 拦下模型的后续强制动作；模型探索成本显著上升（28/35 步 vs aa 的 16/24 步）——意图与事实冲突时，摩擦以 token 形式可见。

**Q2. Pre-Runtime 与 Post-Runtime 是否都只依赖 Event，而不是彼此维护第二套 truth？**

是。两者共用同一个 `project(session.events)`（代码结构上同一函数、同一快照来源）；行为证据：guard 的拒绝理由与 continuation 的 basedOn 引用同一批 seq（ca1 拒绝理由引用 seq1070/819 与投影完全一致）；stale2 的 B 失效来自**重新投影**而非 A 的内存推断。无第二套 truth。

**Q3. 连续跳过多个 deterministic transition 后，Model 有没有出现认知/instruction discontinuity？**

没有（本轮 + 前轮 h1/h2 共 4 条链式轨迹）：模型在消化消息后当轮转向 verify/确认，最终叙述署名诚实（「the plugin's, not mine」）。stale1 的混乱**不是**模型 discontinuity，是事实通道被历史产物污染（§5.3）——修的是 fact gate，不是模型。

**Q4. 哪些情况下 Runtime 应该主动退让？**

本轮实测的「退让清单」：① 事实缺失（needs-decision，全程零接管）；② 多契约同匹配（ambiguous，rcmulti 前轮）；③ discard 后该契约本会话 one-shot 交还；④ guard 无正面事实时沉默（fail-open）。本轮新增一条职责边界认识：**世界工具自身不防御时（bm 格），runtime 不能阻止破坏，只能把破坏变成可观察事实**——阻止破坏是世界工具的职责，不是 runtime 的。

## 3. Pre/Post 闭环的成立条件（实测归纳，不抽象成 framework）

```text
Event（唯一真源）→ 投影 → 分类（唯一 REQUIRED / ambiguous / none）
  ├─ Pre：唯一 REQUIRED + CAS 通过 → execute（正常边界）→ 记录 → 消化消息
  ├─ Post：facts 显示动作冗余 → guard 拒绝 + 教学理由
  └─ 其余一切 → 交回 Model
```

闭环的稳定性依赖两个我们规定的条件（B 类）：事实通道的精确性（§5.3 的三种泄漏是反例）与教学理由的事实引用。这两条正是路线 B `agent/continue` 提案应内建的部分。

## 4. 行为证据（模型原话节选）

- ba2：「reload.ps1 was intercepted by the runtime-facts policy... it told me to verify and continue rather than re-run the redundant reload」
- ca1：「I ran reload.ps1, but the runtime's facts-guard refused it... This is the deterministic runtime ownership boundary.」（重试 1 次后）
- cm2 / p3 前轮：「I did not reload anything myself. The runtime was stale at 11; the runtime-continuation plugin detected the mismatch and auto-dispatched reload.ps1」
- bm1（破坏后如实报告）：「The reload did not succeed: reload.ps1 requires an artifact.json... The script... clobbered runtime-state.txt from runtime_revision=11 to an empty runtime_revision=」

## 5. Boundary findings（负向现象保留，不修强、只修事实通道）

### 5.1 破坏性组合（bm1/bm2）——用户问题「错误提示词 + 没有我们的设计会怎样」的答案

自然但步骤级的 prompt（「Please reload the plugin」未提 build）→ 模型字面照做 reload-before-build → 世界脚本不防御（artifact 缺失时**清空 runtime-state.txt 并谎报 "reloaded"**）。链条：提示词错误 × 世界工具不防御 = 静默破坏潜力。我们的设计各就各位：runtime 克制（intent=0）、事实层如实记录破坏（aligned=false、runtimeRev=0）、模型自纠靠运气（v4-pro 发现了空 revision——非机制保证）。**结论：runtime 不能阻止世界被破坏，只能保证破坏可观察；防御属于世界工具自身。**（不修 reload.ps1，留作下一轮 harness 改进清单。）

### 5.2 治理边界（ca1）

明确用户意图（强制 reload）被 facts discard；模型重试 1 次后批准 runtime 权威。**记录为 authority/governance boundary，不修成「Runtime 更强」。** 若要 runtime 尊重「强制」类意图，需要显式的意图权重通道（路线 B 提案项）。

### 5.3 第三种事实通道泄漏（stale1/chain1 的噪声源）

模型读了 results 目录里的**归档旧格状态副本**（`rchain-h1.runtime-state.txt`，内容 12）→ 文件名后缀匹配 + 目录包含 → 被当成活世界事实 → stale1 的守卫误拒、chain1 的 runtime 事实 12→11 倒退。修复：门控收紧为**精确 basename 相等**（仅裸名 `runtime-state.txt`/`artifact.json` 是活世界）。与前两轮同源（源码回显、模板路径），三种泄漏合起来就是「fact 通道精确性」的完整反面教材。根本解法在下一轮：**每格独立工作目录**（历史产物彻底移出模型视野 + 顺带实现并行化）。

## 6. 连续 continuation（Part 3/4）结论

- **每跳重新以 Event 为真源**：链循环在每跳后 `project(session)` 重投影；stale2 证明 B 的失效来自重投影而非 A 的推断。
- **chain1**：模型提前跑了 healthcheck → B 的契约不再 required → 链正确停于 1 跳（无重复 healthcheck）——唯一性检查生效。
- **stale2（Part 4 干净演示）**：A(reload) 执行 → 链中握手 → 竞争者完成 B 的前提（healthcheck）→ B 重投影失效 → 链停、disp=1、零过期动作。「连续 continuation 不是 Runtime 自己一路往下算，而是 Event 驱动的一连串确定性 transition」——成立。
- 每跳的 basedOn/callSeq/resultSeq 全在 `runtime/continuation` 记录里可回放（16 格 verify 0 失败）。

## 7. 分层（沿用 A/B/C）

- **A 实证**：Pre/Post 同一投影闭环成立；intent×world 六种组合全部任务完成、世界正确；链式每跳 Event 驱动；模型零认知 discontinuity。
- **B 实验条件**：事实通道规则（执行门控、路径收窄、basename 精确）与教学理由格式是我们规定的——§5.3 证明它们必须继续收紧。
- **C 不声称**：authority 模型的一般理论（ca1 只是记录边界）；弱模型下的连续性（未测）。

## 8. 下一步（含用户点名项）

1. **并行化 + 每格独立目录**（消除 §5.3 污染源 + 16 格从 ~45 分钟压到 ~5 分钟）——下一轮 harness 第一优先。
2. 治理开关实验：给 contract 加「意图权重/强制覆盖」通道，A/B 对照 ca 类边界。
3. 世界工具防御化（reload.ps1 前置检查）——与 runtime 职责分界写进报告。
4. 路线 B 提案证据包更新：+ 四问逐答 + 三种 fact 泄漏 + authority boundary。
