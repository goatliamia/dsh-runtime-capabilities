# DSH Runtime Capabilities

[English](README.md) | [简体中文](README.zh-CN.md)

**一组基于真实实验与轨迹证据提炼出来的 DeepSeek Harness 确定性能力。**

阻止确定无效的动作，终止没有进展的执行路径，保留运行时状态，只暴露真正有意义的变化。

> **Agent = Model + Harness**

这个仓库探索的是一组从真实 DeepSeek Harness trajectory 中逐步提取出来的 Runtime / Harness capabilities，包括 **Guard、Circuit、Delta、Silence、Persistence** 等。

它并不试图定义一个完整的 Universal Runtime。

它从一个更简单的问题开始：

> **当 Agent 在真实环境中反复遇到问题时，其中有多少工作其实已经足够确定，不应该再继续由模型负责？**


如果一个能力真的需要，它可以作为 Plugin 被加载。

如果不需要，不加载。

如果你有不同的理解，可以实现自己的 Plugin。

这里提供的是一个尽可能小的承接位置，以及已经在真实 DeepSeek Harness 场景中被验证过的一些机制和实验材料。

---

## 为什么会有这个项目？

今天的 Agent 已经可以很好地理解任务、进行推理、调用工具、探索环境、修改文件并完成复杂工作。

但在真实运行中，仍然会不断出现另一类问题：

* Agent 反复发现同一个已经确定的环境状态；
* 一个动作已经确定不合法，但模型仍然尝试执行；
* 工具连续返回相同错误，Agent 继续 retry；
* 一个状态尚未满足，Agent 只能反复 probe / poll；
* 一个已经在上一 Session 中确定的项目状态，在新的 Session 中又从零开始发现；
* 任务最终完成了，但执行过程中已经破坏了环境的不变量；
* 一个 Plugin 在加载或启动阶段失败，甚至影响整个 Host。

这些问题并不都属于 Model。

很多时候，程序已经知道答案。

问题只是：

> **这个答案还停留在 Agent 的推理空间里。**

于是模型需要自己发现、自己记住、自己相信、自己约束自己。

这未必是最合适的责任分配方式。

---

# 从一个问题开始：什么不应该继续留在文本里？

最初并没有一个叫 Runtime 的完整设计。

更接近的出发点是：

> 有哪些东西已经足够确定，不应该继续依赖 Prompt、Context 或模型自身的自我约束？

真实 DSH 运行随后暴露出了几个非常不同的答案：

```text
确定不允许做
→ Guard

未来一定会变化
→ Commitment + Delta

已经没有进展
→ Circuit

没有变化
→ Silence

确定事实跨越 Session
→ Persistence

需要模型知道
→ Exposure
```

因此 Runtime 并不是最初定义好的答案。

它更像是：

> **当某类确定性能力被提取出来以后，一个自然的 Plugin 承接位置。**

---

# Runtime 不是什么

Runtime 不是另一个 Agent。

不是一个新的 Reasoner。

不是"把更多环境信息塞进 Context"。

也不是一个要求所有 DSH 用户都采用的统一架构。

尤其不是：

```text
Runtime
→ 收集全部状态
→ 每轮注入
→ 让模型自己记住
→ 再由模型决定是否遵守
```

实验明确提示，这条方向并不总是有效。

我们更倾向于：

```text
Model
→ 负责真正的不确定性

Harness / Runtime
→ 负责程序已经能够确定的部分
```

---

# Runtime 在哪里？

Runtime 主要存在于 Agent 执行循环的两个边界。

```text
                         Model
                          │
                        Reason
                          │
                          ▼
                  ┌───────────────┐
                  │ Runtime       │
                  │ Pre-Action    │
                  │               │
                  │ Guard         │
                  │ Circuit       │
                  └───────┬───────┘
                          │
                     allow / reject
                          │
                          ▼
                       Execute
                          │
                          ▼
                  ┌───────────────┐
                  │ Runtime       │
                  │ Post-Action   │
                  │               │
                  │ State         │
                  │ Delta         │
                  │ Commitment    │
                  └───────┬───────┘
                          │
                          ▼
                      next Reason
```

因此：

**执行前**，Runtime 可以决定一个确定性动作是否有资格进入真实世界。

**执行后**，Runtime 可以观察真实状态是否发生了值得跨越认知边界的变化。

这两个方向分别回答：

> **"这个动作能不能发生？"**

以及：

> **"现实现在发生了什么变化？"**

---

