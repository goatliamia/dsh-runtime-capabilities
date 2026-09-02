# 状态：Runtime Continuation 第二轮——边界做实（2026-09-02 深夜）

前置：`docs/status/native-pp-rc-2026-09-02.md`（首轮 7 格）| 实现：`experiments/native-pp/rc/`（v5 插件 + fixture v2 + 新世界）| 原始结果：`results/rc2-*` + `results/v1-variant/round2-prefix/`（修复前证据）| 对比表：`results/rc2-comparison.md`

## 0. 结论摘要

**两条轴的边界都实测落定**：Runtime 只在「事实真实且唯一压缩」时接管；stale/cancel/guard/多选/缺失/误导任何一条不满足，都退回 Model 且零误执行。链式两跳（Runtime reload → Runtime healthcheck → Model）成立，模型在无中间 reasoning 注入下正确接住世界状态。

## 1. 实验轴（用户定稿的两轴框架）

```text
A. Runtime boundary：unique / stale / cancel / guard / multi-choice / unknown
B. Fact boundary：  real observation / ambiguous text / misleading text / missing observation
```

目标命题：**「有真实充分的事实 → Runtime 接管；不充分/可疑/被误导 → 不接管 → Model」**——回答「Runtime continuation 是真实机制，还是一个好看的 fixture」。

## 2. 矩阵与数据（19 格，token 全部事后回溯）

| 格 | 臂 | 场景 | intent | disp | disc | blk | abrt | amb | chainHops | reload(w) | aligned | turn | guardDeny | cancelInj | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rc-b3 | b | rc（unique 回归）| 1 | 1 | 0 | 0 | 0 | 0 | - | 1 | ✓ | completed | - | - | ✓ 唯一才接管 |
| rc-c1f | c | rc（stale-full）| 1 | 0 | 1 | 0 | 0 | 0 | - | **0** | ✓(13/13) | completed | - | - | ✓ 旧 action 零执行 |
| rc-cp1/cp2 | cpartial | rc（stale-partial）| 1 | 0 | 1 | 0 | 0 | 0 | - | 1(模型) | ✓(13/13) | completed | - | - | ✓ 旧 intent 丢弃；世界由模型补齐 |
| rccancel-x1/x2 | cancel | rccancel（before-dispatch）| 1 | 0 | 0 | 0 | 1 | 0 | - | **0** | 12/11 | aborted(exit 1) | - | 1 | ✓ 取消未绕过、零执行 |
| rccancel-xm2 | cancelmid | rccancel（mid-body）| 1 | 0 | 0 | 0 | 1 | 0 | - | **0** | 12/11 | aborted(exit 1) | - | 1 | ✓ 慢 body 中断、canonical aborted |
| rccancel-xm1 | cancelmid | rccancel | 0 | 0 | 0 | 0 | 0 | 0 | - | 1(模型) | ✓ | completed | - | 0 | 模型抢先完成（variance，见 §5）|
| rcguard-g1/g2 | b | rcguard | 1 | 0 | 0 | **1** | 0 | 0 | - | **0** | 12/11 | completed | **1** | - | ✓ 守卫真拦、未绕过、模型如实报告 |
| rcmulti-m1/m2 | b | rcmulti | 0 | 0 | 0 | 0 | 0 | 1/2 | - | 1(模型) | ✓ | completed | - | - | ✓ 多选不接管、控制权回模型 |
| rcbait-t1/t2 | b | rcbait（误导文本）| **0** | 0 | 0 | 0 | 0 | 0 | - | 0 | ✓(13/13) | completed | - | - | ✓ 源码诱骗下 0 触发 |
| rcnofacts-n1/n2 | b | rcnofacts（事实缺失）| **0** | 0 | 0 | 0 | 0 | 0 | - | 1(模型) | ✓ | completed | - | - | ✓ 无事实通道 0 触发、模型自理 |
| rccontrol-ctrl2 | ctrl | rccontrol | 0 | 0 | 0 | 0 | 0 | 0 | - | - | ✓ | completed | - | - | ✓ 正常任务 0 误触发 |
| rchain-h1/h2 | b | rchain（链式）| 1 | **2** | 0 | 0 | 0 | 0 | **2** | 1 | ✓ | completed | - | - | ✓ 单 pre-step 两跳、零模型间隔 |

