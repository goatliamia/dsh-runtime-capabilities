# 19：Runtime Continuation 设计与实验规格（交接文档）

日期：**2026-09-02** | 状态：**设计稿，待下一对话执行** | 前置：`docs/17`（结构升级）、`docs/status/native-pp-*.md`（事实层与三 policy 已验收）

## 0. 命题（一句话）

> **ReAct 中的确定性 transition 能不能从 Model decision 中摘出来？**

即把

```text
Tool → Event → Model → Tool → Event
```

变成（当下一步被 facts + contract 压缩到唯一时）

```text
Tool → Event → Runtime: REQUIRED(reload) → Tool → Event
```

核心纪律（本设计的两条边界，写死在开头）：

> **不要让 Model 为确定性问题反复思考，也不要让 Harness 为不确定的问题假装知道答案。**

配套约束：**Event 是事实真源；Next Work 不是第二个真源**——`REQUIRED` 是「根据当前事实算出来的工作」，不是状态；新 Event 出现后重新投影即可失效，不需要删除任何「待办」。

## 1. 可行性判定（逐项对照 DSH 原生机制，全部本机源码核实）

| # | 需求 | DSH 原生机制 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | Event 是唯一真源 | 持久化 session log（append-only，seq 连续） | `dsh-session` `Session.append`；已三路一致验证（live==官方重放==独立实现） | ✅ 已证 |
| 2 | Projection 派生，无第二状态 | 纯 fold（`core/runtime-progress`，事实层不拥有 policy） | 本仓库已落地并验收 | ✅ 已证 |
| 3 | **Host 发起的工具执行必须走正常边界**（guard/权限/取消/结果通知） | **`ctx.tools.execute(exec)` 是公开方法**，走完整管线：pre-policy → guards → around-dispatch → post-policy → finalize；取消语义完整（未开始→ABORTED_BEFORE_DISPATCH，已开始→排空） | `dsh-tools/lib/index.js:2999`（docstring 明示全管线）；`createExecution` 自建 callId/rootCallId/signal | ✅ **可行** |
| 4 | Continuation 的 durable 记录（provenance + audit） | `Session.append` 公开（goal 包先例：`agent.session.append("goal/change")`）；tool/call 与 tool/result 的精确契约可见：`tool/call {turn,step,callId,name,arguments}`；`tool/result {turn,step,message,error?,meta?}` + `{surfaceOp:"append", sourceEventSeqs:[callSeq]}` | `dsh-agent-loop/lib/index.js:292-318`（loop 自身的 append 函数，插件可原样复刻） | ✅ **可行（契约明确，需精确复刻）** |
| 5 | 过期保护（CAS） | 纯投影逻辑：执行前重算 projection，`currentRevision === basedOnRevision` 否则 discard | 无运行时依赖 | ✅ 可行 |
| 6 | provenance 元数据 | 追加 `runtime/continuation` 类记录（或复用 goal 先例的自定义 record kind；未知 kind 需 ignorable 标记） | `Session.append` 公开 + 类型词汇表（`docs/16-native-pp/event-semantics.json`） | ✅ 可行 |
| 7 | 窄标准（合法下一步唯一才 continuation） | 纯 policy 逻辑（facts + contract → 动作集合大小 == 1） | 无运行时依赖 | ✅ 可行 |
| 8 | 四态分类 COMPLETE/REQUIRED/BLOCKED/NEEDS_DECISION | 纯投影逻辑（goal satisfied / contract 唯一解 / guard 拒绝 / 多分支） | 无运行时依赖 | ✅ 可行 |
| 9 | **「完全免模型的一跳」的 loop 级挂点** | **缺失**。`agent/pre-step` 的 reject/replace 之后 loop 仍然走向模型调用；`agent/turn-stopping` 的 steer 也是「触发另一步（模型步）」。今天的 loop 里没有「Host 直接向调度器投喂工具调用」的入口——durable tool/call+tool/result 是 loop 围绕模型决策写下的 | `dsh-agent-loop` 调度器只消费模型输出；`dsh-tools` 的 `execute` 不写 session 记录 | ⚠️ **缺口**（两条路线见 §2） |

**总结论**：命题的 1-8 全部有原生构件，**唯一缺口是第 9 条**——模型免掉的「那一跳」在 loop 里没有原生挂点。但所有构件都公开，插件层可以拼出这一跳；更优雅的终态是向上游提一个 loop 级 seam（`agent/continue`），语义：*Host/plugin 提出一个经事实与 contract 证明的下一动作，由 Harness 负责验证、执行、记录、取消；continuation 不拥有事实、不管理 tool lifecycle、不绕过 permission/guard、不产生第二套 state。*

## 2. 缺口的两条路线

- **路线 A（插件层拼装，本轮实验用）**：在 `agent/pre-step`（或 tools/result 之后、下个 pre-step 之前）检测 REQUIRED → 调用 `ctx.tools.execute(exec)`（自建 exec：name/arguments/callId/agent/signal）→ 按 loop 契约补 `tool/call` + `tool/result` 记录（含 surfaceOp/sourceEventSeqs）→ 把工具结果作为本步消息交给模型。**模型不再决定做什么，只消化已发生的事实**——「decision 节点被摘除、Reason 节点降级」。这已是可测的命题形态。
- **路线 B（上游 seam 提案，实验出数据后提）**：`agent/continue` loop 级事件，让调度器在模型决策之外接收 continuation（完全免模型一跳）。本实验的数据（省了几个 Reason 节点、stale discard 行为、provenance 完整性）就是提案的证据包。

## 3. 最小实验规格（用户指定场景）

**世界（fixture，全确定性）**：