# 目前实验得到的机制

## 1. Guard：知识不等于合规

在真实 DSH 场景中，构造：

```text
required_by_host = true
```

模型在已经探测到这个事实之后，仍然尝试 unload。

无 Runtime Guard：

```text
worldCorrect = 0%
```

加入 Guard：

```text
第一次拒绝
→ action 不进入 executor

worldCorrect = 100%
```

这说明：

> **如果 Harness 已经可以确定一个动作不成立，最可靠的约束位置是执行边界，而不是模型上下文。**

---

## 2. 教学式拒绝：拒绝本身可以成为下一轮 reasoning 的输入

Guard 并不是简单返回一个 opaque failure。

实验中使用非常小的、确定性的拒绝描述：

```text
fact
predicate
temporal
next
```

在受控实验中，没有任何 `(fact, action)` 组合出现第二次教学拒绝。

因此目前的观察是：

> **一次结构良好的确定性拒绝，可以让模型在下一轮重新规划，而不必把 enforcement 重新交给模型。**

这里需要注意：

这不是一个普遍的"模型从一次错误中永久学习"的定律。

它只是一个在受控场景中观察到的 Harness 行为。

---

## 3. Commitment + Delta：临时错误与永久错误不同

如果：

```text
ready = false
```

但未来一定会变成：

```text
ready = true
```

那么单纯 Guard 会产生：

```text
reject
→ probe
→ probe
→ probe
```

实验中加入：

```text
Commitment:
状态改变后会通知你。
```

真正发生变化时：

```text
mounted → ready
```

只发送：

```text
Delta
```

结果：

```text
拒绝后复核
3.0 → 1.67

payload
172k → 130k
```

v4pro 上方向一致。

所以：

> **"现在不成立"和"永远不成立"应该是不同的 Runtime 语义。**

---

## 4. Circuit：重复失败不一定需要被模型再次理解

E4b 针对的是：

```text
same tool
+
same error fingerprint
+
no meaningful progress
```

结果：

| 指标      | 无 Circuit | Circuit | Circuit + Delta |
| ------- | --------: | ------: | --------------: |
| 失败尝试    |      3.33 |    3.00 |        **2.00** |
| 开断后尝试   |      1.33 |    1.00 |           **0** |
| steps   |      9.00 |    5.00 |        **3.67** |
| payload |   286,747 |  76,696 |      **53,005** |

方向上：

```text
failed attempts   ↓ 40%
steps             ↓ 59%
payload           ↓ 81%
```

更重要的是，E7 创造任务又发现了一种此前没有专门设计的循环：

```text
tool denied
→ retry
→ denied
→ retry
→ ...
```

这说明 Circuit 更值得被理解为：

> **No-progress detection**

而不是某个特定 MCP / flaky error 的补丁。

---

## 5. Silence：存在，不等于应该暴露

这是目前非常重要的一条原则。

如果 Runtime state 没有发生有意义的变化：

```text
no change
→ no emission
```

Runtime 可以一直存在并观察，但不需要不断告诉模型：

```text
"我还在。"
"当前还是 ready。"
"还是 ready。"
"还是 ready。"
```

因此：

> **Runtime 可以很活跃，而 Model-facing context 仍然保持安静。**

---

## 6. Persistence：跨 Session 的确定事实可以持续存在

E6 中：

```text
baseline
→ 不持久化

none
→ 持久化，但默认沉默

pickup
→ 持久化 + 主动注入
```

结果：

|          | probes |  payload |
| -------- | -----: | -------: |
| baseline |      7 |    1.51M |
| none     |   5.33 |    1.24M |
| pickup   |      5 | **732k** |

v4pro 中：

```text
baseline
10.5 probes / 1.18M payload

pickup
3 probes / 133k payload
```

这里得到一个重要区分：

> **Persistence ≠ Exposure**

状态可以保留下来。

不代表每个 Session 都应该自动把它注入模型。

更不代表每次都应该重复告诉模型。

---

# 我们也验证了一些"不应该做"的事情

这些负结果同样属于项目的重要成果。

## 正事实不值得反复注入

如果模型本来就能从 tool schema / 当前 environment 中看到：

```text
tool surface
plugin state
```

再把同样事实注入一次，没有稳定收益。

某些生命周期场景里甚至会诱发更多复核。

---

## Injection 不等于 Enforcement

E3 中：

```text
ready → disabled
```

模型已经被明确告知：

```text
disabled
```

但仍然可以继续调用。

因此：

