# 17：dsh-runtime 仓库结构升级规划（克制升级，不重做）

日期：**2026-09-02** | 状态：**阶段 1-3 已执行并验收（见文末执行记录）** | 依据：`docs/status/native-pp-*.md`（Progress/Consumer/Real 三轮实验）+ 现有仓库实际结构

## 0. 一句话定位（规划的前提）

> **Runtime 负责确定性介入；Event / Progress 负责事实；Model 负责开放式工作。**

仓库升级的目标不是加能力，而是让代码组织与这个思想一致：**`progress/` 不拥有 policy**——它只把 Event 投影成 `execution / effect / progress / unknown`，`circuit` 才消费它。

## 1. 现状（实际结构）

```
dsh-runtime/
├── core/runtime-seam/            ← 单包：fact registry + teaching reason + CircuitTracker
│   ├── lib/core.mjs              + 四 preset（off/minimal/strict/goal/custom）
│   ├── lib/index.js              + host 接线（guard/activity/API）
│   └── lib/client.js             + 前端（输入行按钮 + 设置页 + 介入日志）
├── plugins/runtime-progress/     ← 参考插件（shell-lock 反应，挂在 seam 上）
├── presets/{minimal,strict,goal,custom}/settings.yaml.example
├── experiments/{data,harness,placement}
├── scripts/sanitize-evidence.mjs
└── docs/{adr,bugs,status,07..16}
```

问题：**Circuit 的“无进展”判断长在 seam 里，且语义是“同样的错误签名”**（`core.mjs` CircuitTracker.observeFailure 只做 tool+error-code 指纹），与今天验证过的语义（`stalled` 来自 Event 投影）不一致；Progress（今天的 projection 包）还在仓库外（`experiments/native-pp/projection/`）。

## 2. 目标结构

```
dsh-runtime/
├── core/
│   ├── runtime-seam/             ← 收缩为「事实与守卫基底」：
│   │     fact registry / teaching reason / activity record / host 接线 / settings schema
│   │     （CircuitTracker 迁出，见下）
│   ├── runtime-progress/         ← 事实层（NEW，从 experiments/native-pp/projection 迁入）
│   │     纯 fold：Event → { execution, effect, progress, unknown }
│   │     零工具注册、零 prompt、零模型、零 policy；导出 foldProjection/createFolder + capability effect 模型
│   ├── runtime-circuit/          ← 政策层（NEW，消费 progress）
│   │     stalled × N → guard deny；教学理由引 progress 证据（support 记录 seq）
│   ├── runtime-reconcile/        ← 政策层（NEW，独立于 circuit）
│   │     failure + progressed → 不盲目重试 → surface / stop
│   └── runtime-investigate/      ← 政策层（NEW，独立于 circuit）
│         success + stalled → verify → repair（stalled ≠ stop 原则的落点）
├── plugins/runtime-progress/     ← 保留为「能力消费者参考实现」并改名避免混淆
│                                  （runtime-progress-reference 或 examples/shell-lock）
├── presets/                      ← 语义从「强弱」改为「职责组合」（见 §5）
├── experiments/                  ← 三轮资产落位（见 §6）
├── scripts/                      ← 保留 sanitize-evidence + 复用回溯管线
└── docs/                         ← 本规划 + 前端设计 + 状态报告
```

**依赖方向（唯一允许）**：

```text
runtime-progress  ← 无依赖（纯 fold，只读 Event 记录）
runtime-circuit   → 依赖 runtime-progress（消费，不拥有）
runtime-reconcile → 依赖 runtime-progress
runtime-investigate → 依赖 runtime-progress
runtime-seam      ← 提供 guard 入口 + activity 记录 + 教学理由模板（被上面三个 policy 调用）
```

## 3. 分阶段执行（第一阶段：先不加功能，改 Circuit）

### 阶段 1：Progress 正式入仓（事实层）

