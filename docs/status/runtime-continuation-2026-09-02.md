# 状态：Runtime Continuation 最小实验（docs/19 路线 A，2026-09-02 晚）

前置：`docs/19-runtime-continuation-design.md` | 实现：`experiments/native-pp/rc/` | 原始结果：`experiments/native-pp/results/rc-*` + `results/v1-variant/`（占位可见变体证据）| 生成对比表：`results/rc-comparison.md`

## 0. 结论摘要（一句话）

**命题成立（首轮信号）**：`plugin-revision-mismatch` 契约下，ReAct 中的确定性 transition（reload）确实可以从 Model decision 中摘出来——投影 REQUIRED → Runtime 走公开管线执行 → 模型只消化已发生事实；C 臂证明 CAS 在竞争写发生时零误执行；回放验证证明 provenance 完整。

## 1. 场景与矩阵（§3 未扩）

世界：artifact_revision=12（build.ps1 产出）vs runtime_revision=11（runtime-state.txt 初值）；契约 `plugin-revision-mismatch → artifact ≠ runtime ⇒ REQUIRED(reload)`。任务：「Run build.ps1 to produce a new artifact, then confirm the plugin takes effect in the runtime...」（全 ASCII）。隔离 home `.dsh-native-pp-exp`（profiles rc-a/rc-b/rc-c），三 profile 经 `--dump-config` 断言：rc-b 与 rc-a 的差异恰为 continuation 一个 bundle；rc-c ≡ rc-b（C 臂仅环境变量差异）。

| 格 | 臂 | 机制 | 结果 |
|---|---|---|---|
| rc-a1/a2 | A baseline | 模型自己发现 mismatch → 自己决定 reload | 均世界对齐、reloadCount=1（模型执行）|
| rc-b1/b2 | B continuation | 投影 REQUIRED → Runtime dispatch reload → 补记录 → 模型消化 | 均 dispatches=1、reloadCount=1（**Runtime 执行，模型未自己 reload**）|
| rc-c1/c2 | C stale-race | dispatch 前竞争管线顶到 13/13 → CAS discard | 均 discards=1、dispatches=0、**reloadCount=0**、世界 13/13 对齐 |
| rc-ctrl1 | 对照（real6 math 修复）| continuation 插件在案 | **intents=0**、任务 PASS |

## 2. 数据表（7 格；token 全部事后回溯，循环内零计量）

| run | arm | modelCalls | steps | toolCalls | pwsh | intents | dispatched | discarded | reload(world) | aligned | turn | confounded | officialReplay | input | output | cacheRead | reasoning |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rc-a1 | a | 16 | 14 | 29 | 4 | - | - | - | 1 | ✓ | completed | no | yes | 23,918 | 8,396 | 449,280 | 4,868 |
| rc-a2 | a | 22 | 20 | 43 | 4 | - | - | - | 1 | ✓ | completed | no | yes | 29,548 | 12,588 | 707,328 | 6,960 |
| rc-b1 | b | **14** | 13 | 31 | 3 | 1 | 1 | 0 | 1 | ✓ | completed | no | REFUSED | 10,202 | 6,448 | 308,736 | 2,674 |
| rc-b2 | b | **16** | 15 | 23 | 7 | 1 | 1 | 0 | 1 | ✓ | completed | no | REFUSED | 41,482 | 13,582 | 692,480 | 8,794 |
| rc-c1 | c | 21 | 19 | 52 | 6 | 1 | 0 | 1 | **0** | ✓ | completed | no | REFUSED | 26,826 | 16,820 | 676,352 | 10,604 |
| rc-c2 | c | 14 | 12 | 30 | 3 | 1 | 0 | 1 | **0** | ✓ | completed | no | REFUSED | 14,170 | 11,546 | 326,400 | 8,352 |
| rc-ctrl1 | ctrl | 7 | 6 | 7 | 1 | **0** | 0 | 0 | - | ✓ | completed | no | yes | 3,488 | 1,360 | 110,848 | 182 |

