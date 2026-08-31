# Runtime Exposure Timing 实验

实验日期：**2026-08-31**  
当前状态：**机制已验证（simulated + automated），真实 DSH 行为未验证**

## 这次实验要回答什么

当前问题不是“要不要 Runtime”，而是：

1. Runtime 的哪些事实值得进入 Agent 的下一轮 Reason；
2. 稳定事实是否可以留在已有上下文/KV 中而不重复发送；
3. 确定性变化是否只需要发送 delta；
4. 宿主不知道的状态能否明确保持为 `unknown`，而不是由模型猜测；
5. 这条旁路是否可以在不改变正常模型调用、Prompt、Tool surface 和阻塞行为的情况下运行。

## 从 DSH 源码得到的边界

公开 DSH 架构把 Session 作为追加式事件流，并把 Tool Registry/Pipeline、Scope、Agent 和 Workflow 分成不同能力 seam。`request/header` 事件包含一次请求组装后的工具面和系统提示等信息，`request/context` 提供请求上下文；这些信息可以作为实验输入，但不代表 DSH 已经提供了一个统一的 Runtime State API。

本项目因此只读取宿主明确提供的字段：

- `request/header`：提取工具名称和 schema digest，不复制系统提示或工具描述；
- `request/context`：只提取显式 provider/model/scope 字段；
- `runtime/snapshot` 或 `runtimeFacts`：接收宿主主动提供的完整事实；
- `runtimeChanges`：接收宿主主动声明的变更，包括没有出现在上一份 baseline 中的删除；
- `tool/result`、`turn/end` 等环境观察：保持环境事件，不冒充 Runtime fact。

若 DSH 版本没有暴露某个事实，适配器返回“不具备权威事实”的结果，或由调用方显式写入 `unknown`。它不会从插件目录、聊天记录或文件名推断“当前激活插件”。

## 当前实现

### 宿主无关控制器

[`src/runtime/exposure.mjs`](../src/runtime/exposure.mjs) 提供 `RuntimeExposureController`：

```text
host snapshot
    ↓
normalize facts
    ↓
baseline / full / delta / suppress
    ↓
next Reason input
```

事实状态固定为：

```text
known | unknown | stale | conflicting
```

`change-persistent` 采用：

```text
一次 baseline（完整 context）
后续 delta（可重放 patch）
```

后续 delta 不重复完整 context，只带 baseline fingerprint 和当前 fingerprint。删除使用显式 `op: "remove"` 与 `after: null`，因此可以经过 JSON 序列化后重放。

### DSH 被动观察适配器

[`src/adapters/dsh/runtime-observer.mjs`](../src/adapters/dsh/runtime-observer.mjs) 提供：

- `DshRuntimeObserver`；
- `normalizeDshRuntimeEvent()`；
- `buildDshRuntimeSnapshot()`；
- `summarizeDshTools()`；
- `installDshRuntimeObserver()`（默认关闭）；
- `ctx.projectContext.createRuntimeObserver()` 显式 seam。

适配器本身不：

- 注册模型可见 Tool；
- 改写 system prompt；
- 调用模型；
- 打开 Project Bridge SQLite；
- 把 Runtime 变成新的聊天角色。

Runtime 只作为下一轮 Reason 的一个字段：

```js
{
  actionResult,
  environmentalObservation,
  runtimeObservation
}
```

### 离线可重复实验

[`src/runtime/simulate-exposure.mjs`](../src/runtime/simulate-exposure.mjs) 使用固定的 7 个时间点：

| 时间点 | 事实 | 预期 |
|---|---|---|
| t0 | Session、Scope、Profile、read/edit/bash、Maker ready | 建立 baseline |
| t1 | 完全稳定 | 不暴露 |
| t2 | 插件内部 declared → mounted，但 action surface 不变 | 不暴露 |
| t3 | lsp ready，工具面增加 lsp | 只暴露 delta |
| t4 | 稳定 | 不暴露 |
| t5 | lsp 移除，工具面恢复 | 只暴露 delta，删除可重放 |
| t6 | 依赖拓扑未被宿主提供 | 暴露显式 unknown |

运行：

```powershell
npm run runtime-experiment -- --compact
```

实验同时比较：

```text
none
always
change-only
change-persistent
react-discovery
```

当前固定 fixture 的机制结果：

| 策略 | 暴露次数 | 稳定抑制 | 估算 payload token | 备注 |
|---|---:|---:|---:|---|
| none | 0 | 0 | 0 | 变化转为 discovery 请求计数 |
| always | 7 | 0 | 1923 | 每次完整快照 |
| change-only | 4 | 3 | 1158 | baseline + 3 个 delta |
| change-persistent | 4 | 3 | 1444 | baseline 带 context，delta 不重复 context |
| react-discovery | 0 | 0 | 0 | 4 个需要发现的时间点 |

这些 token 是 JSON 字符数除以 4 的粗略估算，不是模型 tokenizer 结果，也不是 KV 命中率。

## 已经能下的结论

### 机制层成立

- 稳定快照可以确定性抑制；
- 事实变化可以只发 delta；
- 删除不会因为 JSON 序列化而丢失；
- `unknown/stale/conflicting` 可以保持显式；
- Runtime 可以进入下一轮 Reason 输入，而不是插入额外对话轮；
- DSH 事件缺少权威字段时，适配器可以 fail-open；
- 默认路径没有模型调用、Prompt 增量、Tool schema 增量或阻塞 Host 调用。

### 现在还不能下的结论

- 不能声称真实 DSH Agent 会少做多少探测；
- 不能声称 KV 命中率提高；
- 不能声称 Runtime fact 一定比 ReAct discovery 更准确；
- 不能声称 DSH 当前版本会自动提供完整的 activation/dependency topology；
- 不能把离线 fixture 结果标记为 `host-verified`。

## 下一阶段：真实行为实验，而不是继续扩展协议

在 Windows disposable DSH Profile 中，用固定版本 wave 做 A/B：

```text
A: ReAct discovery（不提供 Runtime observation）
B: change-only
C: change-persistent
```

每个场景重复相同任务，记录：

- discovery/inspect 工具调用数；
- 重复验证次数；
- 第一次正确行动前的 step 数；
- 错误假设和错误操作数；
- request/header payload 大小；
- 正常模型调用数和总 token；
- Runtime observation 产生的阻塞/失败数；
- 用户是否需要手工纠正。

至少先做三个场景：

1. Tool surface 增加/移除；
2. Plugin ready 与 mounted 的差别；
3. Scope/dependency 未暴露时的 unknown。

只有当真实数据重复显示收益，才考虑把某类 fact 提升为稳定协议或默认观察项。若收益不明显，删除该观察项，不为了完整性保留它。

## 使用方式（显式 opt-in）

DSH 侧插件可以在已经拿到权威事件时显式接入：

```js
const observer = ctx.projectContext.createRuntimeObserver({
  policy: "change-persistent",
});

const result = observer.observeEvent(event, { session });
const reasonInput = observer.reasonInput({ actionResult });
```

如果宿主没有提供完整事实：

```js
observer.observeEvent({
  type: "runtime/snapshot",
  runtimeSnapshot: buildDshRuntimeSnapshot({
    sessionId,
    tools,
    unknown: ["plugins.active", "dependencies.current_host"],
  }),
});
```

`installDshRuntimeObserver()` 的 `enabled` 默认是 `false`。本实验没有安装 DSH，也没有把观察器自动挂到现有 Project Bridge 生命周期。