- 全部 19 格回放验证（`verify-continuation.mjs`）0 失败；compaction 闸门 0 命中；带 runtime/continuation 记录的格 officialReplay 如预期 REFUSED（首轮已记录的 vocab 缺口）。
- **Token 总账（19 格）**：input **1,093,490** / output **335,646** / cacheRead **18,309,120** / reasoning **229,892**。单格明细：`results/rc2-token-index.json`。

## 3. 边界逐项验收

| 边界 | 验收线 | 实测 |
|---|---|---|
| unique | facts+contract 压缩到唯一才 continuation | rc-b3：唯一契约 → dispatch；rcmulti 两契约同匹配 → amb=1/2、dispatch=0 ✓ |
| stale | 基于的 revision 失效 → 不得执行旧 action | c1f（双 bump 13/13）、cp1/cp2（仅 artifact→13）均 disc=1、旧 intent 零执行；cp 格世界由模型补齐（reload 由模型执行，非旧 intent）✓ |
| cancel | cancel 后不得绕过正常取消语义 | x1/x2 before-dispatch：ABORTED_BEFORE_DISPATCH、reload=0、turn aborted、exit 1（canonical）；xm2 mid-body：慢 body 中断、canonical aborted、reload=0 ✓ |
| guard | 必须仍经过原 execution guard | g1/g2：continuation 的 execute 撞守卫 → outcome=blocked、guardDeny=1、**reload=0 零执行**、模型收到拒绝并如实报告「reload is disabled」✓ |
| multi-choice | 多个合理 next action → 不接管 | rcmulti：两契约同 facts 匹配 → ambiguous → dispatch=0，模型自己选 reload 完成 ✓ |
| unknown | 事实缺失 → 不接管 | rcnofacts 两格 intent=0（模型自理）；所有格 needs-decision 阶段零接管（决策日志）✓ |
| misleading | 「看起来像事实的文字」≠ 世界状态 | rcbait 两格 intent=0（build.ps1 源码含 artifact=12/runtime_revision=11 诱骗字面量、真世界 13/13）；修复前 t1 曾误触发（见 §4 迭代 6）✓ |
| missing observation | 无事实通道时克制 | rcnofacts：世界输出不带任何 fact 格式 → intent=0 ✓ |
| chain | Runtime A → Runtime B → Model | h1/h2：单次 pre-step 内 reload→healthcheck 两跳（chainHops=2）、零模型调用间隔、单条消化消息；模型总结精确复述世界状态（build=12、runtime 11→12、health=ok）且署名诚实 ✓ |

## 4. 迭代与发现分层（六处修复，逐项标注归属）

| # | 发现 | 归属 | 修复 |
|---|---|---|---|
| 1 | 守卫「撒谎」：fixture 守卫把 prepare 阶段的对象 `exec.arguments` 当字符串 → `"[object Object]"` → 零匹配 → 从未拒绝 | **我们 fixture 的 bug**（原生 tools.guard 机制无问题，round-1 policy 的按名守卫真的 deny 过） | 按对象取 `.command` 解析 |
| 2 | 事实模板泄漏：read 门控只匹配文件名，模型读了 world 模板目录的 runtime-state.txt（内容=初值 11）→ 模板内容被当成世界状态 → rcbait/rcnofacts 误触发 | **我们规定的 fact 门控 v1 太粗**（fixture 语义） | read 通道按「运行世界路径」收窄（相对 cwd 或绝对落在 results 内）；pwsh 执行门控拒绝绝对路径/`..` |
| 3 | cancelmid 时序：deferred 在 cancel 后才 resolve → dispatch 时 signal 已 abort → 退化成 before-dispatch | **fixture 编排 bug** | 先放行 deferred、+1.5s 取消撞慢 body |
| 4 | 模型链式命令吃窗口（b2-v3 首轮、xm1 重跑） | 模型工具粒度方差（观察） | 执行门控分段归属 + read 通道；方差如实记录 |
| 5 | 并发污染：另一 AI 会话 21:31:44 对本仓库跑脱敏，5 个在跑格（c1f/cp1/cp2/x1/x2）的 session id 被涂 → 事后回溯断链 | 环境（协作冲突） | 隔离 home sessions 目录时间戳链恢复 5 个 id（以未涂的 xm1 id 为锚验证）；`recovered-session-ids.mjs` 回退映射；修复前原始文件归档 `round2-prefix/` |
| 6 | discard 后的再触发策略未定义 | 设计决策（我们定的） | 一次 discard 后该契约本会话内不再 refire（one-shot，控制权永久交还模型）；cp 格实测模型自行补齐世界 |

