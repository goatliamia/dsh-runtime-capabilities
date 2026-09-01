# DSH 原生 Progress / Effect Projection 实验设计

日期：**2026-09-02** | 状态：**已执行**（结果与验收见 `docs/status/native-pp-2026-09-02.md`）| 前置：`docs/09`（隔离方法）、`docs/14`（runtime-progress 评审）、`docs/15`（四象限场景法）

## 1. 目的

只回答一个问题：**「Progress / Effect」在 DSH 里是不是原生 Primitive——由 Event 流唯一决定、可被纯投影表达，而不是需要一层 Policy 插件。**

上一轮（E1-E7 + 四象限）证明了「介入」需要 seam 插件；本轮证明其反面的一半：**进度与效果判定不需要任何介入层**。若成立，`dsh-runtime-progress` 的价值就只剩「统一 projection 形状」，如实报告「ProgressContract 只提供统一 projection」。

四个目标：

1. **same_verdict**：只看 Event 流推导的 verdict == 世界真值（可观察处一致；不可观察处必须 unknown 且 unknown 就是正确答案）。
2. **Event 唯一真源**：投影是 `session/event` 记录流的纯函数；无第二真源（无插件状态文件、无 SQLite、无内存旁路）；跨进程离线重放得同一状态。
3. **execution / effect 正交**：execution 事实（tool/call、tool/result、turn/step 结构）与 effect/verdict（goal/change、turn/end.reason 的解释）是两个正交轴；投影只派生、不改 execution。
4. **Progress 是 Primitive 不是 Policy**：ProgressContract 不 retry / 不 stop / 不 wait / 不调 Model / 零 prompt、tool-schema、model-call 增量——它是被动投影，行为可证伪。

## 2. 硬约束（8 条，逐条有验证手段）

| # | 约束 | 验证手段 |
|---|---|---|
| 1 | 事件是唯一真源 | 投影模块只订阅 `session/event`；静态断言 + E2 离线第二实现交叉验证 |
| 2 | 观察不到的 effect 返回 unknown | `unobservable` 场景：世界有 effect（文件已写）但事件流无记录 → 投影 effect 字段必须 unknown |
| 3 | 不伪造确定性 | 所有 verdict 字段带 `source: "event"` 与支持它的 record seq 列表；无支持即 unknown |
| 4-6 | Progress 层不 retry / stop / wait | 投影模块不持有 agent/tools/llm 引用；不调用任何干预 API；代码审查 + E5 行为（A/B 轨迹结构一致） |
| 7 | 不调 Model | 投影模块不注入 llm/stream；E5 token 回溯 A=B |
| 8 | 零 prompt / tool-schema / model-call 增量 | E5：A/B 臂 initialTools 集合逐位相等、payload 与 usage 方向一致；投影自身≈0 token（它根本不产生模型流量） |

## 3. 被测物：ProgressContract（统一 projection 形状）

一个纯 fold：`Projection = fold(records[])`，输入只来自 `session/event`（活跑）或持久化 log 重放（reload/离线）。字段：

```json
{
  "sessionId": "...",
  "axes": {
    "execution": { "turns": 1, "steps": 3, "toolCalls": 1, "toolErrors": 0,
                   "turnOutcome": "completed" },
    "goal":       { "phase": "active", "revision": 1, "roundsStarted": 0,
                   "lastOperation": "create" },
    "effect":     { "exp_report": { "called": true, "result": "success",
                   "verdict": "success", "support": [12, 14] },
                    "exp_unobservable": { "called": true, "result": "unknown",
                   "verdict": "unknown", "support": [18] } }
  },
  "verdict": { "turn": "completed", "execution": "success", "effect": "success" },
  "unknownFields": []
}
```

- 每个 effect 字段必须带 `support`（支持它的 record seq 列表），verdict 从 support 推导；
- 无支持 → `unknown`；
- execution 轴与 effect 轴分离：`tool/result.isError` 属于 execution 事实；`turn/end.reason` 属于 execution 结果；两者不互相解释（正交性的落地形状）；
- goal 轴从 `goal/change` 折叠（operation/goal 快照/roundsStarted），与 goal 服务同源。

