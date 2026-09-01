# 状态：真实场景首轮（creative mode，2026-09-02 续）

前置：`native-pp-final-2026-09-02.md` | 原始结果：`experiments/native-pp/results/`（real3-*/real6-*）| 对比表：`results/real-comparison.md`

## 0. 创造模式落地

- 本轮的「创造模式」= `standard` shipped preset（完整 coding agent：pwsh/fs/search/skills/goal/plan/subagent/workflow/web/todo 全量工具面）+ **fixture 不再钳制工具白名单**、不注册任何 exp 工具；
- 世界 = 真实项目文件（config.json + apply/verify/reload.ps1；math.js + test.js + run-tests.ps1），Agent 用真实工具（pwsh/editor）在真实工作目录里干活；
- 两臂唯一差异 = policy bundle（pp-f baseline / pp-g aware），同模型同 preset。

## 1. real3：成功但未生效（edit → build ok → runtime stale）

任务：`Run apply-config.ps1 to switch this project to fast mode...`（不提 verify/reload）。
世界：apply-config 改配置+build 成功，但 runtime 不重载（runtime-state 仍是 slow）。

| | baseline | aware |
|---|---|---|
| 世界正确（runtime=fast） | 0/2 | **2/2** |
| 静默失败（谎报成功未修复） | **2/2** | **0/2** |
| verify / reload 执行 | 0 / 0 | 2/2 格均执行 |
| policy 介入 | — | 每格 1 次 investigate-inject |
| modelCalls（均值） | 7 | 11 |
| cacheRead（均值） | 124,928 | 188,672 |

- baseline 两格都把 apply 的 success 当完成，世界保持 stale——**静默失败 100%**；
- aware 两格：pattern 契约（pwsh 参数含 apply-config）→ 注入 investigate → agent 跑 verify 发现 STALE → reload → 复验 MATCH。**「工具说成功」≠「事情已发生」在真实 workflow 里被政策纠正**；
- **成本诚实**：aware 更贵（约 +50% cacheRead、+4 modelCalls）——这里买的是 correctness，不是 cost，与设计预期一致。

## 2. real6：正常任务（负面对照）

任务：修 math.js 让测试全过。世界：真实 node 测试，无脚本化故障。

| | baseline | aware |
|---|---|---|
| 测试通过 | 2/2 | 2/2 |
| 任务产物 | 2/2 | 2/2 |
| policy 介入 | — | **0/2（零误介入）** |
| modelCalls（均值） | 9.5 | 9 |
| cacheRead（均值） | 152,704 | 139,648 |

**正常任务不被 Guard/Circuit/注入打扰，质量与成本零回退**——「它是不是把正常 Agent 也管烦了」的回答是：没有。

## 3. Token 用量（事后回溯）

本轮 8 格：input **77,224** / output **24,868** / cacheRead **1,427,456** / reasoning **10,588**。
单格明细见 `results/token-index.json`。

## 4. 待办队列（runtime 无关的剩余场景）

- real2 非原子失败（deploy 超时但已部署 → duplicate side effect=0）：world=deploy.ps1（写部署计数文件后 exit 1）+ policy pattern non-atomic deny，机制已有（pattern 契约 + guard），下一轮直接复用；
- real4 异步 polling（start→running→complete）：world=job 状态文件 + policy 通过 host event（fixture ctx.emit 脚本化状态变化）→ 变化注入 vs baseline 轮询，比较 polling 次数/modelCalls/cacheRead；
- real1（重复无进展）已由 fixture 轮证明（−67% 执行/−27% cacheRead），留待不同模型/长上下文复验；
- real5（Plugin lifecycle）按用户要求放最后（与 runtime 插件相关）。

## 5. 二轮结果（real2 + real4，2026-09-02 晚）

### real2：非原子部署——**无差异，但这是有价值的信息**

| | baseline | aware |
|---|---|---|
| 部署次数 | 1 / 1 | 1 / 1 |
| 重复副作用 | 0 / 0 | 0 / 0 |
| policy 介入 | — | 0（未出手） |

原因：本格世界里部署记录文件就摆在 cwd（agent 可读），且 v4-pro 看到「确认丢失但已部署」的错误后自己先查了部署记录，没有盲目重试。**当副作用本地可验证 + 模型足够强时，policy 在该格无增量价值**——它只在副作用不可见（fixture 轮 4→1）或模型更弱时值钱。这是「能区分价值」的正面收获：找到了价值边界。

### real4：异步轮询——**优势不显著（N=2）**

| | baseline | aware |
|---|---|---|
| status.ps1 轮询 | 0 / 0（agent 用 pwsh 等待循环直接盯文件） | 2 / 0 |
| 完成注入 | 事件照发、无人消费 | 每格 1 次注入 |
| 世界正确 | 2/2 | 2/2 |
| cacheRead | 168k / 206k | 169k / 141k |

baseline 的 agent 同样聪明：不逐步轮询，而是写一个等待循环盯状态文件。Event substrate 的优势在这个模型+这个等待时长（15s）上体现不出来；它要到更长等待/更多轮询步/更弱模型才可能显现。诚实记录：该格本轮不支持「Event 基底优势」的断言。

### 工程坑（已沉淀 PITFALLS.md）

- 任务脚本 `Start-Process` 派生子进程继承沙箱 pwsh 的 stdout 管道 → 工具调用挂死；
- 插件裸 `setInterval` 不在 ctx.effect 里 → Cordis 优雅退出后进程永不结束。
修复：job 状态转移改为 fixture 宿主侧 ctx.effect 管理的定时器脚本化（反而更贴合「平台事件基底」的模拟）。

## 6. 累计 Token（含二轮）

| 阶段 | input | output | cacheRead | reasoning |
|---:|---:|---:|---:|---:|
| 累计（39 格） | 165,948 | 115,290 | 3,921,152 | 59,834 |