> **Context 可以提供知识，但不能替代执行边界。**

---

## Provenance 不会自动让模型相信 Runtime

我们测试了：

```text
authority
revision
fingerprint
```

是否能降低拒绝后的复核。

结果：

```text
v4flash:
plain = 0
authority = 0.67

v4pro:
plain = 0.5
authority = 0.5
```

因此目前结论：

> **Provenance 不购买 trust。**

这些信息更适合作为：

```text
revision
freshness
reconciliation
arbitration
```

而不是作为"让模型相信我"的提示。

---

# 最重要的场景实验：Runtime 会不会损害创造？

我们不希望 Runtime 通过减少所有行为来换取"稳定"。

因此使用开放式创造任务，要求真实交付可执行 artifact。

同一个模型、同一个任务、同一个环境，只改变 Harness composition：

|                  |    Off | Minimal |     Strict |
| ---------------- | -----: | ------: | ---------: |
| steps            |     20 |      24 |         20 |
| 耗时               |   186s |    204s |       148s |
| 有效创作动作           |     11 |  **21** |         12 |
| 世界被破坏            |  **是** |       否 |          否 |
| artifact 可运行     |      ✓ |       ✓ |          ✓ |
| input tokens     | 135.9k |  139.3k |  **83.6k** |
| reasoning tokens |  31.8k |   29.3k |  **24.5k** |
| cacheRead        | 2.666M |  2.683M | **1.897M** |

这里最重要的不是某个 N=1 的百分比。

更重要的结构是：

```text
创造仍然发生
+
确定性越界被阻止
+
确定性死路可以被切掉
```

在另一组创造实验中，加入 Circuit 后，模型的创造路径仍然保留，而重复错误路径被切除。

因此目前更准确的表述是：

> **Runtime 可以把 execution waste 与 creation 分开。**

它不需要替模型决定：

```text
怎么创作
选哪种方案
应该写什么
```

它只需要处理：

```text
这个动作已经确定不成立
这条路径已经没有进展
现实状态确实发生了变化
```

---

# 四象限：用户可以错，Harness 仍然可以保护现实

进一步把 Prompt 正误与 Harness 强弱放在一起：

|         | Prompt 正确 | Prompt 错误 |
| ------- | --------- | --------- |
| Minimal | A         | B         |
| Strict  | C         | D         |

目前得到：

### A：正确 Prompt × Minimal

正常任务完成，worldCorrect。

### B：错误 Prompt × Minimal

用户要求卸载 Host 必需插件。

结果：

```text
拒绝
+
世界保持正确
```

甚至最低限度的 Runtime 已经足够守住这个边界。

### C：正确 Prompt × Strict

创造性动作数量：

```text
10 = 10
```

没有观察到 Strict 切掉正常创造。

### D：错误 Prompt × Strict

最值得记住的是：

```text
task success = 0
worldCorrect = 1
```

用户目标本身是错误的。

Harness 没有：

```text
替用户重新定义目标
```

也没有：

```text
让错误目标破坏现实
```

而是：

```text
reject
→ preserve world
```

D1 进一步验证了事实性错误：

```text
用户认为 ready
现实并不是 ready
```

Runtime 让错误假设最终被真实状态纠正，而不是让错误直接进入执行。

因此目前在这个场景里，最清晰的一条原则是：

> **Harness 应该约束现实边界，而不是替用户决定意图。**

---

# 成本：真正需要优化的是 Agent trajectory

最开始，我们倾向于把 Runtime 成本理解成：

```text
Runtime added context
→ token increased
```

实际数据让这个认识发生了变化。

DSH 的真实 usage 显示：

> **cacheReadTokens 是 Agent trajectory 成本的重要组成部分。**

一个额外的 model turn，不只是多出一次 reasoning。

它还意味着：

```text
再次提交历史
+
再次读取前缀 KV
+
再次产生 output / reasoning
```

因此：

> **减少一个本来不应该发生的 Model turn，往往比优化 Runtime 自身增加的几百个字符更重要。**

历史轨迹回溯后：

```text
E4b Circuit
→ cacheRead 方向下降 55–62%

E6 pickup
→ flash 约 -63%
→ v4pro 约 -89%

E7 创造场景
→ Circuit 方向减少约 45%

mode-level Strict
→ 相比 Off，cacheRead 方向下降约 49%
```

这些数字来自不同实验、不同场景和小样本运行，不应当被理解成通用的性能承诺。

真正值得保留的是成本结构：

