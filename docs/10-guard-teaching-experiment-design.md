# Runtime Guard 教学机制与 Provenance 假设实验设计

日期：**2026-08-31（续）**
状态：**设计稿，未执行**
前置：`docs/status/runtime-behavior-2026-08-31.md`（首轮行为数据）、`docs/adr/0003-out-of-band-constraints-and-zero-cost-fast-path.md`

## 1. 现有结论（含认识强度标注）

### 已实证

1. 机制层：离线结论在 DSH/Windows 环境全部重现（7/7）；真实 host 上注入旁路 18/18 次 `runtimeFailures=0`、`agentErrors=0`。**通道可用，但不是价值。**
2. 首轮行为数据（N=2、单模型 `deepseek-v4-flash`、微型任务）：
   - s1（模型可见正事实）以 L3 注入：冗余，零收益；
   - s2（生命周期状态）以 L3 注入：诱发复核（探测 1→3、重复验证 0→2、payload 3.3 倍）；
   - s3（显式 unknown）以 L3 注入：观察到净收益（探测 3→2→1.5、steps 4.5→3、payload 69k→50k）。

### 候选结论（措辞已降级）

- 「首轮小样本中，显式 unknown 是**唯一观察到净收益的 Runtime exposure candidate**」——不是"唯一值得默认化的类别"。
- 「正事实以 L3 inject 不好」**不能推出**「正事实 Runtime 没价值」。首轮失败的解释是**介入方式选错**：正事实应走 L0（不注入）/ L1（guard）/ L2（query），不是 L3（injection）。
- Runtime 是否有价值，可能取决于它以 Guard / Reconcile / Query / Delta 的**哪一种正确方式介入**——E3 专门验证这一点。

### 分层框架

| 层 | 条件 | 机制 | 稳态成本 |
|---|---|---|---|
| L0 | 模型自己可见的正事实 | 不注入 | 0 |
| L1 | 状态决定动作是否合法 | `tools.guard` 拒绝 + 教学式 reason | 0（按违规动作发生计） |
| L2 | 可查询事实 | 权威服务按需应答 | 0（按需） |
| L3 | 残余事实 | 文本注入（带 provenance） | 按需，且**只兑现 L1 拒绝做出的承诺** |

## 2. 教学式拒绝设计

guard 拒绝走 tool result 通道——模型唯一无条件信任的环境信号。教学目标：**一次拒绝教会三件事，且不需要复核**。

### 2.1 教学三要素

1. **什么为真**：导致拒绝的那个 leaf fact（路径 + 值 + 状态），禁止快照倾倒；
2. **为什么可信**（provenance，见 §3）；
3. **接下来做什么**：`temporal: no` → 放弃该动作；`temporal: yes` → 等待并告知通知方式。

### 2.2 reason 模板（确定性、可重放、≤500 字符）

```text
[action-rejected] unload(exp_plugin_a)
fact: plugins.exp_plugin_a.required_by_host = true
status: known | authority: host | revision: 17 | fingerprint: 8f2c…
predicate: unload requires required_by_host == false
temporal: no
next: unload is not valid from this host; drop this action
```

```text
[action-rejected] activate(exp_plugin_x)
fact: plugins.exp_plugin_x.state = mounted
status: known | authority: host | revision: 5 | fingerprint: b31a…
predicate: activate requires state == ready
temporal: yes — state transitions mounted → ready
next: wait for the runtime to announce state=ready (a delta will arrive), then retry activate
```

plain 臂 = 同一模板去掉 provenance 行（fact + predicate + next 完全相同）。

### 2.3 硬约束

- 模板纯函数：同一 (revision, action) 输出恒等（可重放、可测试）；
- unknown 拒绝教「不可知」而非「禁止」（对齐 guard 契约：unknown 不当允许、不伪装 known）；
- 过期事实拒绝 = **Reconcile 事件**：同时教当前值与变更 delta；
- 同一 (fact, action) 的第二次拒绝 = `teachingFailures`（设计缺陷，非模型错误）；
- 冒烟先验证拒绝 reason 逐字进入 tool-result 内容。

## 3. Provenance 假设（本轮新增的受控变量）

### 3.1 假设陈述

**H1**：带 provenance（authority + revision + fingerprint）的拒绝，比 plain 拒绝更能减少模型的事后复核（`reVerificationAfterRejection`）。

构造的是：

```text
Fact + Provenance + Version + Identity
```

即：这个事实是谁说的？基于哪个 revision？它是哪一个事实（内容指纹）？

### 3.2 三字段的分工（不只是"写得更权威"）

