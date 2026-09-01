# 验证报告：结构升级验收（native-pp 线，2026-09-02）

提交前验证状态：**全部通过**。本报告是 `docs/17-repo-structure-plan.md` §8 执行记录的正式验收版。

## 1. 验证对象

- `core/runtime-progress`（事实层：Event → execution/effect/progress/unknown，纯 fold）
- `core/runtime-circuit`（policy：stalled × N → guard deny）
- `core/runtime-reconcile`（policy：failure + progressed → 不盲目重试）
- `core/runtime-investigate`（policy：success + stalled → verify → repair）
- seam 收缩（PRESETS 职责组合 + balanced；CircuitTracker 标 LEGACY）
- 前端 `client.js` 重构（场景预设 / 模式 / 分组自定义 / 摘要卡）

## 2. 测试层级与结果

| 层级 | 内容 | 结果 |
|---|---|---|
| 单元/回归 | `core/runtime-progress/test/fold.test.mjs`：合成断言 7 项（verdict/effect/unknown/goal/usage）+ 真实数据对照（accepted loop-a1 projection 逐字段相等） | **ALL PASS** |
| 行为验收 | 隔离 home（profile t-b/t-a），13 格 headless 重放四象限 | **全过**（下表） |
| 启动冒烟 | seam 挂载于 headless profile（t-s）正常 boot | 通过（exit 0） |
| 前端加载 | web profile（t-w）页面 200；served client bundle 语法校验通过 | 通过 |
| 人工视觉验收 | 用户在 web UI 确认三个槽位渲染（输入行按钮 / 设置页 / 弹层） | 通过 |

## 3. 行为验收表（结构升级后数字与验收线一致）

| 验收项 | 验收线 | 实测 |
|---|---|---|
| loop（failure+stalled）aware 真实执行 | 6 → 2 | 2 / 2 ✓ |
| nonatomic（failure+progressed）aware 重复副作用 | 4 → 1（0 重复） | 0 重复 / 2 格 ✓ |
| pretend（success+stalled）aware 静默失败 | 2/2 → 0/2 | 0 / 2 ✓（verify×2、repair×1） |
| ok 对照（正常任务）介入 | 0 | 0 / 0 / 0 ✓ |

circuit 拒绝证据带 Progress support 引用（例 `support:[100,400]`）——policy 消费事实层的形状一并验收。

## 4. 成本与脱敏

- 验收 token（13 格，事后回溯、循环内零计量）：input 25,724 / output 43,020 / cacheRead 706,304 / reasoning 26,162；
- 脱敏：`scripts/sanitize-native-pp.mjs` 最终执行 **357 文件扫描、0 残留**（home 路径 / session id / DSH 安装路径 / 仓库绝对路径全部占位符化；core 包依赖归一为可移植 `file:../runtime-progress`）；
- 构建产物 tgz 由 `.gitignore`（`*.tgz`）排除，不进提交。

## 5. 报告清单（随本提交一并交付）

- 实验设计：`docs/16-native-pp-experiment.md`
- Event 语义对照表：`docs/16-native-pp/event-semantics.{md,json}`
- 结构规划 + 执行记录：`docs/17-repo-structure-plan.md`
- 前端设计 + 实现记录：`docs/18-runtime-frontend-design.md`
- 实验状态报告：`docs/status/native-pp-2026-09-02.md`（语义成立）、`native-pp-consumer-2026-09-02.md`（consumer 四格）、`native-pp-final-2026-09-02.md`（定稿+token 总账）、`native-pp-real-2026-09-02.md`（真实场景）
- 实验资产索引：`experiments/native-pp/README.md`（阶段映射 + 验收表 + 资产约定）
- 本验证报告：`docs/status/native-pp-acceptance-2026-09-02.md`
