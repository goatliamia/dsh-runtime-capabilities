# 隔离的真实 DSH Runtime 行为实验设计

实验日期：**2026-08-31（续）**
当前状态：**已执行**（结果与验收见 `docs/status/runtime-behavior-2026-08-31.md`）
前置：`docs/07-runtime-exposure-experiment.md`（机制已验证）、`docs/08-dsh-kv-prefix-replay.md`（离线前缀已验证）

## 1. 目的

只做一件事：**在真实 DSH 上验证 Runtime exposure 的行为收益**。不更新核心、不更新任何已装插件、不扩展协议。

回答 docs/07 遗留的问题：

1. Runtime fact 是否减少 Agent 的 discovery/探测调用；
2. 是否减少重复验证和错误操作；
3. 是否能更快到达第一次正确行动；
4. 旁路本身是否产生阻塞/失败；
5. payload 与模型调用成本是否可控。

## 2. 为什么必须严格隔离（已核实的干扰源）

本机活动 profile（`web`）挂载了多个会污染实验的插件，逐一读过其挂载内容：

| 插件类别 | 已核实的干扰面 |
|---|---|
| 会话桥接 / 后台捕获类 | Host bundle：`session/event` 监听、后台捕获、SQLite 写入、会话开始注入指令、多个捕获类工具进入工具面 |
| 复盘 / 模式沉淀类 | 模式 watch/guard、学习沉淀类工具、写本地文档、可弹交互卡改变行为 |
| 开发工具链类 | 带硬约束指令的工具与 skill（「开工前先调用本工具拿清单」），直接改写 Agent 行为 |
| 其他（语音 / 可视化 / 媒体 / UI 类） | 工具面、MCP、session 依赖，同样排除 |

任何一个进入实验会话，都会污染：工具面基线、探测调用计数、错误计数、payload、甚至行为指令。因此隔离必须是**环境级**，不是「换个 preset」级别——宿主组合里挂着这些插件时，它们的监听器对本 host 内所有会话都生效。

## 3. 隔离架构（三层隔离）

```
实验专属 DSH_HOME:  <HOME>\.dsh-runtime-exp     ← 独立 storages/sessions/settings/plugins
  └─ profiles/exp:   bundles = [dsh-base, dsh-headless, dsh-runtime-experiment]  ← 只有 3 个 bundle
  └─ settings.yaml:  agent-presets.default = minimal（shipped，仅 pwsh+fs+编辑器，零 skill）
  └─ .credentials.yaml ← 从当前 home 复制（同一用户同一机器）

每次运行 = 一个独立 headless 进程：
  DSH_HOME=... dsh --profile exp "场景任务文本"
  → 一个会话、一个数据点、进程级隔离，运行间互不可见
```

- **home 级隔离**：新 home 没有任何宿主插件的目录、状态或插件数据；
- **组合级隔离**：`exp` profile 只含 3 个 bundle，`--dump-config` 可审计；
- **进程级隔离**：每个 scenario×arm×repeat 是一次性 headless 进程，模型上下文、KV、内存互不跨染。

### 启动前隔离断言（必须全真才开跑）

1. `dsh --profile exp --dump-config` 只出现 3 个 bundle id；
2. 实验会话工具面不含任何宿主常驻插件的工具；
3. 新 home 下无 `plugins/`、无任何 SQLite/WAL 文件（实验插件只写 results 目录）；
4. 实验会话系统提示不含 skill 目录、不含「清单/收件箱」指令（`minimal` preset persona 固定）。

## 4. 实验插件 `dsh-runtime-experiment`

从本仓库构建的最小 Host bundle（无 client、无 SQLite、无模型可见业务工具之外的注册）：

- `lib/runtime/exposure.mjs`：直接复用仓库 `src/runtime/exposure.mjs`（原样拷贝，不改）；
- `lib/index.js`：真实宿主接线 + 场景切换 + 度量记录。

### 真实 DSH 事件 → observer 映射（本机 host 已核实）

| 仓库概念 | 真实 DSH seam | 用途 |
|---|---|---|
| runtime/snapshot（工具面） | `ctx.tools.schemas()` + `tools/change` | 权威工具面事实，只留 name+schema digest |
| runtime fact 注入点 | `agent/pre-step`（waterfall，可替换进入 steps 的 messages） | 按策略把 `runtimeObservation` 作为下一轮 Reason 输入字段注入 |
| request/header 度量 | `agent/request`（waterfall）+ `llm/stream`（waterfall） | 记录冻结调用配置与请求 payload 大小 |
| tool/result | `tools/result`（emit） | 记录工具调用数、错误、探测次数 |
| 错误/阻塞 | `agent/error`、`tools/execute` | 记录 Runtime 旁路是否造成失败 |
| token 度量 | `tokenMeter` service（真实测量）+ llm/stream 计数 | 模型调用数与 token 估算 |
| 会话边界 | `agent/session-start` | 每会话一个 controller 实例 |

### 策略臂（同 docs/07）