- **B 臂 modelCalls 均值 15 < A 臂均值 19**（−21%）；单格配对 b1 14 < a1 16、b2 16 < a2 22，全部成立。
- B 臂 cacheRead 合计 1,001,216 < A 臂 1,156,608（−13%）。
- b2 input 偏高（41,482）：实验中途归档 `results/v1-variant/` 目录进入了该格的探索面（harness 噪声，非机制差异；已如实记录，不计入机制结论）。
- 7 格 token 合计：input **149,634** / output **70,740** / cacheRead **3,271,424** / reasoning **42,434**。

## 3. 验收线逐项

| 验收线 | 判定 | 证据 |
|---|---|---|
| B modelCalls < A（至少摘除 1 个 decision 节点） | **✓** | 均值 15 < 19；单格配对全成立；b1/b2 的模型总结明确叙述「the runtime dispatched reload」/「the runtime-continuation plugin detected... dispatched reload.ps1 through the tool pipeline」——**模型没有把 runtime 接管重叙事成自己的决定** |
| B reload 正常执行且 worldCorrect | **✓** | reloadCount=1（唯一一次执行即 Runtime dispatch）、worldAligned=true、exit 0、result.txt 落盘 |
| B 轨迹含 runtime/continuation 记录 + tool/call+tool/result 契约与 loop 一致（回放验证） | **✓** | `verify-continuation.mjs` 独立解码（zstd+官方 decodeStorageRecord）逐字段验证：tool/call{turn,step,callId,name,arguments:string}、tool/result{message, surfaceOp:"append", sourceEventSeqs:[callSeq]}、runtime/continuation{contract,action,authority,outcome,basedOn,revision,callSeq,resultSeq}——两格全部 checks 0 失败 |
| C discard 后不执行过期 reload（worldCorrect 保持） | **✓** | c1/c2：CAS 重投影观察到 13/13 → discards=1、dispatches=0、**reloadCount=0**（零误执行）、世界 13/13 对齐、exit 0 |
| 正常任务格 continuation 触发 0 次 | **✓** | rc-ctrl1：intents=0、dispatches=0，任务 PASS、worldCorrect |
| compaction 轨迹闸门（docs/bugs/005） | **✓** | 7 格 confounded 全部 false（无任何 compaction 记录；本轮短会话本不该溢出，闸门为零成本保险） |

## 4. 迭代历程与发现分层（重要：如实区分「实证」与「我们规定的实验条件」）

五个冒烟格依次暴露并修正（每项标注归属）：

| # | 发现 | 归属 | 修正 |
|---|---|---|---|
| 1 | tool-result 文本在 `tool-result` 包装块内层，直接按 text 提取为空（投影 10 步零触发） | **DSH 契约核实不充分**（agent） | `toolResultText` 拆包 |
| 2 | 模型把 `reload.ps1; verify.ps1` 链成一个 pwsh 调用，runtime_revision 事实只经早期 read 进入事件流 | **模型工具粒度方差**（观察） | runtime 事实源加 read(runtime-state.txt) 通道 |
| 3 | DeepSeek API 严格拒绝孤儿 tool 消息（INVALID_REQUEST: must be a response to preceding tool_calls） | **上游 API 契约** | 补 runtime 署名 assistant/message 配对（source.kind=`runtime-continuation`） |
| 4 | v4-pro thinking 模式拒绝无 reasoning_content 的 assistant 消息进入 wire | **上游 API 契约** | **wire filter**：占位对（assistant+tool/result）从模型请求摘除、durable 记录保留——「协议层需要它存在 ≠ 认知层需要 Model 看见它」在插件层达成；C 臂 discard 路径注入消化消息 |
| 5 | `Get-Content build.ps1` 把源码字面量回显进事件流 → 投影在 build 真正执行前误判 REQUIRED | **我们自己的 fact 门控太粗**（harness 规则） | **分段执行门控**：pwsh 事实只认「命令段执行了该脚本」（排除 Get-Content/type/cat 段；按 `;|&` 分段归属，避免链式命令里无关查看段屏蔽真实执行段）；14 例单元测试 gate-test.mjs 全过 |