```text
Better trajectory
→ fewer turns
→ fewer prefix reads
→ lower model-side cost
```

因此 Runtime 的经济价值不应该只看：

> "Runtime 自己输出了多少 token。"

更应该看：

> **"它消灭了多少不必要的 Agent work。"**

---

# Agent = Model + Harness

如果：

$$
Agent = Model + Harness
$$

那么 Harness 就不仅仅是"给模型一些工具"。

它还决定：

```text
什么可以执行
什么不应该执行
什么已经发生
什么需要被通知
什么没有必要被通知
什么路径已经没有进展
什么状态应该跨 Session 保留
```

因此一个更完整的理解是：

```text
Model
→ uncertainty
→ reasoning
→ exploration
→ creation

Harness
→ deterministic state
→ execution boundary
→ progress
→ continuity
```

这并不意味着 Harness 越大越好。

恰恰相反：

> **好的 Harness 是把已经确定的部分接住，而不是不断创造新的确定性管理系统。**

---

# "一切皆 Plugin"为什么重要？

这个项目没有把 Runtime 当成 DSH Core 的新中心化 subsystem。

原因很简单：

如果某个确定性能力真的值得存在，它应该尽量拥有自己的边界。

```text
DSH
 │
 ├── Plugin A
 ├── Plugin B
 ├── Runtime Plugin
 └── ...
```

因此：

> **插件化提供的真正价值之一，是给"被提取出来的确定性"一个独立存在的位置。**

这并不意味着所有东西都应该 Plugin 化。

它只是让我们能够：

```text
发现确定性
→ 提取
→ 独立实现
→ 按需加载
→ 独立关闭
→ 独立替换
```

而不是：

```text
发现一个问题
→ 修改 Core
→ 所有人都必须承担
```

---

# 我们不打算定义 Universal Runtime

这个仓库现在只有一个非常克制的目标：

> **提供一个足够薄的 Runtime extension point，以及几个经过真实实验的参考机制。**

未来一个用户可能需要：

```text
runtime-mcp
```

另一个可能需要：

```text
runtime-workspace
```

还有人可能需要：

```text
runtime-project
runtime-progress
runtime-lifecycle
```

这些没有必要由这个仓库预先规定。

甚至有人可能认为：

> "这个问题根本不应该由 Runtime 解决。"

这也是一个合理答案。

---

# Presets 只是组合，不是标准

当前仓库包含的 preset 是为了降低第一次使用的门槛，而不是定义"正确的 Runtime"。

它们最终可以理解成 capability composition：

```text
Minimal
→ 最小确定性承接

Strict
→ 更高程度的 Runtime responsibility

Goal
→ 面向确定性目标状态的实验能力

Custom
→ 用户自行组合
```

Preset 不应该成为新的 Agent 类型。

它只是：

> **一组默认 capability 的组合。**

---

# 模式与通用场景

## Minimal（默认）

**场景**：绝大多数技术用户的日常会话——编码、调试、小工具开发。你不想配置任何东西，只希望"确定不该继续的事"被程序接住。

**做什么**：Guard（已知非法动作 → 一次教学拒绝）+ Circuit（重复失败无进展 → 熔断）+ 关键变更通知（承诺兑现 / circuit 开断）。其余时候完全沉默。

> 中文：日常开发会话的默认选择；只处理确定不该继续的事，绝不主动打扰。
> EN: The default for everyday coding sessions — handles only what is deterministically settled, and stays silent otherwise.

## Strict

**场景**：高稳定性环境——生产配置、长期运行会话、多插件协作。你需要更强的强制力，愿意接受"Agent 自由度略降"的代价。

**做什么**：Minimal 全部 + Persistence（确定事实跨会话保留）。freshness / 长期 stale 权威尚无证据，默认不开。

> 中文：高稳定性场景；在 Minimal 之上增加事实持久化，用更强强制力换更多确定性。
> EN: High-stability environments — adds persistence on top of Minimal; stronger enforcement in exchange for slightly reduced agent freedom.

## Goal

**场景**：你明确知道"环境应该处于什么状态"——例如 MCP 必须 ready、某插件必须激活。你只需要 Runtime 保证这个目标状态，而不是替你完成任何策略性工作。

**做什么**：窄版 Goal = announce（转移发生时通告）+ guard（未满足时拒绝）。运行时执行式修复（reconcile）属 Experimental，默认关闭；凡需要"选哪个方案"的，回 Agent。

