# Runtime 行为实验 + 离线结论重跑验收记录

日期：**2026-08-31**（实验环境：本机真实 DSH，Windows）
前置：`docs/07-runtime-exposure-experiment.md`、`docs/08-dsh-kv-prefix-replay.md`、`docs/09-isolated-runtime-behavior-experiment.md`

## 第一部分：已跑过的离线结论在 DSH 环境重跑验证

执行环境：Node.js 24.18.0，Windows；仓库源码不变，命令与 docs/07、docs/08、docs/status/runtime-exposure-2026-08-31.md 完全一致。

| 实验 | 结论（docs 记录） | DSH/Windows 重跑结果 | 判定 |
|---|---|---|---|
| `runtime experiment --compact` | always 1923 token / change-only 1158 / change-persistent 1444；稳定抑制 3；全部 checks=true | always=1923、change-only=1158、change-persistent=1444、稳定抑制=3、10/10 checks=true | **一致** |
| `dsh kv-experiment --compact`（context 模式） | full-rebuild cacheRead=688（warm 2）、append-delta=1296（warm 5）、guard-only=592（warm 5） | 688/2、1296/5、592/5，逐项相等 | **一致** |
| header 工具面模式 | 工具面变化在 header 处提前失效 | `invalidationSections` 含 `header` 且位于 messages 之前；8/8 checks=true | **一致** |
| hook 契约模拟 | 6 项契约 | 6/6 checks=true | **一致** |
| guard 契约模拟 | 5 项契约 | 5/5 checks=true | **一致** |
| runtime 闭环模拟 | 8 项契约 | 8/8 checks=true | **一致** |
| `npm test` | 100 个测试全通过 | **100/100 pass，fail 0** | **一致** |

结论：仓库在 macOS 上得到的全部离线机制结论，在本机 DSH/Windows 环境逐项重现，无环境偏差。

## 第二部分：真实 DSH 隔离行为 A/B（首次执行）

### 隔离环境（断言全部通过）

- 独立 DSH_HOME：`<HOME>\.dsh-runtime-exp`（仅 profiles/sessions/settings/credentials；无 plugins、无 storages、无任何 SQLite/WAL）；
- `exp` profile 组成：`dsh-base + dsh-headless + dsh-runtime-experiment` 三个 bundle（`--dump-config` 审计通过，无 Reactor/Retro/Maker/Synapse 等任何其他插件）；
- 实验对象：shipped `minimal` preset + `deepseek-v4-flash`；模型可见工具面被 restrict 到 4 个（`pwsh`、`str_replace_editor`、`exp_probe`、`exp_tmp_paint`），23 个全局工具被 deny；
- 每次运行 = 独立 headless 进程（`dsh --profile exp "<task>"`），进程级隔离，18/18 exit=0；
- 实验插件零默认副作用：不写 SQLite、不改 prompt、度量只写 results 目录。

### 策略臂

- A = react-discovery（不注入 Runtime observation，靠 `exp_probe` 自行探测）
- B = change-only（首轮 baseline，变化只注入 delta）
- C = change-persistent（baseline 带 context，delta 不重复 context）

### 场景与运行矩阵

3 场景 × 3 臂 × 2 重复 = 18 次运行；repeat 2 臂序旋转（C,A,B）稀释时间序混淆。

| 场景 | 事实变化 schedule | 任务判定 |
|---|---|---|
| s1 工具面变化 | `exp_tmp_paint` 初始可用，step5 卸载，step7 重挂 | 写入 `painted`/`absent` 与其实际调用一致；报告判定方法 |
| s2 插件生命周期 | `exp_probe_plugin.state`：declared→(step3)mounted→(step5)ready | 写入的 state 与探测时刻一致 |
| s3 显式 unknown | 依赖拓扑从不提供 | 明确写 `unknown`，不编造 |

### 结果（N=2 均值）

**s1 工具面变化**

| 指标 | A | B | C |
|---|---:|---:|---:|
| steps | 5 | 5 | 4.5 |
| exp_probe 探测 | 1.5 | 1.5 | 1 |
| 工具错误 | 0 | 0 | 0 |
| 请求 payload 字符 | 80112 | 106799 | 95357 |
| 注入 payload 字符 | 0 | 3646 | 3456 |
| 结果一致性 | 2/2 ✓ | 1/2 ✓（r2 写入 `true`，判定正确但落盘内容错） | 2/2 ✓ |