**分层结论（本报告采用的表述框架）**：

- **A. 实验实证到的**：确定性 transition 可从 Model decision 摘出；REQUIRED/DISCARD 可直接改变 execution；CAS 在竞争写窗口内零误执行；provenance 可回放；模型署名诚实。
- **B. 我们为实验成立而规定的条件**（harness/fixture 语义，不是从 DSH 发现的既有机制）：fact source 门控规则（哪些输出/观察有资格产生 fact）、三臂世界、消化消息注入方式。**「文本输出 ≠ 世界状态」是实的发现；但「什么算足够权威的 observation」尚未被证明成普适理论，本轮不声称。**
- **C. 不声称**：fact authority / provenance / freshness 的一般理论；不建 Fact schema / Evidence schema / Authority model——保持朴素，避免「先造完整 Runtime Protocol 再找问题」。

## 5. 可行性复核（卡点如实）

1. **runtime/continuation 自定义 record kind**：不在 `KNOWN_SESSION_EVENT_TYPES`，live `Session.append` 无 ignorable 标记（rc.2 与 0.1.2-alpha.5 同）→ 官方 `loadStored` 拒读该日志（verify 脚本用官方谓词实测 REFUSED）。回放验证走独立解码路径完成；**官方重放兼容性 = 路线 B seam 提案的第一项**（词汇注册或 append 级 ignorable）。
2. **「完全免模型一跳」无 loop 挂点**：`agent/pre-step` 的 enter/replace 后 loop 仍调模型；`agent/request` 只替换配置不替换消息——docs/19 §1 第 9 条的缺口在插件层只能做到「摘除 decision 节点、保留 digest 调用」，与本设计预期一致。
3. **thinking-mode 协议**：占位 assistant 消息不能进 wire → wire filter 是插件层补丁；「protocol trace ≠ model context」应由 loop/assembler 内建 exclusion seam（路线 B 提案第二项）。
4. **模型工具粒度方差**：链式命令、read vs Get-Content 都会改变事实进入事件流的方式；本实验用「执行门控 + read 通道 + 契约模式」稳住窗口，但窗口存在性仍依赖模型行为（b2-v3 曾因门控过严零触发）——**N=2 方差如实记录，不外推幅度**。
5. **上游版本**：整轮钉在 0.1.1-rc.2；已 diff 0.1.2-alpha.5 六个关键包（agent-loop/tools/session/session-persistence/headless/agent），本实验依赖的契约面零变化；alpha 未修 compaction bug（005）也未修 vocab 注册——两件事与 `agent/continue` 提案一起带上游。

## 6. Token 总账（7 格，全部事后回溯）

input **149,634** / output **70,740** / cacheRead **3,271,424** / cacheWrite 0 / reasoning **42,434**。单格明细：`results/rc-token-index.json`。冒烟 5 格另计（开发用，不计结论）。

## 7. 资产

- 实现：`experiments/native-pp/rc/{world,fixture,continuation}/` + `task-rc.txt` + `gate-test.mjs`（门控 14 例单测）
- harness：`driver-rc{2,3}.ps1`（隔离 home + --dump-config 断言 + 超时保险）、`verify-continuation.mjs`（回放验证 + compaction 闸门 + 官方重放兼容性）、`aggregate-rc.mjs`（对比表 + token 回溯）
- 结果：`results/rc-{a1,a2,b1,b2,c1,c2,ctrl1}.*`（含 verify-continuation.json）+ `rc-comparison.md` + `rc-token-index.json` + `v1-variant/`（占位可见变体证据）
- 隔离环境：profiles rc-a/rc-b/rc-c（bundle 组成见 §1）
- 已脱敏：`scripts/sanitize-native-pp.mjs`（home/session id/安装路径/仓库路径 → 占位符）

## 8. 下一步（建议，不自动扩）

