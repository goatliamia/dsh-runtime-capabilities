# Custom 配置指引（手写 settings.yaml）

Custom 模式 = 你自己决定 Runtime 有哪些能力。两种方式等价，都写进同一个地方：

- **界面勾选**：设置 → Runtime → 点 Custom → 勾选/取消能力复选框（立即生效）；
- **手写文件**：编辑 `<DSH_HOME>/settings.yaml`（DSH_HOME 未设时为 `~/.dsh/settings.yaml`）。

两种方式都落在 `runtime-seam` 命名空间下。改完文件后，重启 DSH 或等命名空间热应用生效。

## 字段参考

```yaml
runtime-seam:
  preset: custom            # off | minimal | strict | goal | custom
  authority: false          # 拒绝理由是否带 authority/revision/fingerprint（E5：不买信任，默认关）
  circuitThreshold: 2       # 同一 (工具, 错误签名) 失败多少次后熔断（E4b 数据：2）
  capabilities:             # 仅 preset: custom 时生效；缺省继承 Minimal 基线
    guard: true             # 已知非法动作 → 教学式拒绝（E1/E3）
    circuit: true           # 重复失败无进展 → 熔断（E4b）
    delta: critical         # 变更通知：critical（承诺/开断）| none（全沉默）
    persistence: false      # 事实跨会话持久化（E6：默认沉默，注入仅作成本优化）
    query: true             # 权威应答（L2）
    goal: false             # Runtime Goal（窄版：announce + guard）
  experimental:             # 一律默认关，未验证能力不进这里之外
    autoPickupInjection: false   # 自动拾取注入（E6：默认应沉默）
    broadExposure: false         # 更激进的暴露（E5/E6：更多 context ≠ 更可靠）
    reconcile: false             # 运行时执行式修复（唯一未测试的新原语，勿开）
```

## 规则

1. **能力只能增删，不能发明**：capabilities 里只认上表六个键；其余键被忽略（schema 是 dict，但 host 只读这六个）。
2. **Exposure 默认静默**：没有 `delta: critical` 之外的暴露档位；想要更激进暴露请先开 experimental.broadExposure 并接受"更多 context ≠ 更可靠"。
3. **Freshness 没有证据**：任何 stale/expiry 语义都未验证，不要手写进 capabilities。
4. **Goal 窄版**：Goal 只支持 fact + desired + 已知转移说明；Runtime 不执行修复（reconcile 属 experimental）。
5. **改坏了的兜底**：删掉 `runtime-seam` 整段 = 回到默认 Minimal；schema 校验失败的写入会被 settings 拒绝并保留上一份好值。

## 各模式的等价写法

```yaml
# Minimal（默认，已验证硬能力）
runtime-seam:
  preset: minimal

# Strict（更强强制力；注意：可能降低 Agent 自由度）
runtime-seam:
  preset: strict

# Goal（窄版目标：announce + guard）
runtime-seam:
  preset: goal

# Custom 示例：只要 Guard + Circuit，其余全关
runtime-seam:
  preset: custom
  capabilities:
    guard: true
    circuit: true
    delta: critical
    persistence: false
    query: false
    goal: false
```
