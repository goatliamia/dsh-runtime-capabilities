# Community Problem Map

本文件把 `dsh-runtime` 各机制与**真实 DeepSeek Harness 摩擦**对齐。全部条目已经过脱敏：不含用户身份、会话内容、本地路径或私有配置；issue/discussion 只保留问题类别与出现时段，不引用任何未核实的具体编号。

> 声明：这里不声称某个 Plugin 是下列问题的唯一解。对齐的意思是——"这类摩擦里有一部分已经确定到可以由 Harness 接住"，对应机制只承接那一部分。

## 问题类别 → 机制 → 证据

| 问题类别 | 出现时段（观察） | 确定性部分 | 对应机制 | 证据 |
| --- | --- | --- | --- | --- |
| 模型已知某插件不可卸载，仍尝试卸载 | 2026-06 ~ 07 | 动作对世界的效果可以程序化判定 | Guard（执行前单调拒绝） | E1 |
| 拒绝后模型继续 probe，直到状态变化 | 2026-07 | 状态"未来一定会变"是承诺，不是失败 | Commitment + Delta | E3/E5 |
| 工具连续返回同一错误，无进展地 retry | 2026-07 | 相同失败指纹 + 无进展 = 可判定死路 | Circuit | E4a/E4b |
| 工具被拒绝后反复重试（非错误、是 deny） | 2026-07 | "被拒绝"本身也是 no-progress 信号 | Circuit（deny-loop 指纹） | E7 |
| 跨 Session 重新发现同一个项目事实 | 2026-07 | 事实已经确定，可以持久化 | Persistence | E6 |
| 长会话中重复提交同一前缀、turn 膨胀 | 2026-07 ~ 08 | 每个不必要的 turn 都有可计量的 cacheRead 成本 | turn-elimination（Guard/Circuit 的副产品） | token-cost-appendix |
| 用户目标本身错误（如卸载必需插件） | 2026-08 | 错误意图不应穿透到可被确定性保护的现实边界 | Guard（D 原则：保护现实，不替用户改意图） | 四象限 B/D/D1 |

## 观察到的、但**不**由 Runtime 承接的问题

这些问题在实验中出现过，但边界判断是：它们属于 Host / Plugin lifecycle / 工具链，而不是 Agent 执行循环两侧的 Runtime：

- Plugin 加载/启动失败拖垮 Host → Host / Plugin contract
- dependency mismatch / headless 环境兼容 → 开发工具链（check/vet）
- 工作区 / 所有权边界 → workspace 层

对应决策见 `docs/adr/0007-runtime-exposure-timing.md`，贡献边界清单见 `docs/contribution.md`。

## 未建立对齐的类别

以下类别只有零散观察，没有机制级证据，**不**映射为任何 capability：

- "模型是否相信 Runtime 的 provenance"（E5：provenance 不购买 trust，正面结论不存在）
- 长期 stale 权威 / freshness 仲裁（尚无证据，留在 experimental 外）
- 正事实的持续注入收益（E2：负结果）
