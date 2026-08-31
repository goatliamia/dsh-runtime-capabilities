# Runtime Capability 插件设计评审（对照实验数据）

日期：**2026-08-31** | 依据：`docs/13-experiment-data-report.md`

## 总判断

设计方向与数据高度一致，**可以直接进入实现**。逐条评审如下，标注三类：✅ 数据背书 / ⚠️ 未验证延伸（标注证据级别） / 🔧 建议修改。

## 逐条评审

### 模式 = 预设组合，Core 极小 ✅
真实 DSH 已有全部 seam（`ctx.tools.guard()`、`agent/pre-step`、`tools/result`、`session/event`），core 只需一个事实注册表 + 接线。E1-E7 全部插件逻辑都可压缩成 seam 上的薄层。

### Minimal = Guard + Circuit + Critical Delta + Silence ✅ + 🔧
- ✅ Guard（E1/E3）、Silence（s1 负结果）、Circuit（E4b）全部有数据；
- 🔧 **Critical Delta 的"critical"要用数据定义死**：我们实测只有两类 delta 有正收益——①承诺过的转移（E2）②circuit 开断（E4b）。Minimal 的 delta 应只包含这两类，其余一律沉默；
- 🔧 **Circuit 必须覆盖"被拒工具的重复调用"**：E7 轨迹自然暴露了第二类循环（对 deny 的 `read` 连试 5 次），指纹机制同构、零成本覆盖。Minimal 的承诺里应写明"重复相同失败（含被拒工具）→ circuit"。

### Strict = 更多确定性 authority ⚠️（按能力标注证据级别）
| Strict 能力 | 证据 |
|---|---|
| Guard / Circuit / Commitment / Persistence | ✅ E1/E3/E4b/E2/E6 |
| Lifecycle 权威化 | ✅ E2（ready 判定）+ ⚠️ 未测"多插件生命周期冲突" |
| Ownership 权威化 | ⚠️ E1/E3 只测了形状，未测真实 workspace identity |
| Freshness / stale 长期权威 | ⚠️ 完全未测（E3 只测了"行动时点调和"） |

建议：Strict 每行能力带证据标签（proven / directional / untested），freshness 与 ownership-standing-authority 归入 Strict 的 Advanced 或 Experimental，直到补测。UI 警告"Strict may reduce agent freedom"必须保留。

### Goal = 窄版（Current/Desired/KnownTransition/Reconcile）✅ + ⚠️
- ✅ 窄版 Goal 恰好是我们两个已证机制的组合：承诺兑现（E2：状态必须到 ready，已知转移，运行时通告）+ 行动时点调和（E3：actual≠desired → 拒绝并带当前值+delta）；
- ⚠️ **"runtime: reconcile" 若指运行时自己执行转移（reconnect→init→verify），这是整套设计里唯一未测试的新原语**——我们只验证过"通告+拒绝"，没验证过"运行时执行修复"。建议 Goal v1 = announce + guard（已验证），运行时执行式 reconcile 进 Experimental；
- ✅ "策略选择/创造性决策马上回 Agent"：E7b 数据支持（交付物 4/4 可运行，创造自由未损）。

### Custom 按能力组合、Exposure 默认 0 ✅
E6 数据直接支持：持久化 + 沉默（L2）拿下大头，注入仅作成本优化。Exposure=0 作为默认语义有数据。

### Experimental = 开发者开关 ⚠️→✅
E5/E6 警告（更多 context ≠ 更可靠）正是 Experimental 存在理由。✅

### 前端：模式选择 + Why-did-Runtime-intervene ✅
**"为什么介入"面板不需要新机制**：我们的实验事件流已经天然产生这三种记录（guard-rejection：action/reason/revision；circuit：fingerprint/repeated/opened；fact-change：path/old→new/revision），UI 只是投影。
⚠️ 一个实现细节：生产环境 fact 的 revision 需要稳定来源（实验里用的是 step 计数器）。

### 双轴模型（Enforcement × Exposure）✅✅
这是全设计里数据匹配度最高的一条：**"管得严 ≠ 说得多"正是 E1（严格+沉默，100% 正确、零噪音）vs R1-B/C（说得最多、效果最差）的直接对照**。建议双轴作为 UI 的主隐喻，模式只是轴上的默认落点。

### 仓库结构（core 稳定 / plugins 成长）✅ + 🔧
🔧 `plugins/` 只随仓库带**一个参考实现**（建议 runtime-progress，直接来自 E4b 的指纹熔断逻辑），其余留给社区长。experiments/ 与 evidence/ 我们已有（docs/adr、docs/status、experiments/、docs/13）。

### Contribution 八问 + "must earn its intervention" ✅
八问每一问背后都有数据（无变化→s1 沉默；为什么 Agent 不自己解决→所有 A 臂基线全对；最小介入→1 次拒绝；故障不拖垮 Host→全实验 runtimeFailures=0）。
🔧 一处措辞修正：**Authority 不构成介入理由**（E5：provenance 不买信任，双模型定案）。三元组应读作：Authority 是 Runtime 自身记账与调和的前提，**Need 才是介入的唯一触发器**。
🔧 清单第一问升级为双闸门（2026-08-31 定稿）：
> **Does this capability belong to Runtime at all, and if so, can its failure be contained without compromising Host recovery?**

并补充两条实机踩坑检查项（已沉淀 PITFALLS.md）：环境服务必须可选获取（`webServer` 在 headless 不存在，硬 inject 拖死 boot）；settings schema 必须用 `@deepseek-ai/schemastery`（zod 对象注册即抛）。完整清单见 `docs/contribution.md`。

## 进入实现前仅剩的三个小缺口

1. 生产 fact revision 的稳定来源（实验用 step 计数器）；
2. freshness/stale 的长期权威语义——决定放 Strict 还是 Experimental；
3. runtime-executed reconcile 的边界——按评审建议进 Experimental。

除此之外，E1-E7 的代码与数据可直接转入实现，无需再扩理论。
