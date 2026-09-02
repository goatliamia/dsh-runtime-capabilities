# Runtime Continuation 四轮全景汇总（2026-09-03）

四轮报告：`runtime-continuation-2026-09-02.md`（命题成立）、`runtime-continuation-boundaries-2026-09-02.md`（边界做实）、`runtime-continuation-instruction-2026-09-02.md`（instruction continuity + 意图归用户定调）、`runtime-continuation-ownership-2026-09-03.md`（四者所有权边界）。

## 正向收益（实测成立）

| # | 收益 | 证据 |
|---|---|---|
| 1 | 确定性 transition 可从 Model decision 摘出 | B modelCalls 15 vs A 19（−21%）；链式两跳零模型间隔 |
| 2 | instruction continuity 保持、署名诚实 | 三种 prompt 冲突下任务全完成；「the runtime dispatched」「the plugin's, not mine」 |
| 3 | CAS 过期保护零误执行 | stale-full/partial：旧 intent 0 执行 |
| 4 | 不绕过 guard/取消/权限 | guard blocked 且 reload=0；cancel canonical aborted |
| 5 | provenance 完整可回放 | 58 官方格 verify 0 失败 |
| 6 | 连续 continuation 是 Event 驱动、非预计算 | stale2 链中失效、零过期动作 |
| 7 | Pre/Post 同源闭环，无第二套 truth | guard 理由与投影引用同一批 seq |

## 负向收益（反向扫清的边界）

| # | 扫清的边界 | 来源 |
|---|---|---|
| 1 | 「文本像事实」≠ 事实（源码回显泄漏）| 冒烟 b4 |
| 2 | 模板/历史产物不是活世界（路径 + basename 泄漏）| 二轮 bait/nofacts、四轮 stale1 |
| 3 | 占位配对不能进模型 context（API 严格配对 + thinking 模式）| 冒烟 b2/c1 |
| 4 | 自定义 kind 无 ignorable → 官方回放拒绝（harness 真实缺口→提案）| 首轮 |
| 5 | 完全免模型一跳无 loop 挂点（harness 真实缺口→提案）| 首轮 |
| 6 | 步骤级 prompt × 不防御世界工具 = 静默破坏潜力；runtime 只能保证「破坏可观察」，防御属世界工具 | 四轮 bm |
| 7 | 明确强制意图被 discard：authority boundary，意图权重需显式通道 | 四轮 ca |
| 8 | 模型工具粒度方差会吃触发窗口（机制依赖模型行为的部分必须如实标注）| 二轮 b2/xm1 |
| 9 | compaction 溢出会 shadow 当前指令（bug 005，轨迹闸门兜底）| 环境 |

## 成本（全部事后回溯）

| 项 | 数值 |
|---|---|
| 官方格 / 冒烟格 | 49 + 7 |
| input / output | 2,754,022 / 1,022,872 |
| cacheRead | 49,443,840 |
| reasoning | 773,388 |
| 迭代修复 | 6 处 |
| 墙钟 | ~4 小时（串行） |

## 「何时退让」的归属（用户定调）

退让清单（事实缺失/多选/discard 后 one-shot/guard 无正面事实沉默）**全部是插件层 policy 规定，不是 harness 判断，harness 也没有判断不准**。harness 层面只有三个「缺通道」（上表 #4/#5 + protocol≠context seam），不是「修判断」。路线 B 提案只提缺的通道；退让规则留在插件层，是 policy 资产。

## 设计理念对照（水位哲学，用户定调）

昨天 runtime 插件的理念：不造任何东西、事实唯一、事前不变就切掉、事后变了给事实原因。continuation 逐条满足：

| 要求 | 实现 |
|---|---|
| 不造任何东西 | 每次决策当场重投影 session.events；无插件状态文件；「已做过」从日志的 runtime/continuation 记录读出 |
| 事实唯一 | Pre（continuation）与 Post（facts-guard）共用同一 project()；拒绝理由与 basedOn 引用同一批 seq |
| 事前不变切掉 | 缺失→needs-decision、对齐→complete、多契约→ambiguous 均不动；仅唯一 REQUIRED 执行 |
| 事后变了给事实原因 | CAS discard 注入带事实说明；guard 拒绝带 seq 的事实理由（格式是我们规定的，纪律与 circuit 的 support 引用同构）|