## 4. 隔离架构（复用 docs/09 三层隔离）

```
隔离 home:  <HOME>\.dsh-native-pp-exp      ← 全新，与主 home / .dsh-runtime-exp 零共享
  settings.yaml:        agent-presets.default = minimal（shipped）+ 固定模型 deepseek-official/deepseek-v4-pro
  .credentials.yaml     ← 从 .dsh-runtime-exp 复制（同一用户）
  profiles/pp-a:        bundles = [dsh-base, dsh-headless, dsh-native-pp-fixture]                    （E5 A 臂，无投影）
  profiles/pp-b:        bundles = [dsh-base, dsh-headless, dsh-native-pp-fixture, dsh-native-pp-projection]  （E1/E5 B 臂）
  profiles/pp-r:        bundles = [dsh-base, dsh-native-pp-fixture, dsh-native-pp-projection]         （E4 reload，无 headless，replay runner 即退）
```

启动前隔离断言（四条，全真才开跑，沿用 docs/09 §3）：

1. 每个 profile `--dump-config` 只出现各自声明的 bundle；
2. 实验会话工具面不含任何主 home 常驻插件工具（fixture 只注册 3 个场景工具 + minimal preset 自带工具）；
3. 新 home 无 `plugins/`、无 SQLite/WAL；fixture 零状态文件（bug-001 纪律）；
4. `minimal` preset persona 固定，无 skill 目录、无清单/收件箱指令。

## 5. 五个实验

### E1 same_verdict（pp-b，3 个场景 × 1）

世界（fixture 全确定性）：三个场景工具，行为固定：

| 场景 | 工具 | 世界真值（fixture 知道，但只有事件流可被投影读） |
|---|---|---|
| ok | `exp_report` | 调用即成功返回 `{"accepted":true}` |
| toolfail | `exp_flaky` | 每次调用必失败（返回 isError） |
| unobservable | `exp_unobservable` | 调用成功，但副作用（写文件）**不产生任何 session 记录** |

任务文本三场景各自固定（全 ASCII）。判定：

- **T1（turn verdict 双实现一致）**：投影 `verdict.turn` == headless runner 自身 summarize（turn/end.reason → 进程退出码）——两个独立消费者对同一 Event 流得同一 verdict；
- **T2（effect verdict == 世界真值）**：ok→success、toolfail→failed（execution 轴 failed，turn 轴按实际）、unobservable→unknown；
- **T3（goal 折叠自洽）**：投影 goal 轴 == 最后一条 goal/change 记录内容；
- **T4（unknown 是正确答案）**：unobservable 世界里 effect 真实发生（文件存在，fixture 世界确认）而投影报告 unknown——证明「观察不到→unknown」不是投影缺陷而是语义正确。

### E2 Event 唯一真源（全部活跑格 + 离线）

- **P1（纯函数）**：投影模块代码只 import fold + session/event；不读文件、不读环境、不持有任何插件内可变状态（fold 状态只随事件前进）；
- **P2（第二实现交叉验证）**：跑完后用独立 JS 脚本（results 目录里的 `verify-fold.mjs`，与投影包不同作者视角、只读 session.jsonl.zstd 官方重放）离线重算投影，与活跑投影 JSON 逐字段相等；
- **P3（无第二真源）**：新 home 全程无 SQLite/WAL/插件状态文件；fixture 的 world.json 只作真值对照，投影不读它；
- **P4（正交性）**：execution 轴字段只来自 execution 类 record，effect 轴字段只来自 effect 类 record，两轴互不引用（代码断言 + 报告表）。

### E3 Event 语义对照（只读源码，不进隔离 home）

由源码分析产出全量对照表（record/event/waterfall/service 四类），交付 `docs/16-native-pp/event-semantics.md` + `.json`。本实验零运行、零成本。

### E4 reload（pp-r，3 个 reload cell × 1）

每个 E1 活跑格的 session 做一次跨进程 reload：