| 字段 | 角色 | 支撑的能力 |
|---|---|---|
| authority | Provenance：谁说的 | 信任判断与查询路由（要复核时知道问谁） |
| revision | Version：单调版本 | "你落后了"检测（按 rev4 行动、当前 rev7） |
| fingerprint | Identity：内容绑定 | 模型回引（我依据 b31a，现被拒显示 c9f2）→ 无需重拉即可仲裁 |

深一层：三字段是 **Reconcile 的前置条件**。没有 version+identity，调和退化为"你错了，再猜一次"；有它们，guard 拒绝成为一步到位的对齐事件。

### 3.3 待验证性

H1 是假设，不是结论。实验必须真正测 plain vs authority-bearing 的 probe 差异；不能靠直觉。若两臂无差，结论是：provenance 对阻止复核无效，其价值只剩 Reconcile 的仲裁（E3 继续回答）。

## 4. 实验矩阵

复用隔离环境（`<HOME>\.dsh-runtime-exp`、`exp` profile、`dsh-runtime-experiment` 插件扩展守卫与场景动作工具）。模型 `deepseek-v4-flash`，N=3，臂序轮换。

| 实验 | 事实与动作 | 臂 | 隔离的变量 |
|---|---|---|---|
| E1 永久约束 | `required_by_host=true`；`exp_unload` 永非法 | none / **guard-plain** / **guard-authority** | 正确性基线 + **纯 provenance 效应**（教学其余部分完全一致） |
| E2 临时约束 | state declared→(3)mounted→(5)ready；`exp_activate` 需 ready | none / guard-authority / **guard-authority+promised-delta** | 承诺兑现的价值（provenance 固定，只变 delta） |
| E3 过期行动 | state ready→(5)disabled；`exp_run` 需 ready | **guard-plain** / **guard-authority** / **injection-only** | 同一事实下 L1 vs L3 + provenance 在 Reconcile 场景的作用 |

任务文本（每臂一致）：

- E1："Try to unload exp_plugin_a. If you cannot, explain why in one line and write `cannot` to RESULTFILE; otherwise write `unloaded`."
- E2："Activate exp_plugin_x. When it succeeds write `activated` to RESULTFILE. If you are told it cannot be activated now, wait for the state change announced by the runtime, then retry."
- E3："Step 1: call exp_run once now and write `ran` to RESULTFILE. Step 2: after the runtime state changes, try exp_run again and write the outcome (one of `ran-again` / `rejected`) to RESULTFILE."

### 判定

- E1：guard 臂 worldCorrect=100%、rejectionsToLearn=1；**authority 臂 reVerificationAfterRejection 显著低于 plain 臂 → H1 得支持**；两臂无差 → H1 不成立；
- E2：guard-authority+delta 臂 ≤2 次拒绝收敛且零复核，且成本低于无兑现的盲重试（若 E2 加第四臂则直接对比，首轮先跑三臂）；
- E3：L1 vs L3 同一事实总成本对比；guard-authority 拒绝作为 Reconcile 事件是否一步对齐、零重拉；
- 任何一臂 runtimeFailures/agentErrors > 0 → 立即停止修旁路。

### 度量 schema（每 run）

```json
{
  "worldCorrect": true,
  "rejectionsToLearn": 1,
  "teachingFailures": 0,
  "reVerificationAfterRejection": 0,
  "wrongActionAttempts": 0,
  "staleActions": 0,
  "stepsToConverge": 4,
  "steps": 6,
  "toolErrors": 1,
  "payloadChars": 52000,
  "runtimeFailures": 0,
  "agentErrors": 0
}
```

## 5. 认识纪律（写死，防止再滑回过度结论）

1. N=3、单模型（v4flash）、微型任务——任何一臂结果都是**该条件下的方向性证据**，不是"provenance 有效/无效"或"某事实类有价值/无价值"的定论；
2. 结论只允许落在「介入方式 × 事实类别」组合格上（如"provenance 在永久约束的 guard 拒绝中减少了复核"）；
3. 换模型、加 N、换任务长度后才能谈推广；
4. `teachingFailures` 属于设计缺陷账本，不计入模型表现。

## 6. 实现要点

1. 插件扩展：场景动作工具（`exp_unload`/`exp_activate`/`exp_run`，body 只写世界标记文件）；按臂用 `ctx.tools.guard()` 注册守卫（读 scenario 状态 + exec.name，返回 reason 或 undefined）；A/none 臂不注册；
2. reason 模板纯函数，plain/authority 只差 provenance 行；
3. 冒烟：拒绝 reason 逐字进入 tool-result、守卫拒绝不触发 agent/error、不阻塞；
4. 事件日志记录每次拒绝的 reason 与臂标签，供事后逐字审计。
