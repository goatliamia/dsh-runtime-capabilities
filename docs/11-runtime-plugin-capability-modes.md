# Runtime 插件能力模式设计（极简 / 安全 / 自定义 / 模型自迭代 / 目标）

日期：**2026-08-31（续）**
状态：**设计草案（刻意不冻结）**
前置：`docs/status/runtime-behavior-2026-08-31.md`、`docs/status/runtime-guard-round2-2026-08-31.md`、E4（circuit）实验结果

## 0. 设计姿态

**我们不定死 Runtime 的内容。** 社区已经在用 guard / snapshot / receipt / whitelist 各自发明 Runtime 原语，缺的不是又一个"完整协议"，而是一组**已验证的最小词汇 + 五个起步模式**。插件只暴露能力，模式是默认配置，不是菜单上限；社区想要什么，自己在词汇上拼。

## 1. 已验证的最小词汇（Seam v1）

全部经过本机真实 DSH 实测（E1-E4）：

```text
fact    { path, value, status(known|unknown|stale|conflicting),
          authority, revision, fingerprint }
guard   monotonic deny + 教学 reason（fact + predicate + temporal + next）
delta   转移通知，只在两类时刻发出：①拒绝时承诺过的转移（E2）②circuit 开闸（E4）
silence 稳定即沉默（s1 证明正事实不该主动发；默认零成本）
circuit 相同 (tool, error-signature) 重复 + 无进展 → 开断（E4 已验证）
```

唯一"硬"的是 fact 的四字段语义（它们使 Reconcile 成为可能：模型可回引 fingerprint、检测 revision 落后）；其余都是可替换的实现选择。

## 2. 五个模式

### 模式一：极简（minimal runtime）

**它就是"很小的一个 runtime"**：

- 事实注册表：只收宿主明确提供的事实，不推断；
- 按需应答：查询工具对每条事实给出权威答案，**unknown 显式终止**（s3 实测价值：负事实没有廉价发现路径，权威 unknown 终结搜索）；
- 默认沉默：稳定不发、不注入、不改 prompt；
- 无守卫、无承诺、无 circuit。

稳态成本 ≈ 0。价值 = 公共词汇 + 负事实终止 + 按需权威答案。适用：不想让 Runtime 碰执行路径的一切场景。

### 模式二：安全（safety runtime）

**生产级、要求严格的"大 runtime"**：

- 极简全部 + 单调守卫 + 教学拒绝（E1/E3：1 次拒绝教会、零复核、worldCorrect 0%→100%）；
- 临时约束走承诺：`temporal: yes` 拒绝里发承诺，转移时兑现 delta（E2：复核 −45%、payload −24%）；
- 重复确定性失败走 circuit（E4：见结果）；
- provenance 选项（authority+revision+fingerprint，H1 待专项验证）。

纪律：拒绝 reason 模板确定性、≤500 字符、只带一个 leaf fact；教学失败（同 (fact,action) 二次拒绝）= 设计缺陷账本；守卫拒绝永远无副作用；零正常路径成本。适用：凭证、不可逆操作、生产写入、插件卸载等"必须严格"场景。

### 模式三：自定义（developer-custom runtime）

**Seam 本身作为模式：开发者写自己的 runtime-\* 插件。**

不预设行为集合，只给三样东西：

1. 词汇：fact / guard / delta / silence / circuit 的语义与格式（§1）；
2. 接入点：`ctx.tools.guard()`、`agent/pre-step`（delta 注入）、`tools/result`（观察）、fact 注册表 helper；
3. 参考模板：E1-E4 四个实验插件片段，各是一个最小 runtime-\* 的实现样例（constraint-runtime、readiness-runtime、stale-reconcile-runtime、progress-runtime）。

这是社区的主场：dsh-tool-git 的确定性 deny、dsh-write-gate 的两层 gate、dsh-file-undo 的 snapshot、dsh-role-guard 的 whitelist——各自已经在这条路上，本模式只是给它们共享词汇与参考实现。**我们不定内容，只提供已经被数据背书的积木。**

### 模式四：模型自迭代（model self-iteration runtime）