1. 活跑结束：投影写 `<run>.projection.json` + `sessionId`；
2. reload cell（新进程，pp-r profile，`EXP_REPLAY_SESSION=<id>`）：fixture replay runner 走官方 `sessionPersistence.loadStored(id)` → `sessions.prepare(seedSource:"persistence")` → 对重放 events 跑同一 fold → 写 `<run>.replay.json`；
3. 判定：**逐字段相等**（排除时间衍生字段：fold 不产出 wall-clock 断言，time 只读不派生）；
4. 附带：reload cell 零模型调用（pp-r 无 headless，replay runner 不创建 agent）——「重放不需要新执行」的事实本身也是 Primitive 论据。

### E5 A/B 成本（pp-a vs pp-b，ok 场景 × 2 arm × 1）

- 同任务文本、同模型、同 preset，唯一差异 = 投影 bundle 存在与否；
- 跑后 decode-zstd 回溯 usage：input/output/cacheRead/reasoning，**只报方向**（A 与 B 之差），不报绝对值差异幅度；
- fixture 在两臂都记录 initialTools（llm/stream 首个 tool 面）→ 断言逐位相等（第 8 条）；
- 投影 bundle 自测 `blocking_host_cost`：每个 session/event 处理耗时（host 侧 stopwatch，微秒/record 均值）——这是投影的全部主机成本，不进模型流量。

## 6. 四象限（本轮的结论形状）

横轴 = **Effect 可观察性**（事件流是否含 effect 记录），纵轴 = **Execution 可观察性**（执行事实是否进事件流）：

| | Effect 可观察 | Effect 不可观察 |
|---|---|---|
| **Execution 可观察** | Q1 支持：投影==真值（same_verdict） | Q2 支持但 verdict=unknown：投影诚实地不知道 |
| **Execution 不可观察** | Q3 不支持：没有执行事实可投影（需要新 seam） | Q4 不支持：双重不可观察 |

四格落位：E1 的 ok/toolfail → Q1；unobservable → Q2；Q3/Q4 由源码分析（E3）与「不伪造确定性」约束推出，标注为**推导结论（非实测）**，除非跑一个副作用完全静默的工具（本轮不做，成本为零但价值低）。

## 7. 运行矩阵与成本

| 组 | profile | runs | 模型调用 |
|---|---|---|---|
| E1 | pp-b | 3（ok/toolfail/unobservable） | 3 |
| E4 | pp-r | 3 reload cell | **0**（纯重放） |
| E5-A | pp-a | 1（ok） | 1 |
| E5-B | pp-b | 1（ok，复用 E1-ok 格数据或单独跑） | ≤1 |

合计模型调用 ≤5。模型固定 deepseek-official/deepseek-v4-pro（与上轮一致，方便跨轮对照）；成本全部事后回溯（driver 循环内零计量）。

## 8. 文件布局

```
docs/16-native-pp-experiment.md                 本设计
docs/16-native-pp/event-semantics.{md,json}     E3 交付
experiments/native-pp/fixture/                  dsh-native-pp-fixture 源码（世界+轨迹+replay runner）
experiments/native-pp/projection/               dsh-native-pp-projection 源码（fold+计时）
experiments/native-pp/harness/driver-pp.ps1     驱动（全 ASCII）
experiments/native-pp/harness/task-*.txt        任务文本（全 ASCII）
experiments/native-pp/results/                  原始结果（projection/replay/world/events/stdout）
experiments/native-pp/results/token-index.json  成本回溯索引
docs/status/native-pp-2026-09-02.md             终报
```

## 9. 风险与回退

- replay runner 若拿不到 appExit → 降级用 `process.exit`（headless 同款 fail 路径）；
- `loadStored` 官方口若在无 agent 的 profile 里不可用 → 退路：直接读 session.jsonl.zstd 字节（decode-zstd.mjs 已验证帧格式），但优先官方口（验证「DSH 现有机制已完整表达语义」本身）；
- 任一隔离断言失败即停，不带污染数据出结论；
- 模型行为不确定（agent 可能多调工具/多步）不破坏判定：投影折叠实际发生的事件，世界真值固定，T1-T4 对任意轨迹成立。
