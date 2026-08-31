# dsh-runtime-seam

**Minimal Runtime capability seam for DSH** — fact registry with authority/revision/fingerprint, teaching guard, no-progress circuit, committed delta, optional persistence. All mechanisms are evidence-backed (E1–E7); the capability set is gated by a preset, and everything experimental stays behind an explicit switch.

> 一个极小的 Runtime 能力承接点。Guard / Circuit / Delta / Persistence / Goal / Query 六项能力按 preset 组合加载；默认 Minimal，其余时间沉默。完整定位、实验证据与模式说明见仓库根 `README.md`。

## Capabilities

| 能力 | 含义 | 默认 |
| --- | --- | --- |
| `guard` | 已知非法动作在 executor 前被单调拒绝，拒绝内容为教学式 reason | minimal 起开 |
| `circuit` | 相同失败指纹 + 无进展 → 熔断该工具（`[action-rejected]` 类拒绝不计入指纹） | minimal 起开 |
| `delta` | 承诺兑现 / circuit 开断等关键变更，以单条 delta 注入下一轮 | `critical` |
| `persistence` | 确定事实跨会话保留（按 preset 门控加载，避免状态污染） | strict 起开 |
| `goal` | 目标状态 announce + guard（窄版）；reconcile 属 experimental | goal 开 |
| `query` | 按需应答事实查询 | minimal 起开 |

## Presets

```text
off      → 完全不装载（对照基线）
minimal  → guard + circuit + critical delta + query（默认）
strict   → minimal + persistence
goal     → strict + goal（窄版：announce + guard）
custom   → 自行组合（UI 勾选或手写 settings.yaml）
```

preset 是 capability 的**组合**，不是不同实现。对应 `presets/` 目录下各 `settings.yaml.example` 可直接参考。

## 安装

```powershell
cd core/runtime-seam
pnpm pack
dsh plugin add dsh-runtime-seam-<version>.tgz
```

或作为 workspace 依赖（参考 `plugins/runtime-progress` 的 `file:` 依赖）。

## 配置

`dsh` settings 命名空间 `runtime-seam`：

```yaml
runtime-seam:
  preset: minimal            # off | minimal | strict | goal | custom
  authority: false           # 拒绝 reason 是否携带 authority/revision/fingerprint（实验：provenance 不购买 trust）
  circuitThreshold: 2        # 相同失败指纹次数阈值
  capabilities: {}           # custom 模式下的能力覆写
  experimental:
    reconcile: false         # runtime 执行式修复（无证据，默认关）
    freshness: false
    authority: false
```

## 用户入口

- **设置页 Runtime 区块**：切 preset、Custom 勾选能力、查看目标与介入记录（`conversation.input.left` 也有 Runtime 入口按钮）。
- **`/runtime-goal` 命令**（对话框左加号菜单，仿官方 `/goal`）：`/runtime-goal list|add <path> = <value>|remove <path>|clear`。

## 供 Plugin 作者使用

宿主注入 service `runtimeSeam`（可选注入，缺省时宿主自行空转）：

```js
// host plugin（cordis.patch.yml inject runtimeSeam）
const seam = ctx.get('runtimeSeam')
const fact = seam.setFact('capabilities.mcp.ready', false, { authority: 'host' })
const disposeGuard = seam.registerGuard({
  action: 'tool.unload',
  factPath: 'capabilities.mcp.ready',
  predicate: (v, exec) => v === false ? false : true,
  predicateText: 'plugin is required_by_host and cannot be unloaded',
})
const goal = seam.registerGoal('capabilities.mcp.ready', true, {
  transitionNote: 'MCP 就绪后会以 delta 通知你，不要重复探测。',
})
const dispose = seam.onActivity((entry) => { /* 介入记录 */ })
```

## 边界

- Runtime 是执行循环两侧（pre/post action）的确定性承接点；Plugin lifecycle / Host 隔离问题不在这里解决。
- `Persistence ≠ Exposure`、`Authority ≠ Intervention`：状态保留不代表注入，权威不代表替代模型决策。
- 实验性（reconcile/freshness）默认关闭，无机制级证据。

## 文档

- 定位与全部实验证据：仓库根 `README.md`（English）/ `README.zh-CN.md`（简体中文）
- 自定义配置：`docs/custom-config.md`、`docs/adr/0007-runtime-exposure-timing.md`
- 介入与成本记录：`docs/status/`