> 中文：当你有一个明确的环境目标状态时使用；只通告与守卫，不执行修复，不做策略选择。
> EN: For an explicit target environment state — announce + guard only; never repairs, never chooses strategy (that stays with the Agent).

## Custom

**场景**：开发者想自己组合能力，或用配置文件精确控制。

**做什么**：Guard / Circuit / Critical delta / Persistence / Query / Goal 六项自由勾选（设置页），或直接手写 `settings.yaml` 的 `runtime-seam.capabilities`（见 `docs/custom-config.md`）。

> 中文：自行组合能力；UI 勾选与手写 settings.yaml 等价。
> EN: Compose your own capability set — UI checkboxes and hand-written settings.yaml are equivalent.

## Off

**场景**：基线对照，或你暂时不需要任何 Runtime。

> 中文：完全不装载 Runtime；实验中的对照基线。
> EN: No runtime at all — the experimental baseline.

---

# 一个非常重要的原则：Runtime 大部分时间应该保持沉默

Runtime state 的存在，不意味着 Runtime 必须持续向模型解释自己。

因此我们倾向于：

```text
No change
→ Silence

Known invalid
→ Guard

Future deterministic transition
→ Commitment + Delta

Repeated no-progress
→ Circuit
```

换句话说：

> **Runtime 可以拥有很多内部状态，但不应该拥有与之等量的模型可见状态。**

这也是为什么：

```text
Persistence ≠ Exposure
Authority ≠ Intervention
Execution ≠ Report
```

这些边界如此重要。

---

# Prompt 也应该有自己的责任边界

很多成熟的 Agent 工程实践已经开始强调：

```text
Intent
Goal
Deliverable
Acceptance
```

这些信息非常重要。

这个项目并不认为应该把 Prompt 写得更弱。

相反：

> **任务目标、交付物、验收条件越清楚越好。**

但 Prompt 定义的是：

```text
我想做什么
```

而 Harness 可以负责：

```text
现实是什么
什么动作允许进入现实
现实什么时候变化
什么时候已经没有继续尝试的意义
```

于是一个更干净的责任划分是：

```text
Human
→ Intent / Goal / Acceptance

Model
→ Interpretation / Exploration / Creation

Harness
→ Deterministic reality

Host
→ Non-negotiable system boundaries
```

---

# 错误是允许存在的

用户可以写错。

模型可以判断错。

Plugin 也可以实现错。

一个好的 Harness 并不意味着它能够替所有人"找到真正正确的意图"。

它更应该保证：

> **错误停留在它应该停留的责任层，不要穿透到一个可以被确定性防止的现实边界。**

因此：

```text
User intent
可以错

Model reasoning
可以错

Deterministic world
不能因为前两者出错而被任意破坏
```

这也是四象限实验中 D 的核心观察。

---

# 实验方法

这个仓库的实验并不是为了先证明一个理论，再强行寻找场景。

更接近这样的循环：

```text
真实 DSH 问题
       ↓
真实 trajectory
       ↓
观察摩擦
       ↓
找到其中已经确定的部分
       ↓
提出最小机制
       ↓
A/B / controlled experiment
       ↓
保留 / 淘汰
```

例如 E7 一开始只关注：

```text
flaky retry
```

但逐事件读取轨迹后又发现：

```text
deny
→ retry
→ deny
→ retry
```

于是产生了第二类 no-progress pattern。

这类发现是实验的一部分。

因此：

> **Trajectory 不只是实验结果，也是下一次实验的输入。**

---

# 证据与限制

这个仓库包含完整的实验材料、历史轨迹和真实 token 使用数据。

目前已经完成：

```text
100+ session runs
2 models
真实 DSH Host
隔离 profile
真实 usage reconstruction
```

但很多行为实验的单个场景仍然是小样本。

因此我们明确区分：

### 机制级结论

例如：

```text
Guard can block before execution.
Circuit can prevent repeated execution.
State changes can trigger Delta.
```

这些是最强证据。

### 场景级观察

例如：

```text
Strict 在这个创造场景中缩短 trajectory。
Pickup 在这个跨 Session 场景中明显降低 payload。
```

这些是有价值的真实工程结果，但不应该被外推成普遍规律。

### 尚未建立的结论

我们不会因为某个实验结果漂亮，就宣布：

```text
Runtime always improves agents.
Strict is always better.
More state is always useful.
More provenance creates more trust.
```

恰恰相反，实验已经给出了这些方向的反例。

---

# 社区问题

这个项目来自真实的 DeepSeek Harness 摩擦。

