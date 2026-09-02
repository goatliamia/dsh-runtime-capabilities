# 18：Runtime 前端设计（基于实际 client.js 打磨 + 今日实际拓宽）

日期：**2026-09-02** | 状态：**已实现（client.js 重构完成，见 §7 实现记录）** | 现状代码：`core/runtime-seam/lib/client.js`

## 1. 现状（实际前端已有三个入口）

| 入口 | 内容 |
|---|---|
| `conversation.input.left` | 「Runtime · <preset>」按钮 + 弹层「为什么 Runtime 介入？」（activity 列表，5s 轮询） |
| `settings.section` | Runtime 设置页：5 个模式按钮（off/minimal/strict/goal/custom）+ Custom 下 6 个能力勾选 + Goal 段 + 介入日志 |
| Activity 记录 | kind ∈ guard / circuit / delta / goal / goal-removed / change |

已有资产可以直接沿用：主题 token、弹层组件、activity 轮询、settings 注册方式（`ctx.slots.register`）。**本次是打磨与拓宽，不是重写。**

## 2. 设计原则（一句话）

> **Runtime 不是「技术配置」，而是「用户选择 Harness 在什么地方替自己承担确定性工作」。**

- 自定义的是**介入程度**，不是让用户配置一堆规则（checkbox 数量受控，≤8）；
- 每个介入必须能回答「为什么」（Activity 是前端最重要的页面之一）；
- 运行结束给一句「这次帮你做了什么」——比任何内部分数都有用。

## 3. 三层结构

> **2026-09-03 双轴改版（已实现）**：第 0/1/2 层重构为两根独立轴——
> **事前 PRE（一个开关）**：continuation，唯一确定的下一步由 Runtime 执行、模型只消化结果；无把握一律不接管（docs/status/native-pp-rc*.md 实测边界）。
> **事后 POST（模式选择器）**：Off/Minimal/Balanced/Strict/Custom，对应 guard/circuit/reconcile/investigate 职责组合。
> 两轴不必落在同一个模式里：preset 键只表示 POST 模式，continuation 键独立开关（settings.yaml 同构）。

### 第 0 层：场景预设（最常用的第一选择）

放在两轴上方；用户通常只需要选一个场景。场景是**双轴快捷键**（同时设定事前开关与事后模式）。

| 场景 | 含义 | 背后组合 |
|---|---|---|
| **Creative** | 少打扰模型，遇到明确问题才介入 | 事前关 + minimal |
| **Coding** | 确定步骤交给 Runtime，事后重视验证 | **事前开** + balanced |
| **External Actions** | 重视副作用与超时后确认 | 事前关 + balanced（reconcile 必开） |
| **Safe / Strict** | 宁愿多验证，也不轻易把成功当完成 | **事前开** + strict |

> 与「创造模式」的关系：创造模式不该限制创造力，而是选择 Runtime「管得多不多」——场景预设就是这句话的 UI。

### 第 1 层：事前（一个开关）

```text
事前 · Pre（替模型走确定性的一步）
  [开关] Continuation
  当事实与契约把下一步压缩到唯一时，Runtime 直接执行（走正常权限/守卫/取消边界），
  模型只消化已发生的结果。无把握时一律不接管。
  （实验验证中：能力随 agent/continue seam 上线）
```

### 第 2 层：事后（模式选择器 + 自定义勾选）

`goal` 不再作为一级模式（Goal 段在前端独立存在）；新增 `balanced`。

| 模式 | 一句话 | guard | circuit | reconcile | investigate | delta |
|---|---|---|---|---|---|---|
| **Off** | 完全不介入 | – | – | – | – | – |
| **Minimal** | 只处理非常确定的事（明显越界、明显重复失败） | ✓ | ✓ | – | – | critical |
| **Balanced** | 无进展时停止；可疑结果做必要检查 | ✓ | ✓ | ✓ | – | critical |
| **Strict** | 积极确认外部效果，宁可多花模型调用 | ✓ | ✓ | ✓ | ✓ | critical |

> ⚠️ 一处与结构规划 §5 的张力待用户拍板：结构规划里 minimal = guard + critical delta（无 circuit）；这里 minimal 带 circuit（今日数据：circuit 是最便宜的确定性介入，−67% 执行/−27% cacheRead）。**建议**：minimal 含 circuit（阈值 2 的纯失败熔断），结构规划里 minimal 的语义同步为本表。

Custom 模式下按四组展示（共 9 项，硬上限：**不得**长成 30 个 checkbox）：

```text
事后 POST（执行后纠偏与止损）
  ☑ Guard          已知非法动作拦截
  ☑ Circuit        连续无进展熔断
  ☐ Reconcile      副作用可能已发生时不盲目重试
  ☐ Verify & repair 成功但未生效 → 验证并修复

基础（既有能力，保留）
  ☑ Critical delta  只通知承诺过的变更
  ☐ Runtime snapshot  完整运行时快照（实验未显示优势，默认关）
  ☐ Persistence / ☑ Query / ☐ Goal
```

- Goal 段与介入日志保留在设置页（现状已有，直接沿用）。

### 第 3 层：Activity（比设置页更重要）

**保留「为什么这次介入」**（现状已有，扩充 reason 模板）：

> 「这次操作被暂停，因为上一步执行失败，但外部状态已经发生变化。」（reconcile）
> 「检测到连续两次操作没有产生新的进展，因此暂时停止继续重试。」（circuit）

