# rc：Runtime Continuation 实验（docs/19 路线 A，首轮 7 格 + 第二轮边界 19 格）

首轮（7 格）：命题成立——确定性 transition 可从 Model decision 摘出。
第二轮（19 格）：把 continuation 边界做实，两轴：
- **A. Runtime boundary**：unique / stale-full / stale-partial / cancel(before-dispatch+mid-body) / guard / multi-choice / unknown——全部按预期落定；
- **B. Fact boundary**：误导文本诱骗（rcbait）与事实缺失（rcnofacts）下 Runtime 0 触发（修复前曾因模板泄漏误触发——泄漏本身就是本轴发现）。
- 链式（rchain）：单 pre-step 内 Runtime reload → Runtime healthcheck 两跳、零模型间隔、单条消化消息，模型正确接住世界状态。

结论与验收细节：`docs/status/native-pp-rc-2026-09-02.md`（首轮）、`docs/status/native-pp-rc2-2026-09-02.md`（第二轮）。

## 资产

- `world/`：build/verify/reload/stale-bump + runtime-state.txt 初值（全 ASCII）
- `fixture/`（dsh-native-pp-rc-fixture）：世界观察 + C 臂 stale 注入握手（`exp/continuation-intent` → 公共 tools.execute 边界跑竞争管线 + 配对记录 + resolve deferred）
- `continuation/`（dsh-native-pp-continuation）：路线 A 本体——
  - pre-step 投影（Event 唯一真源；**分段执行门控**：pwsh 事实只认「命令段执行了该脚本」，排除 Get-Content/type/cat 源码查看；read 通道只认 artifact.json/runtime-state.txt 的世界观察）
  - 四态分类 COMPLETE/REQUIRED/BLOCKED/NEEDS_DECISION + refire backstop
  - CAS 重投影（C 臂窗口内竞争写 → discard + 注入消化消息）
  - `ctx.tools.execute`（公开全管线，exec.signal 接 loop signal）
  - loop 契约逐字段复刻：assistant 配对（source.kind=`runtime-continuation`）+ tool/call + tool/result（surfaceOp/sourceEventSeqs）+ `runtime/continuation` provenance
  - **wire filter**（llm/stream）：占位对从模型请求摘除、durable 记录保留——协议层需要它存在 ≠ 认知层需要 Model 看见它（DeepSeek thinking 模式也强制这一点）
- `gate-test.mjs`：执行门控 14 例单测
- `driver-rc{2,3}.ps1`：隔离 home 7 格矩阵 + --dump-config 断言 + 超时保险（全 ASCII）
- `verify-continuation.mjs`：回放验证（独立 decode-zstd + 官方 decodeStorageRecord）：loop 契约逐字段、provenance 字段、compaction 轨迹闸门（docs/bugs/005）、官方重放兼容性（KNOWN_SESSION_EVENT_TYPES 谓词）
- `aggregate-rc.mjs`：对比表 + 事后 token 回溯 → `results/rc-comparison.md`、`rc-token-index.json`

## 冒烟迭代（开发记录）

| 格 | 发现 | 修复 |
|---|---|---|
| smokeb1 | 投影零触发：tool-result 文本在 `tool-result` 包装块内层 | `toolResultText` 拆包 |
| smokeb1 | 模型链式 `reload.ps1; verify.ps1`，runtime 事实只经早期 read 进入 | runtime 事实源加 read(runtime-state.txt) |
| smokeb2 | DeepSeek API 拒孤儿 tool 消息 | assistant 配对（runtime 署名） |
| smokeb4 | `Get-Content build.ps1` 源码回显被当成世界事实（build 前误触发） | 执行门控 v1（整命令）|
| smokeb5 / b2-v3 | 链式命令里真实 verify 执行被 Get-Content 段屏蔽（零触发）| **分段执行门控 v4**（按 `;|&` 段归属）+ gate-test |
| c1-v1 | thinking 模式拒无 reasoning_content 的占位 assistant | wire filter + discard 注入 |

## 发现分层（表述框架，见 status 报告 §4）

- **A. 实证到的**：确定性 transition 可摘出；REQUIRED/DISCARD 直接改 execution；CAS 零误执行；provenance 可回放；模型署名诚实（「the runtime dispatched reload」）。
- **B. 我们规定的实验条件**：fact 门控规则、三臂世界、消化消息注入——fixture 语义，非 DSH 既有机制。
- **C. 不声称**：fact authority/provenance/freshness 的一般理论；保持朴素，不建 Fact/Evidence schema。

## 已知上游卡点（随报告入库）

- `runtime/continuation` 自定义 kind：官方 loadStored 拒读（rc.2 与 alpha.5 同；live append 无 ignorable）→ 回放走独立解码；路线 B 提案第一项。
- thinking 模式 + 严格 tool 配对 → 「protocol trace ≠ model context」需 assembler 内建 exclusion seam；路线 B 提案第二项。
- 上游 0.1.2-alpha.5 六关键包 diff：本实验契约面零变化；钉 0.1.1-rc.2。
- docs/bugs/005（overflow compaction shadow 当前 turn 指令）→ 验证管线带 compaction 闸门。