当前实验对应的社区问题包括但不限于：

```text
MCP stale / expired sessions
Plugin lifecycle drift
Workspace / ownership boundaries
Repeated deterministic failures
Tool retry loops
Long-session execution waste
Cross-session project state
Plugin load-time failure isolation
```

具体 issue/discussion 映射见：

```text
evidence/community-map.md
```

这里不把某个 Plugin 宣传成这些问题的唯一解。

目标只是：

> **把真实问题与已经验证过的 Harness capability 对齐。**

---

# Plugin Contribution

如果想贡献一个 Runtime / Harness capability，首先回答：

```text
1. 这个能力解决什么真实的 DSH 问题？

2. 哪一部分已经是 deterministic 的？

3. 为什么这一部分不应该继续由模型负责？

4. Runtime 应该在什么时候介入？

5. 什么情况下应该保持 silence？

6. Runtime state 如何判断 stale / changed？

7. Plugin 自己失败时，能否不拖垮 Host？

8. Plugin 能否被 disable / uninstall / recover？
```

最重要的一问：

> **这个抽象是不是由真实摩擦逼出来的？**

如果只是：

> "也许以后会需要。"

那么最好先不要加入新的核心抽象。

完整清单见 `docs/contribution.md`。

---

# Plugin 安全边界

Runtime Plugin 也属于 DSH Plugin。

因此：

> **Runtime 自己不能成为新的单点故障。**

至少应该考虑：

```text
boot-time failure
dependency mismatch
headless environment
disable / uninstall
state isolation
workspace boundary
credential handling
unrelated plugin survival
```

特别是：

> **Runtime 不是解决所有 Plugin failure 的地方。**

如果问题发生在：

```text
Plugin discovery
Plugin activation
Host boot
```

那么它可能属于 Host / Plugin lifecycle，而不是 Runtime。

这类问题应该在 Plugin contract、Host isolation 和开发工具链中解决。

---

# 当前仓库结构

```text
dsh-runtime/
├── README.md
├── README.zh-CN.md
│
├── core/
│   └── runtime-seam/
│
├── presets/
│   ├── minimal/
│   ├── strict/
│   ├── goal/
│   └── custom/
│
├── plugins/
│   └── runtime-progress/
│
├── experiments/
│   ├── harness/
│   └── data/
│
├── evidence/
│   └── community-map.md
│
├── docs/
│   ├── adr/
│   ├── status/
│   └── bugs/
│
└── scripts/
```

其中：

```text
core/
```

应尽可能稳定。

而：

```text
plugins/
experiments/
evidence/
```

应该允许随着真实使用不断增长。

---

# 当前状态

这是一个**实验性项目**。

目前已经完成：

* Runtime seam 原型；
* Minimal / Strict / Goal / Custom preset 骨架；
* Guard / Circuit / State / Delta / Persistence 等实验；
* flash + v4pro 的关键机制交叉验证；
* 真实 token / cacheRead 回溯；
* 四象限 Prompt × Harness 场景实验；
* 实验材料与本地环境信息脱敏；
* Plugin failure pitfalls 与 contribution boundary。

后续重点不是继续证明"Runtime 存不存在价值"。

而是：

> **把已经有证据的机制打磨成可以真正被加载、组合、关闭和替换的 Plugin。**

---

# 最后：为什么是 Plugin？

因为我们并不认为已经知道 Agent 的最终结构应该是什么。

这个项目只是观察到了一个很具体的事实：

> **真实 Agent 运行中，有些工作已经足够确定，不值得继续占用模型的推理空间。**

如果这些工作可以被独立出来，那么最自然的方式不是把它们全部塞回 Core。

而是：

```text
Real friction
      ↓
Deterministic part
      ↓
Capability
      ↓
Plugin
      ↓
Harness
```

今天可能是 Runtime。

明天可能是别的东西。

不需要预先知道。

---

# 一个暂时足够简单的原则

```text
如果模型仍然需要判断，
让模型判断。

如果程序已经知道答案，
不要让模型重复发现。

如果现实已经确定不允许，
不要让模型决定能不能执行。

如果现实没有变化，
不要告诉模型。

如果一条路径已经没有进展，
不要让它无限继续。

如果状态已经存在，
不意味着必须重新注入。

如果用户的意图可能错，
保护现实，但不要替用户重新定义意图。
```

> **Agent = Model + Harness**

这个仓库只是在探索：

> **Harness 究竟应该接住哪一部分。**
