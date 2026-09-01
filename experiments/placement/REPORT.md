# Context Placement 实验报告（2026-09-01）

- 状态：`closed`
- 模型：`deepseek-v4-flash`，N=3/臂，21 次 headless 运行（15 有效 + 6 机制失效格）
- 隔离环境：独立 DSH_HOME（`<HOME>\.dsh-place-exp`），profile `place` = `dsh-base + dsh-headless + dsh-ctx-place`，shipped `minimal` preset，`--dump-config` 审计通过

## 一句话结论

> **位置不决定模型听不听，但决定它想多久才听。**（方向性，N=3）

## 问题

承接 runtime 线的 exposure 问题：DSH 把 runtime 上下文注入做成了 `agent/pre-step`（当步消息、不碰历史）。但 DSH 还有另外两条原生通道——`SystemPrompt.section()`（稳定系统段）与 `SystemPrompt.context()`（cache-safe runtime-context snapshot，作为 durable user-role 快照进模型历史）。同一个事实放在三条通道里，模型利用率和真实 token 成本是否不同？

## 设计与探针

- 事实（注入内容）：`RUNTIME FACT (authoritative, current): build tag = v3.0.0`
- 干扰物：工作区 `tags.txt` = `v2.1.0`（陈旧值）
- 任务：读 tags.txt → 把 build tag 写入 `BUILD_TAG.txt` → 一行汇报
- 五臂：`baseline`（无事实）/ `section`（order 50）/ `context`（snapshot）/ `prestep`（每步注入）/ `prestep-once`（仅第一步注入）
- 度量：BUILD_TAG.txt 内容（utilization）+ 事后解码真实 token（input/output/cacheRead/reasoning）+ model calls；循环内零计量

## 执行中的机制坑（记录在案）

1. **v1 的 section/context 臂静默失效**：首轮用 `ctx.get("systemPrompt")` 在 apply 时取服务，fact 未进入模型输入（`factInTranscript=false`，行为与 baseline 全同）。修复：官方 `inject: ['systemPrompt']` 声明 + apply 期 `assemble()` 自检（stdout 打印 `ARM-OK/ARM-FAIL`）。根因未完全定位（服务可见性 vs 日志覆盖），不做事后归因。
2. **日志覆盖盲区**：durable 转录不记录组装后的 system section 文本，`factInTranscript` 对 section 臂天然不可靠——机制是否生效只能靠 apply 期 `assemble()` 自检证明，不能靠转录回查。
3. 失效的 6 格数据保留，按"意外第二组 baseline"处理，不混入臂间比较。

## 结果

### Utilization（BUILD_TAG.txt）

| 臂 | 有效格 | 结果 |
|---|---|---|
| baseline | 3 | v2.1.0 ×3 |
| section | 3 | **v3.0.0 ×3** |
| context | 3 | v3.0.0 ×2 / v2.1.0 ×1 |
| prestep | 3 | **v3.0.0 ×3** |
| prestep-once | 3 | **v3.0.0 ×3** |

### 真实 token（有效格均值；每格 model calls 恒为 6）

| 臂 | input | output | reasoning | cacheRead |
|---|---|---|---|---|
| baseline | 17,019 | 422 | 86 | 33,280 |
| section | 16,989 | 2,308 | 1,938 | 35,328 |
| context | 17,045 | 1,762 | 1,349 | 34,816 |
| prestep | 17,496 | 1,063 | 652 | 33,877 |
| prestep-once | 17,084 | 885 | 521 | 33,896 |

## 假设判决

- **H1（事实进 section → cacheRead 最差）**：方向成立（+2.0k），机制猜错——静态 section 文本不改变前缀（每步相同），cacheRead 增量全部来自矛盾消解推理，不是前缀破裂。
- **H2（context/prestep ≈ 基线 cache）**：成立，绝对差幅小（+1.5k / +0.6k）。
- **H3（utilization 随位置变化）**：N=3 下不支持——标"权威"的事实各位置都被采纳（context 漏 1 格，该格 output 全场最大=模型确实纠结过）。

## 新观察（未预先假设，方向性）

矛盾消解推理成本按位置排序：**section 1938 > context 1349 > prestep 652 > prestep-once 521**。冲突事实放得越早，消解越贵。落点：runtime 上下文"记忆 vs 当前状态"的边界——一次性事件（delta）走 pre-step 最便宜；与上一版 seam 的 delta-only 设计一致。

## 与 runtime 线的对照

- 昨天数据（E1-E7）为参考基准而非严格对照（任务不同）；严格对照 = 本实验自己的 baseline 臂。
- E5 的 authority framing（标权威的事实被采纳）在本实验重现——"权威"标签压过位置差异。
- 成本结构一致：cacheRead 主导、turn 数恒定（6/格），位置不改变 trajectory 形状。

## 可支持 / 不可支持

可支持（机制级）：
- 三条原生通道都能把事实送达模型输入（ARM-OK 自检 + 行为改变）。
- 位置不改变 turn 数；cacheRead 差幅小；标注权威的事实各位置均被采纳。

不可支持：
- "某个位置更利于利用"——N=3，无差异；
- "section 破坏缓存前缀"——静态文本不破（H1 机制证伪）；
- 非权威事实、延迟使用（事实注入后多步才用）的位置敏感性——未测。

## 文件清单

- `harness/plugin/dsh-ctx-place/`：五臂插件（0.1.1 含自检）
- `harness/driver.ps1`（首轮 15 格）、`harness/driver2.ps1`（修复后 6 格）
- `harness/copy-transcripts.mjs`、`harness/aggregate.mjs`、`harness/sync-to-repo.mjs`
- `data/`：21 格 run 产物（build-tag/stdout/metrics/tags）+ SUMMARY.md + aggregate.md + driver 日志
- 原始 zstd 转录留本地，不入库（仓库惯例）