- `experiments/native-pp/projection/lib/index.js` → `core/runtime-progress/lib/index.js`，内容不动（0.1.0 语义已三路一致验证：live fold == 官方重放 == 独立实现）；
- 移入后补一个**包级单元测试**：用 `experiments/native-pp/results/*.events.jsonl` 的 verdict 相关子集做 fixture，断言 fold 输出与已验收的 projection.json 逐字段一致（把实验资产变成回归测试）；
- 明确包 README 第一句：**事实层，不拥有 policy，不 retry/stop/wait，不调模型**。

### 阶段 2：Circuit 接 Progress（语义替换，不是叠加）

- `runtime-seam/core.mjs` 的 `CircuitTracker` 迁入 `core/runtime-circuit/`，判断从「同工具 + 同错误码」改为「**同 capability 连续 N 次失败且 effect 无进展（stalled）**」：
  ```text
  Event → Progress → stalled × N → Circuit → Guard deny
  ```
- 教学理由改为引 Progress 证据（`execution=failed, effect=stalled, support=[seq…]`，即今天 policy.json 的 evidence 格式）；
- 实验依据（已写入 status 报告）：真实执行 6→2（−67%）、cacheRead −27%、N=4 稳定——不是理论设计；
- seam 里保留 `guardReason` 入口与 activity 记录，policy 通过 seam 的 guard 注册（与今天 tools.guard 的原生路径等价，保持 seam 的单一介入面）。

### 阶段 3：非原子失败保护 = 独立 policy（不进 Circuit）

- 新建 `core/runtime-reconcile/`：`failure + progressed → do not blindly retry → reconcile / surface / stop`；
- 语义分家写进代码注释与 README：
  > Circuit 解决「重复没有进展」；Reconcile 解决「结果不可信但副作用可能已经发生」。
- capability effect 契约模型（pure / non-atomic / claimed）归各 policy 声明（与今天实验一致：effect 可观察性声明是契约，不是投影的猜测）。

### 阶段 4：`success + stalled → investigate` 独立保留

- 新建 `core/runtime-investigate/`；**不与 Circuit 合并**（原则：stalled ≠ stop）；
- 已知成本特征（aware 更贵，买正确性：静默失败 2/2→0/2）写进包 README，避免后人拿「省 token」误判它的价值。

### 阶段 5：Context 继续 Delta-first，定下来不折腾

- placement 实验（`experiments/placement/REPORT.md`）已闭环：section/context 无更优，prestep-once 冲突处理成本最低 → **变化才出现，事件只在需要时告诉模型**；
- delta 逻辑留在 seam（或独立 `runtime-delta`，若 seam 继续膨胀则拆，本阶段先不动）。

### 阶段 6：preset 语义升级（见前端设计文档 §3 的统一模式表）

- `off / minimal / strict` 内部语义改为职责组合；新增 `balanced`；
- `goal` preset 降级为「goal 能力开关」（goal 段在前端独立存在，不作为一级模式）；
- **暂不新增** creative / reliable / external-effect 等场景 preset——等真实场景更多证据（用户明确：现在不要马上新增）。

### 阶段 7：README 定位换一句

- 主定位改为：**Small deterministic runtime capabilities for agents running on DeepSeek Harness.**
- 人话：**让 Harness 处理那些不值得交给模型猜的问题。**
- 三句话即整个仓库：
  ```text
  Guard    “这件事现在能不能做？”
  Progress “刚才到底发生了什么？”
  Circuit / Reconcile “知道之后，还要不要继续？”
  ```

## 4. 实验资产落位（不散落）

```
experiments/
├── progress-semantics/   ← native-pp 轮 1（四象限/语义对照/reload/成本）
├── progress-consumer/    ← native-pp 轮 2-3（circuit/reconcile/investigate 四格 + N=4）
├── real-coding/          ← native-pp 轮 4-5（real2/3/4/6 真实场景）
└── placement/            ← 已存在，不动
```

演进规则（写进 CONTRIBUTING 或 docs/contribution.md）：

> **先有场景，再有 capability。** 不是「我们可以再做一个 Hook」，而是「这个真实问题 Model 已经解决得不稳定，而且确定性信息已经存在」——然后才下沉。