```text
artifact_revision = 12   （build.ps1 产出：写 artifact.json + 输出 "artifact=12"）
runtime_revision  = 11   （runtime-state.txt 初始值）
contract: plugin-revision-mismatch → artifact != runtime ⇒ REQUIRED(reload)
reload.ps1: 把 runtime_revision 对齐到 artifact（写 runtime-state.txt + reload-marker.txt）
```

事实来源仍是 Event：build 的 tool/result 文本含 `artifact=12`，投影用契约模式解析（沿用 real3 的 pattern-contract 方式）。World truth（fixture 读文件）：最终 runtime_revision==artifact_revision。

**三臂**（同一任务文本：「build 后确认插件生效」；isolated home，standard preset 创造模式）：

| 臂 | 机制 | 预期轨迹 |
|---|---|---|
| A baseline | 无 continuation；模型自己发现 mismatch → 自己决定 reload | Tool→Event→**Model**→Tool→Event |
| B continuation | 投影 REQUIRED → 插件 dispatch reload → 补记录 → 模型只见已发生事实 | Tool→Event→**Runtime continuation**→Tool→Event（provenance 完整） |
| C stale-race | 同 B，但 dispatch 前把 artifact 顶到 13 → CAS 检查 discard → 重新投影，**不执行过期的 reload** | REQUIRED 失效、零误执行 |

**指标（统一口径，事后 token 回溯）**：model calls、steps、cacheReadTokens、relaod 执行次数（world）、stale discard 正确性（C 臂 0 误执行）、provenance 完整性（轨迹能回放出 continuation 的 basedOn/contract/revision）、任务完成率、正常任务对照（0 误 continuation）。

**验收线**：
- B 臂 model calls < A 臂（至少摘除 1 个 decision 节点）；reload 正常执行且 worldCorrect；
- B 臂轨迹含 `runtime/continuation` 记录且 tool/call+tool/result 契约与 loop 一致（回放验证）；
- C 臂 discard 后不执行过期 reload（worldCorrect 保持）；
- 正常任务格：continuation 触发 0 次。

**矩阵（首轮）**：A×2 + B×2 + C×2 + 正常任务对照×1 = 7 格；N 视首轮信号再定（成本参考：本实验线既往每格 cacheRead 约 1.5–2.5 万~20 万不等）。

## 4. 实施骨架（路线 A，伪代码级）

```js
// runtime-continuation 插件（实验期放 experiments/，验证后按 docs/17 规则下沉）
const CONTRACT = {
  id: "plugin-revision-mismatch",
  pattern: /artifact=(\d+)/,          // 从 build 的 tool/result 文本投影 artifact rev
  runtimePattern: /runtime_revision=(\d+)/, // 从世界状态（verify.ps1 输出）投影 runtime rev
  required: (a, r) => a !== r,
  action: { name: "pwsh", arguments: { command: "reload.ps1" } },
};

// pre-step 时：
// 1) p = foldProjection(events)；extract artifact/runtime revisions
// 2) 若 CONTRACT.required(a, r) 且 actions 唯一 → 构造 intent
//    { kind:"runtime/continuation", action:"reload", basedOn:[seqA,seqR],
//      revision:r, contract:"plugin-revision-mismatch", authority:"runtime-observation" }
// 3) CAS：重投影 currentRevision === basedOnRevision，否则 discard（记 activity）
// 4) exec = { name, arguments, callId: CallId(runtime-…), agent, signal }
//    result = await ctx.tools.execute(exec)        // 全管线：guard/权限/取消
// 5) callSeq = session.append("tool/call", {turn,step,callId,name,arguments}).seq
//    session.append("tool/result", {turn,step,message,error?,meta?},
//                   { surfaceOp:"append", sourceEventSeqs:[callSeq] })
//    session.append("runtime/continuation", intent) // provenance（自定义 record kind）
// 6) 把工具结果作为本步 user message 交给模型（decision.kind==="enter" 时替换 messages）
```

## 5. 风险与遗留问题

1. **surface 一致性**：插件补写的 tool/call+tool/result 必须与 loop 契约逐字段一致，否则回放/压缩/投影会拒收——回放验证是硬验收项；
2. **continuation 与模型并发的取消语义**：exec.signal 必须接 loop 的 signal；取消发生在 dispatch 前后语义不同（execute 已处理，但要传对 signal）；
3. **自定义 record kind（runtime/continuation）**：需带 ignorable 标记或进词汇表；未知 kind 可能被严格读者拒绝（E3 表：ignorable 词汇增长机制）；
4. **投影对「工具输出文本」的解析**是模式匹配——真实世界需要 capability 声明 fact path（seam 的 fact registry 是更稳的来源；本实验先用 pattern 保持最小）；
5. C 臂的 stale 注入时机（dispatch 前顶 revision）需要在 fixture 里做确定性编排；
6. 路线 B 的上游提案依赖本实验数据（省节点数 + provenance 完整性）。

## 6. 交接说明（下一对话如何接）

- 资产全在本仓库：事实层与三 policy（`core/runtime-*`）、实验 harness 样板（`experiments/native-pp/harness/`：driver 模式、隔离 home、token 回溯管线）、Event 语义对照表（`docs/16-native-pp/event-semantics.{md,json}`）、契约模式先例（real3 的 pattern-contract）；
- 隔离 home：`<HOME>\.dsh-native-pp-exp`（profiles pp-f/pp-g/t-a/t-b 结构可复用）；
- 执行顺序建议：fixture 世界（artifact/runtime revision + reload）→ continuation 插件（路线 A）→ 7 格首轮 → 回放验证 provenance → 数据汇总（沿用 aggregate 模式）→ 若成立，把 `agent/continue` 提案与数据一起整理。