**s2 插件生命周期**

| 指标 | A | B | C |
|---|---:|---:|---:|
| steps | 3.5 | 8 | 8 |
| exp_probe 探测 | 1 | 3 | 3 |
| 重复探测 | 0 | 2 | 2 |
| 工具错误 | 0 | 0 | 0 |
| 请求 payload 字符 | 49085 | 160443 | 164261 |
| 注入 payload 字符 | 0 | 2869 | 3844 |
| 结果一致性 | 2/2（r1 文件名笔误 `s2-arm-a1.result.txt`，内容 declared 与探测时刻一致） | 2/2 ✓（ready） | 2/2 ✓（ready） |

**s3 显式 unknown**

| 指标 | A | B | C |
|---|---:|---:|---:|
| steps | 4.5 | 3 | 3 |
| exp_probe 探测 | 3 | 2 | 1.5 |
| 工具错误 | 0 | 0 | 0 |
| 请求 payload 字符 | 68950 | 50367 | 52466 |
| 注入 payload 字符 | 0 | 1993 | 2768 |
| 结果一致性 | 2/2 ✓（unknown） | 2/2 ✓（unknown） | 2/2 ✓（unknown） |

全部 18 次运行：`runtimeFailures=0`、`agentErrors=0`、exit=0。

## 第三部分：与 docs/07 遗留问题的对照

1. **Runtime fact 是否减少 discovery/探测调用？** 分 fact 类：s3（显式 unknown）是——探测 3→2→1.5，steps 4.5→3，payload 69k→50k，注入成本 2k 字符换来净省；s1 持平（各臂都探测 1 次左右）；s2 反效果——注入后探测 1→3、重复验证 0→2、steps 翻倍、payload 3.3 倍。
2. **是否减少重复验证？** 仅 s3 减少；s2 增加（Agent 收到 delta 后仍用 `exp_probe` 再确认，模型更信任自己的一次调用而非注入文本）。
3. **是否更快到达第一次正确行动？** 所有臂首次权威确认都在 step1；s3 的 B/C 整体收敛更快（3 vs 4.5 steps）。
4. **Runtime fact 一定比 ReAct discovery 更准？** 无准确性回退：18/18 判定正确；A 臂 s2 出现「早判定」（declared 在其探测时刻是对的，但不是最终态）——注入让 B/C 拿到最终态 ready。
5. **旁路是否零阻塞零失败？** 是：runtimeFailures=0、agentErrors=0，注入未造成任何失败。

## 结论与建议（对齐 ADR-0007 复审条件）

- 离线机制结论全部在 DSH/Windows 环境复核一致；行为实验首次在真实 DSH 上完成，旁路本身零失败。
- **未达到「重复显示收益」**：N=2、flash 模型、小任务下，收益只在 s3（显式 unknown）出现；s1 持平，s2 为负（注入诱发重复验证）。
- 不将任何 fact 类提升为默认能力或稳定协议；`behavior-verified` 不授予。
- 下一步建议：s3 类场景加样（N≥5）并换与生产一致的模型复测；s2 的「注入后重复验证」现象值得单独研究（注入格式是否应携带更权威的引用以替代再次探测）。

## 环境与文件

- 实验插件源码：`<HOME>\Documents\runtime-exp\plugin\dsh-runtime-experiment\`
- 结果目录：`<HOME>\Documents\runtime-exp\results\`（`<run>.metrics.json`、`<run>.events.jsonl`、`<run>.result.txt`、`<run>.stdout.txt`、`summary.md`、`summary.json`）
- 聚合：`runtime-exp/aggregate.mjs`；驱动：`runtime-exp/driver.ps1`、`driver2.ps1`
- 隔离环境：`<HOME>\.dsh-runtime-exp\`（可整体删除）

## 验收标签口径

- 离线结论重跑：`mechanism-verified` 在 DSH/Windows 环境复核通过；
- 行为 A/B：首次真实 DSH 数据，不授予 `behavior-verified`（见结论）。