**模型可以向 runtime 写入事实/目标。谨慎设计、谨慎使用，仅限实验测试。**

这是风险最高的模式，设计上是"带硬闸门的写路径"：

- 模型写入的 fact 必须带 `authority: model` + revision + fingerprint，**永远不能覆盖 host 权威事实**（host > model 的优先级硬编码）；
- 守卫、策略、circuit 条件**不可被模型改写**（写门只开在 facts/goals 层，不开在执行路径层）；
- 模型自写的事实进入独立账本，可整体撤销（revoke by authority=model）；
- 对"模型写事实 → 改变自身行为 → 再写"的反馈环，用 circuit 指纹监测（与 E4 同一机制）：自写事实连续改变同一 path ≥N 次且无外部依据 → 冻结该 path；
- 生产环境默认关闭；实验中写路径需显式开关 + 预算上限。

适用：实验测试（如"模型能否把自己的发现固化为下一会话的运行时事实"）。**明确不适用：生产环境默认路径。**

### 模式五：目标（goal runtime）

**runtime 状态本身是收敛目标——"runtime 是目标"的落点。**

- 安全模式全部 + 收敛层：
  - stale/conflicting 检测：会话按旧值行动 → 守卫拒绝即 **Reconcile 事件**（带当前值 + delta + revision 差，E3 原型）；
  - 承诺语义：`temporal: yes` 的拒绝发出承诺，转移时兑现（E2 已验证）；goal 模式下承诺本身成为可追踪对象（pending → delivered），delivered 即收敛点；
  - 跨会话拾取（E6 验证中）：**只拾取 Runtime 自己确认过、带 revision+fingerprint、仍然有效的 authoritative facts**；硬边界——不恢复历史记忆、不恢复 transcript、不恢复模型结论（防滑向 Memory）；注入形态是"当前权威状态"，不出现"上一会话"字样（会话来源只留在内部审计元数据）；见好就收，不扩成记忆系统；
  - knowledgeGap 度量：会话认知 vs 权威状态的距离，作为收敛质量指标（未验证）。

诚实标注：goal 模式的收敛度量与跨会话拾取目前是**假设集合**，E2/E3 只验证了承诺兑现与行动时点调和。它是方向，不是产品。

## 3. 插件形态

一个包，五个 profile（配置即模式）：

```yaml
# runtime: minimal | safety | custom | self-iteration | goal（默认不装载，显式 opt-in）
```

- 所有能力注册随 fiber 释放（卸载即归零）；
- custom 与 self-iteration 是两个极端：前者给开发者，后者给实验；两者共享同一 seam，但 self-iteration 的写路径被硬闸门与 circuit 双重约束；
- 与其他社区插件的关系：它们不必安装我们——只需在同一个 fact 词汇上声明事实、注册守卫。

## 4. 已被数据背书的价值声明（对外口径）

| 声明 | 证据 | 强度 |
|---|---|---|
| 教学式守卫：1 次拒绝教会永久/过期约束，零二次违规 | E1/E3（27 run，teachingFailures=0） | 小样本但二值结果硬 |
| 知识 ≠ 合规：无守卫时模型明知事实仍违规 | E1-none（探测 6.3 次后仍 unload，3/3） | 硬 |
| 承诺兑现把等待成本砍半 | E2（复核 −45%、payload −24%） | 方向性（N=3） |
| 注入无强制力：被告知仍执行违规动作 | E3-inject（3/3 世界违反） | 硬 |
| circuit 阻止重复失败循环 | E4（见验收记录） | 见 E4 |
| provenance 减少复核（H1） | 未测到（天花板） | 无结论 |

## 5. 明确的非目标（防膨胀）

- 不定义完整 Runtime Protocol / graph / scene schema；
- 不为"完整性"保留未验证的观察项；
- 不把五种模式变成默认开启（minimal 之外全部显式 opt-in）；
- 不在极简模式里塞任何执行路径拦截；
- 模型自迭代不进生产默认路径；
- 跨会话拾取只允许权威事实，永不升级为"历史记忆恢复"。