**分层结论（沿用首轮 A/B/C 框架）**：
- **A. 实证到的**：边界矩阵全部按预期落定——Runtime 在 stale/cancel/guard/多选/缺失/误导下均正确克制或走正常边界；链式两跳成立且模型正确接住世界。
- **B. 我们规定的实验条件**：fact 门控规则（执行分段门控 + 路径收窄）是 fixture 语义；**第 2 条迭代本身是 fact-boundary 轴的核心发现**——「文本像事实」≠「事实」，第一版规则被诱骗格实测揭穿，第二版才立住。这就是「真实机制 vs 漂亮 fixture」问题的直接回答：Runtime 的克制不是天然属性，是我们把事实通道收窄到真实观察后才成立的行为——**没有可靠事实通道时它确实什么也不做**（rcnofacts）。
- **C. 不声称**：fact authority/provenance/freshness 一般理论；不建 schema、不抽象 framework。

## 5. 不确定项与卡点（如实）

1. xm1 重跑被模型抢先（build+reload 链式自己干完 → intent=0）；mid-body 语义由 xm2 证明，但 N=1。before-dispatch 语义 x1/x2 两格稳定。
2. cp1/cp2 的「discard 后世界由模型补齐」依赖模型行为（v4-pro 本格稳定补上了），换弱模型未必——这是行为观察不是机制保证。
3. rcbait/rcnofacts 修复后各 N=2 全绿，但诱骗通道只覆盖「模板文件泄漏」这一种；更隐蔽的诱骗形态（如 grep 结果、历史轨迹回显）未测。
4. 并发协作风险仍在：另一 AI 会话对本仓库的修改可能再次发生；本轮以「恢复映射 + 归档」兜底，报告与产物均已在磁盘。
5. 上游状态不变：钉 0.1.1-rc.2；`runtime/continuation` vocab 缺口与「protocol trace ≠ model context」seam 缺口（wire filter 是插件层补丁）继续作为路线 B 提案项。

## 6. 资产

- 实现：`rc/continuation/`（v5：多契约唯一性、四态+blocked/aborted 分类、有界链式、路径收窄门控）、`rc/fixture/`（v2：guard/cancel/cpartial 注入）、`rc/world/`（+rcbait/rcnofacts 子世界、rollback/healthcheck/reload-slow/stale-bump-artifact）
- harness：`driver-rc{4,5,6}.ps1`、`gate-test.mjs`（14 例）、`recover-ids.mjs`、`recovered-session-ids.mjs`、`aggregate-rc2.mjs`、`verify-continuation.mjs`（升级：多 outcome 校验 + 恢复映射）
- 结果：`results/rc2-*` + `v1-variant/round2-prefix/`（修复前七格 + 首版对比表）
- 报告：本篇；`rc/README.md` 已同步

## 7. 下一步（建议）

1. 边界已立，下一步可选：N 扩展（guard/bait/nofacts 各至 4）、更多诱骗形态（grep/轨迹回显）、或把链式扩到 3 跳观察消化质量衰减——**不扩场景规模**（用户定调）。
2. 路线 B 提案证据包更新：+ 守卫/取消边界数据 + 「protocol ≠ context」seam 需求 + vocab 缺口。
3. 协作规则：本仓库已被另一会话并发修改过，后续轮次建议先 `git status` 对照基线再开工。
