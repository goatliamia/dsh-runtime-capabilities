# ADR-0007：Runtime Exposure Timing 先做可证伪实验

- 状态：`research`
- 日期：2026-08-31
- 范围：Runtime observation 与下一轮 Agent Reason 输入

## 背景

当前 DSH/Agent 讨论已经从“是否需要 Runtime”进入“Runtime 何时出现、以什么粒度出现”的问题。继续先写完整 Runtime Protocol、Scene schema 或 KV 集成，会把尚未证实的假设固化为基础设施。

同时，正常 DSH 对话必须满足：

```text
零默认 Prompt 增量
零默认模型调用
零默认 Tool schema 增量
零正常路径阻塞
```

## 决策

1. 先实现宿主无关的确定性 exposure controller；
2. 用 DSH 被动适配器接收宿主明确提供的 snapshot/change；
3. 稳定状态不重复暴露；变化只暴露 delta；未知状态显式标记；
4. Runtime observation 作为下一轮 Reason 输入字段，不创建新的聊天角色或模型轮次；
5. 所有 DSH 生命周期订阅均为显式 opt-in，默认关闭；
6. 先做离线事件回放和契约测试，再在 Windows DSH Profile 做真实行为 A/B；
7. 在真实数据出现前，不协议化完整 Runtime graph、Scene schema、KV 命中策略或默认事实集合。

## 备选方案

### 每轮发送完整 Runtime

拒绝：会重复稳定事实，增加请求体和上下文噪声，无法验证低成本约束。

### 让 Agent 自己用 ReAct 探索所有 Runtime

保留为实验 baseline：它能反映 discovery 成本，但不能作为唯一机制，因为宿主已经明确知道的事实不应被迫重复探测。

### 由适配器从目录、日志或插件名称推断激活状态

拒绝：这会把 Unknown 冒充 Known，且不同 DSH 版本的 lifecycle 语义并不稳定。

### 现在就做完整 Runtime Protocol/Graph

拒绝：当前没有足够真实样本证明字段、关系、生命周期和暴露边界已经稳定。

## 后果

正面：

- 可以在没有安装 DSH 的机器上验证机制和重放语义；
- 观察器不会改变普通模型回路；
- 删除、未知、冲突等边界可被自动测试；
- 真实宿主接入时只需替换事实来源，不重写 Core。

代价：

- 当前只能得到机制结果，不能声称 Agent 质量提升；
- 真实 DSH/Windows 验证仍是必要工作；
- 适配器可能暂时只能报告 `unknown`，而不是填补缺失事实；
- `change-persistent` 的 context 持久性目前是实验语义，不等于真实 KV API。

## 复审触发条件

满足任一条件后复审本 ADR：

- 三个以上真实 DSH 场景重复显示同一类 Runtime fact 改变行动；
- 某类 fact 的来源、revision 和生命周期在目标 DSH 版本中稳定；
- A/B 显示 discovery 成本下降且无准确性回退；
- 默认观察项的 payload、延迟或故障成本可以被量化并接受。