- **A = react-discovery**：不注入任何 Runtime observation；Agent 需自行调用 `exp_probe` 工具探测事实（每次调用 = 一次 discovery 成本）；
- **B = change-only**：首轮 baseline，事实变化只注入 delta；
- **C = change-persistent**：baseline 带 context，后续 delta 不重复 context。

### 场景切换（进程内确定性，无随机）

插件从环境变量读取 `EXP_SCENARIO`、`EXP_ARM`、`EXP_RUN`；按 step 计数触发事实变化（例：S1 在 step2 注册临时工具、step5 注销），保证每个 run 的事件序列固定。

## 5. 三个场景与任务

| 场景 | 事实变化 | 任务（三臂完全相同的文本） | 正确行为判定 |
|---|---|---|---|
| S1 工具面变化 | 临时工具 `exp_tmp_paint` 在 step2 出现、step5 移除 | 「确定 `exp_tmp_paint` 是否可用；可用则调用它把 `painted` 写入结果文件，不可用则写 `absent`；完成后报告你从哪一步起知道它可用」 | 写出正确文件；知道时间的来源正确；A 臂不因工具消失后仍调用而报错 |
| S2 插件生命周期 | 探针插件的 `state` 从 declared→mounted（step2）→ready（step4） | 「确定当前 host 里 exp_probe_plugin 的 state 是什么，把最终 state 写入结果文件；只在你知道 state 的准确时刻记录它」 | 记录值 = ready 且时刻 ≥ step4；B/C 臂不应早于事实出现就写 |
| S3 显式 unknown | 依赖拓扑事实 host 永不提供 | 「报告当前 host 的 dependency topology；如果你无法从权威来源知道它，必须明确回答 unknown，不要猜测」 | 明确回答 unknown 且未编造；A 臂允许探测后回答 unknown，但不允许猜测具体值 |

每臂执行前清空 results 对应文件；任务文本、模型、preset、effort 三臂完全一致。

## 6. 度量 schema（每次 run 一个 JSON）

```json
{
  "run": "s1-arm-b-r2",
  "scenario": "s1",
  "arm": "change-only",
  "sessionId": "...",
  "steps": 8,
  "toolCalls": 12,
  "probeCalls": 3,
  "toolErrors": 1,
  "wrongGuesses": 0,
  "firstCorrectStep": 4,
  "repeatedVerifications": 1,
  "modelCalls": 9,
  "estimatedTokens": 21400,
  "requestPayloadChars": 48210,
  "exposures": { "baseline": 1, "delta": 2, "suppressed": 5 },
  "runtimeBlocking": 0,
  "runtimeFailures": 0,
  "userCorrections": 0,
  "resultCorrect": true
}
```

原始事件写入 `results/<run>.events.jsonl`（同仓库 experiments 风格）。

## 7. 运行矩阵与成本

3 场景 × 3 臂 × N=2 = **18 次 headless 运行**（先 N=1 冒烟）。

模型：三臂同 provider 同 model 同 effort（参数在 settings.yaml 固定）。成本取决于选定 model，估算见执行时按单次运行实测外推；先以 1 次冒烟测单 run token 数再决定 N。

## 8. 聚合与判定

聚合脚本输出 per 场景的 A/B/C 对比表：

| 指标 | A | B | C |
|---|---|---|---|
| probeCalls 均值 | ? | ? | ? |
| toolErrors 均值 | ? | ? | ? |
| firstCorrectStep 均值 | ? | ? | ? |
| estimatedTokens 均值 | ? | ? | ? |

判定（沿用 ADR-0007 复审条件）：

- B/C 相对 A 减少 discovery 且**无准确性回退**（resultCorrect 全真、无更多 toolErrors）→ 该 fact 类获得 `behavior-verified` 候选；
- 无明显收益 → 按仓库规则删除该观察项，不保留完整性；
- 只有重复数据支持时才考虑提升为默认能力或稳定协议。

## 9. 执行步骤

1. 构建 `dsh-runtime-experiment` 插件（从仓库 src/runtime 拷贝 controller + 新 host 接线）；
2. 创建 `<HOME>\.dsh-runtime-exp`：复制 credentials、写 settings.yaml（minimal preset + 固定模型）、建 `profiles/exp`（package.json 仅 3 bundles + 本插件依赖）、pnpm install；
3. 跑隔离断言（§3 四条全真）；
4. 每场景每臂 N=1 冒烟 → 检查结果 JSON 与事件日志；
5. 全量 18 次运行 → 聚合 → 写 `docs/status/runtime-behavior-<date>.md`。

## 10. 风险与回退

- headless 单任务模式的 preset/模型解析若与预期不符 → 以 settings.yaml 显式固定，或改用 web profile + 独立端口；
- 实验插件自身必须零默认副作用：不注册业务工具、不改 prompt、不写 SQLite；度量走内存+结束时一次性落盘；
- 任何一步不符合隔离断言即停，不带着污染数据出结论；
- 本设计不触碰当前 `web` profile 与已装插件，退出即清理 `dsh-runtime-exp`。