1. 信号明确的前提下 N 扩到 ≥4（成本参考：本矩阵 7 格 cacheRead 327 万）；b2 的探索噪声提示下一轮应先清空 results 目录减少干扰。
2. 路线 B `agent/continue` 提案证据包 = 本文 §3 验收表 + §5 卡点 1/2 + compaction bug 005；提案语义：Harness 验证、执行、记录、取消由 seam 拥有，continuation 不拥有事实、不绕过 guard/权限、不产生第二套 state。
3. 「占位可见 vs 隐藏」的对照已内建为本轮默认（wire filter = 隐藏）；v1-variant/ 提供占位可见侧证据，如需要可另跑对照臂。

## 9. 轨迹行为分析（A/B 逐 step 对照，2026-09-02 深夜补）

方法：从持久化会话日志（独立解码）按记录自带 step 字段重建每步时间线，模型文本取 assistant/message。完整时间线：`results/rc-trajectory-analysis.md`（脚本 `experiments/native-pp/rc/trajectory-analysis.mjs`）。

### 9.1 省掉的正是「reload 决策步」

A 臂每格都有一轮**专门用来决定 reload** 的模型调用：

| 格 | 探索 | build 步 | **reload 决策步** | 后续 |
|---|---|---|---|---|
| rc-a1 | step 1–9（glob/read/看目录）| step 10 | **step 11：模型调 `.\reload.ps1; .\verify.ps1`**（链式打包）| step 12 write → step 14 总结 |
| rc-a2 | step 1–13 | step 14 | **step 16：模型调 `.\reload.ps1; .\verify.ps1`，且用文字宣布判断**（"the runtime is stale at revision 11 — this is the mismatch the plugin addresses. Let me run the reload"）| step 18 write → step 20 总结 |

B 臂**没有这一轮**——reload 在模型 build 之后的**下一个 pre-step** 被 runtime 做掉，模型当轮直接进入核对/验证：

| 格 | build 步 | **continuation 步** | 模型同轮/次轮反应 |
|---|---|---|---|
| rc-b1 | step 9 | **step 10：[runtime] reload** | **同轮**模型调 verify（收到消化消息后立即验证世界）；step 11–12 核对、写总结 |
| rc-b2 | step 7（step 9 模型自己 verify 看到 STALE）| **step 10：[runtime] reload** | **同轮**模型 Get-Content 核对文件；step 11 verify MATCH → step 13 write → step 15 总结 |

### 9.2 continuation 之后模型的行为反应（用户问题「之后 AI 出现了什么反应」）

1. **同轮转向验证，不再自己 reload**：b1/b2 的模型在 continuation 那一轮直接 verify/核对文件——两格 reloadCount 都恰好为 1（唯一一次执行就是 runtime 的），模型没有重复执行。
2. **最强的直接证据在链式格 rchain-h1**：模型 step 14 刚宣布「build → reload → healthcheck. Let me execute the flow」（打算自己跑全流程），runtime 在 step 15 抢先两跳做掉 reload+healthcheck——模型**同一轮改口**：*"The runtime already resolved reload + healthcheck. Let me confirm the plugin takes effect via verify.ps1."* 即模型读懂了「世界已经前进」，放弃原计划、转为确认。这是「无中间 reasoning 注入下接住世界状态」的直接行为证据。
3. **署名诚实**：所有 B/链式格最终总结都把 reload 归给 runtime（b1 "the runtime dispatched reload.ps1"、b2 "the runtime-continuation plugin detected... and dispatched reload.ps1 through the tool pipeline"、h1/h2 同），没有一格把 runtime 的动作重叙事成自己的决定。

### 9.3 成本差的结构解释

B 均值 modelCalls 15 < A 19：差额 ≈ **reload 决策步 + 其前后的核对步**（a2 尤为明显：step 15 核对 + step 16 决策 + step 17 核对）。探索步数（a1 9、a2 13、b1 8、b2 8）是模型行为方差，不属于机制差异——机制差异只有一处：**A 有 reload 决策步，B 没有**。