每条可展开：发生了什么 / Runtime 看到了什么（引 Progress 的 support 记录）/ 为什么拦 / 可以继续。

**新增「这次帮你做了什么」会话摘要**（运行结束轻卡片）：

```text
Runtime prevented 3 redundant retries
verified 1 successful-looking but unapplied change
0 interventions on normal edits
```

比 `progress projection = 17 / circuit score = 0.83` 有用得多——Runtime 的价值（少走冤枉路 + 防止现实状态出错）直接可见。

## 4. 与现有 client.js 的映射（改动清单）

| 现状 | 去向 |
|---|---|
| 5 个模式按钮 | 改为 4 个模式（Off/Minimal/Balanced/Strict）+ 上方场景预设行 |
| 6 个平铺 capability checkbox | 改为 3 组 8 项（Execution/Effect/Context），Custom 下显示 |
| Activity 弹层（input.left） | 保留；reason 文案换新模板（circuit/reconcile/investigate 三种） |
| 设置页介入日志 | 保留；加「本次会话摘要」卡片 |
| Goal 段 | 保留（不再是一级模式） |
| 无报错展示 | 待定（见 §6） |

## 5. API 面（host 侧配合，规划级别）

- 现状：`/api/runtime-seam/config`（preset/capabilities）、`/api/runtime-seam/activity`；
- 新增/扩展：
  - config 接受 `scene`（映射到 preset+capabilities 组合，纯前端或 host 各存一份）；
  - activity 条目增加 `evidence`（progress 投影的 support 引用）与 `category`（guard/circuit/reconcile/investigate）；
  - 新增 `/api/runtime-seam/summary`（会话级「这次帮你做了什么」：retries prevented / verifications triggered / interventions on normal edits=0 等计数）。

## 6. 待定（记录在案，本轮不实现）

- **前端可见报错 UI**：guard 拒绝时是否在对话流里渲染可见的拦截卡片（而不是只留在 tool result 文本里）——**待定**。理由：报错可见性影响模型行为面（visibility 本身是一种 exposure），需要一次独立实验（可见 vs 不可见对遵从率/成本的影响）再决定；当前实验全部基于「拒绝理由经 tool result 文本返回」的口径，先不改变。
- 场景预设与 Mode 的层级关系（预设是否只是一个快捷方式，选完落成 mode+caps 组合）——按「是快捷方式」实现。
- Summary 卡片的展示位置（会话结束尾部 vs 侧栏）——随 UI 评审定。

## 7. 实现记录（2026-09-02）

`client.js` 已按本设计重构（语法校验通过；seam 在隔离 profile t-s 冒烟 boot 通过）。落地时对设计的三个映射决策（诚实标注）：

1. **Progress detection 不是 toggle**：事实层常开（`core/runtime-progress` 独立包，无开关语义），UI 渲染为「✓ 事实层，常开，不消耗模型」静态行——避免制造一个并不存在的开关；
2. **Runtime snapshot 映射到 seam 的 exposure 轴**（silent ↔ snapshot），保留「实验未显示优势，默认关」的标注；
3. **自定义总量 10 项**（设计稿 8 项 + 既有 persistence/query/goal 三项保留）——「用户的自定义能力不能丢」优先于 8 项上限；上限原则仍写死：不得长成 30 个 checkbox。

其余全部按设计落地：场景预设 4 键（Creative/Coding/External Actions/Safe，纯快捷方式，post 对应 preset 不持久化 scene 状态）、模式 5 键（Off/Minimal/Balanced/Strict/Custom，Goal 不再是一级模式但 Goal 段保留）、「这次帮你做了什么」摘要卡（客户端从 activity 聚合，不做新端点——host 侧唯一改动是 config 白名单加 reconcile/investigate 两键）。

浏览器内视觉验证未做（需 web profile + 人工确认槽位渲染），留待用户打开设置页验收。

## 8. 实现记录（2026-09-03：事前/事后双轴改版）

按用户定调（「事前就一个、直接打开；事后复杂；预设与自定义必留；两轴不必同一个模式」）重构为双轴：

- **事前 PRE = 单个开关 `continuation`**（独立于事后模式；settings.yaml 顶层键；实验验证中，随 agent/continue seam 上线）；
- **事后 POST = 模式选择器**（Off/Minimal/Balanced/Strict/Custom，preset 键语义不变，Goal 保留为 legacy preset 值）；
- **场景预设 = 双轴快捷键**（Creative: 前关+minimal；Coding: 前开+balanced；External: 前关+balanced；Safe: 前开+strict）；
- 改动面：`core.mjs`（PRESETS 全加 continuation 键 + POST_PRESET_NAMES 导出）、`index.js`（settings schema + readConfig 双轴合并 + config POST 支持独立翻转与场景双轴）、`client.js`（设置页三区：场景/事前开关卡/事后模式卡 + 基础勾选；输入行按钮显示「前✓/— · 后Mode」）、`presets/*.settings.yaml.example`（统一 runtime-seam 命名空间 + 双轴注释）、本文 §3 层级表同步；
- 验证：三文件 node --check 通过；隔离 profile t-w web 冒烟——页面 200、`/plugins/dsh-runtime-seam/client.js` 语法有效且含双轴代码、activity/config API 带浏览器头实测（continuation 独立翻转 ✓、场景双轴 POST ✓、403 守卫按设计拒绝非浏览器请求 ✓）。视觉验收仍留待用户打开设置页人工确认。