## 5. 测试插件（与升级并行）

- 每新增/改造一个 core 包，配套一个**只进实验 profile 的测试插件**（沿用今天 harness 模式：EXP_SCENARIO/EXP_ARM/EXP_RESULTS_DIR + 隔离 home + 事后 token 回溯）；
- 目标：结构升级后，四个格子（loop / nonatomic / pretend / 正常任务）能在新结构上重放并得到与今天一致的数字（−67% / −75% / 2→0 静默失败 / 0 误介入）——**结构升级以“行为数字不变”为验收线**；
- 测试插件放在 `experiments/real-coding/harness/` 或 `packages/test-*`（规划：随结构升级第一版先落在 experiments 下，稳定后再考虑独立）。

## 6. 近期三件事（用户指定，然后停）

1. Progress 正式进入仓库（事实层，不拥有 policy）；
2. Circuit 接 Progress；
3. 非原子失败「不要盲目重试」做成独立 consumer。

**不做**：Memory、Snapshot、Effect DSL、改仓库名、新 preset 全家桶。

## 7. 待定事项（记录在案，不实现）

- 前端可见报错 UI（拦截弹层/可见错误卡片）——待定，见前端设计文档 §6；
- presets/ 目录与 core/ 包的关系（preset = 薄 settings 组合层还是 cordis patch 层）——随阶段 6 定；
- 旧 `plugins/runtime-progress` 的去留（保留为 reference 但改名，或移入 examples/）；
- runtime-seam 是否最终缩成 `core/runtime-guard/`（guard 单一职责）+ 共享 substrate 包——阶段 1-3 完成后按实际耦合度决定。

## 8. 执行记录（2026-09-02，阶段 1-3 + 测试）

### 已落地

1. **`core/runtime-progress`**（事实层入仓）：projection 包 1:1 迁入；`test/fold.test.mjs` 回归测试（合成断言 7 项 + 真实数据对照 loop-a1 逐字段相等，usage 因 trace 格式排除并注明）——ALL PASS。
2. **`core/runtime-circuit`**：stalled × N 熔断；`registerCircuitContract({id, match, threshold})` 契约注册 API；拒绝证据带 Progress support 引用。
3. **`core/runtime-reconcile`**：非原子保护；`registerNonAtomicContract({id, match})`；与 Circuit 语义分家（写进包描述）。
4. **`core/runtime-investigate`**：success+stalled 验证修复；`registerClaimedContract({id, match, verify, repair})`；消费 host 事件 `exp/job-changed`；stalled ≠ stop 写进包描述。
5. **seam 收缩（最小）**：`PRESETS` 语义改为职责组合（guard/circuit/reconcile/investigate/delta 五轴，新增 `balanced`）；`CircuitTracker` 标 LEGACY（保留导出兼容 seam 内部，新 policy 禁止依赖）；client.js 模式列表加 Balanced。
6. **旧插件让位**：`plugins/runtime-progress` 改名 `dsh-runtime-progress-legacy`（包名/行 id/导出名三处）。

### 验收（隔离 home，profile t-b/t-a，13 格）

| 验收项 | 目标 | 实测 |
|---|---|---|
| loop aware 真实执行 | 2（baseline 6） | 2 / 2 ✓ |
| nonatomic aware 重复副作用 | 0（baseline 3） | 0 / 0 ✓ |
| pretend aware 静默失败 | false | false / false ✓（check=2、repair=1） |
| ok 对照三 policy 介入 | 0 | 0 / 0 / 0 ✓ |

验收 token（13 格，事后回溯）：input 25,724 / output 43,020 / cacheRead 706,304 / reasoning 26,162。

### 同步与脱敏

- 实验资产：`experiments/native-pp/README.md`（阶段映射 + 验收表）；`results/` 全部保留；
- 脱敏：新增 `scripts/sanitize-native-pp.mjs`（home/session id/DSH 安装路径/仓库绝对路径 → 占位符；core 包依赖归一为可移植 `file:../runtime-progress`），入库前执行。