## 成本口径（诚实）

- **省的是「模型决策轮次」**：摘掉 reload 决策轮（A 19 vs B 15 轮，−21%；轨迹逐格对照 a1 step11/a2 step16 不存在）；链式两跳零模型调用。
- **token 总量 N=2 不声称省钱**：探索噪声（2-20×）淹没机制收益；B cacheRead −13% 方向性成立但 b2 单格反超。冲突格（强制 reload × mismatch）反而更贵（28/35 轮）。
- 主张：确定性步骤不再占用模型决策带宽（已实测）；token 节省是未验证的副产品，需 N≥4 + 干净目录复测。

## 事前/事后的分工（用户定调：事前管不变，事后管变化）

- **事前 = 不变**：重复性场景中，规则与事实把下一步写死（reload/healthcheck 这类动作不随任务变化）。程序照死规则走，价值是**少轮次**（实测 −21% 模型调用、链式两跳零调用）。它要的是「确定」。
- **事后 = 变化**：创造性工作中，世界的真实变化与错误才是关键信息（工具说成功但世界没变、说失败但副作用已发生、连续失败毫无进展）。程序把真实变化/错误浮出来给模型（placement 定稿：「变化才出现，事件只在需要时告诉模型」），价值是**防错**（静默失败 2/2→0/2、重复副作用 4→1）。它要的是「诚实」。
- 两者互补，同站在一块水位上：**水位不变时按死规则走（事前），水位变化时把变化和错误说清楚（事后）**。
- **上游三个缺口不阻塞**：四轮实验纯插件层跑通（wire filter、独立回放、pre-step 挂点全是插件活）；三条「通道清单」降级为可选增强——上游想补就补、不补照样用。

## 下一块确定性拼图（代码推断候选，2026-09-03）

从 DSH 源码推出三个候选，判定：

| 候选 | 原生机制（file:line） | 判定 |
|---|---|---|
| 1. `fs/observed` 事实通道：projection 订阅权威文件观察事件（kind=present/absent + 版本号），替代「从工具输出文本抠事实」的 pattern 契约 | `dsh-tool-fs:277/431/664/817/1057`；编辑器同款 | **暂定 → 转上游提案（第四缺口：观察未落账）**。用户反问命中死穴：fs/observed 是活事件（ephemeral、不重放），不是持久化记录——用它做事实通道会破坏可回放/水位哲学/且覆盖有盲区（pwsh 直接写文件无观察）。正解是上游把权威观察升级为持久化记录，与 vocab 注册缺口同路 |
| 2. approval 防重问：session 内同 tool+同 reason 已 deny → 直接以用户当时的结果回答，不再发起新 ask | `dsh-user-approval:148/155`（asked/decided durable 审计对） | **暂定**（用户否决）：同一个「不」在不同阶段可能应有不同答案，自动挡新请求判断太大 |
| 3. repeat-tool-reminder 定位修正：原生已有同参数重复调用检测（提醒式），与 circuit（失败指纹熔断式）互补，不重造 | `dsh-repeat-tool-reminder:163-317` | 组合而非重复；若将来组装，把 circuit 的 deny 接到 reminder 的 detailed 阈值之后 |

## 下一步（2026-09-03 用户定调：除并行化外全部暂定）

1. 每格独立目录 + 并行化（消除历史产物污染源 + ~10× 提速）——唯一保持活跃的 harness 改进。
2. **暂定**：意图权重/强制覆盖的治理开关实验（ca 类边界）。
3. **暂定**：世界工具防御化（脚本谎报成功这类明显缺陷，以后再说；不做重的东西）。
4. **暂定**：上游三个缺口与路线 B 提案——等上游修完手头 bug 再谈；插件层已跑通，不阻塞。

**自我定位（用户定调）**：不做十全十美的重框架，插件只防「确定的场景」；从确定性出发、只接确定的部分，其余全部交回模型；要不要扩大范围，以后看数据再决定。
