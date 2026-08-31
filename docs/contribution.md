# Runtime Plugin 贡献清单（Contribution Checklist）

一个 Runtime Plugin 的提案或 PR，必须先过这个清单。它是 E1-E7 实验数据与实机踩坑的直接沉淀。

## 第一道闸（归属 + 遏制）

> **Does this capability belong to Runtime at all, and if so, can its failure be contained without compromising Host recovery?**

展开即：

1. 它解决的是真实 DSH 摩擦吗？（friction，不是想象中的完整性）
2. Host 确定性地知道这个事实吗？（Truth）
3. 为什么不让 Agent 自己解决？（所有 A 臂基线全对——Agent 能处理的，Runtime 不插手）
4. 最小介入是什么？（实验答案：1 次教学拒绝 / 1 条承诺 delta / 1 次 circuit 通告）
5. 没有变化时会发生什么？（必须：沉默。s1 负结果）
6. 事实过期时会发生什么？（stale 语义必须明确；freshness 尚无数据 → Experimental）
7. 插件失败时能**不拖垮 Host** 吗？（boot 期与运行期都要答；boot 期事故 Runtime 自身救不了，见下）
8. 能被禁用、被移除吗？（显式 opt-in，默认不装载）

## 第二道闸（介入资格）

```text
Truth alone ≠ Intervention
Truth + Authority + Need → Intervention
```

- **Authority 不构成介入理由**（E5：provenance 不买信任，flash/v4pro 双模型定案）；
- **Need 是唯一触发器**：Agent 继续会进入错误/无进展路径（E1/E4b），或拒绝里承诺过的转移到期（E2）；
- **暴露 ≠ 介入**：更多 context ≠ 更可靠（E6 pickup 默认沉默，注入仅作成本优化）。

## 实机检查项（踩坑沉淀，违反即拒）

1. **环境服务必须可选获取**：`webServer` 等仅在 web profile 存在的服务，用 `ctx.get()` + 条件注册；硬 `inject` 在 headless profile 会 pending 拖死整个 boot（PITFALLS 2026-08-31）。
2. **settings schema 用 `@deepseek-ai/schemastery`**：`Schema` 实例是可调用函数；zod 对象注册即抛 "schema is not a function"（PITFALLS 2026-08-31）。
3. **waterfall 事件必须透传 `next()`**：坏监听器会锁死全部工具（maker 契约校验已拦）。
4. **绝不读 `ctx.config`**：DSH 无此服务，访问即抛、启动树中止；配置走 `apply(ctx, config)` 或 settings 命名空间。

## 证据要求

每个"介入能力"行必须标注证据级别：

- `proven`：E1（guard 教学）/ E2（承诺 delta）/ E3（守卫 vs 注入）/ E4b（circuit）/ E6（persistence）——双模型（flash + v4pro）方向一致；
- `directional`：N≤3 或单模型的方向性结果；
- `untested`：freshness、ownership 权威化、runtime-executed reconcile 等——只能进 Experimental，不得伪装成最佳实践。
