# 实验数据全报告（Runtime Capability 验证集）

日期：**2026-08-31** | 环境：本机真实 DSH（隔离 profile）、headless 单进程单会话
受试模型：`deepseek-v4-flash`（默认 effort）与 `deepseek-v4-pro`（默认 effort）
对象：shipped `minimal` preset（工具面 restrict 到 4-5 个）
总量：**约 100+ 次会话运行**，全部 `exit=0`、`runtimeFailures=0`、`agentErrors=0`

---

## R0：离线结论在 DSH/Windows 重跑（对照基线）

| 实验 | 文档记录 | 重跑结果 |
|---|---|---|
| runtime exposure 5 策略 | 1923 / 1158 / 1444 token | **逐项相等**，10/10 checks |
| KV 回放（context 模式） | 688 / 1296 / 592 cacheRead | **逐项相等**，8/8 checks |
| KV 回放（header 模式） | header 提前失效 | 一致 |
| hook / guard / 闭环契约 | 6 / 5 / 8 项 | 全 true |
| `npm test` | 100 通过 | **100/100 pass** |

---

## R1：文本注入 A/B（flash，N=2，18 runs）

臂：A=react-discovery（不注入）/ B=change-only / C=change-persistent

**s1 工具面变化（正事实，模型自己可见）**

| | A | B | C |
|---|---:|---:|---:|
| steps | 5 | 5 | 4.5 |
| 探测 | 1.5 | 1.5 | 1 |
| payload | 80,112 | 106,799 | 95,357 |
| 一致性 | 2/2 | 1/2（写错 `true`） | 2/2 |

**s2 插件生命周期（declared→mounted→ready）**

| | A | B | C |
|---|---:|---:|---:|
| steps | 3.5 | 8 | 8 |
| 探测 | 1 | 3 | 3 |
| 重复验证 | 0 | 2 | 2 |
| payload | 49,085 | 160,443 | 164,261 |
| 结论 | declared（早判定） | ready | ready |

**s3 显式 unknown**

| | A | B | C |
|---|---:|---:|---:|
| steps | 4.5 | 3 | 3 |
| 探测 | 3 | 2 | 1.5 |
| payload | 68,950 | 50,367 | 52,466 |
| 一致性 | 2/2 unknown | 2/2 | 2/2 |

**R1 结论**：注入价值按事实类别分裂；s2 注入诱发复核（模型信工具结果不信注入文本）。期间发现并修复一个度量工件：B/C baseline 泄漏全局 27 工具视图（导致误调用被 deny 的 `write`），受影响单元全部重跑。

---

## R2：守卫 / 教学 / 承诺（flash，N=3，27 runs）

**E1 永久约束（required_by_host=true，unload 永非法）**

| | none | guard-plain | guard-authority |
|---|---:|---:|---:|
| 探测 | 6.33 | 3.33 | 2.67 |
| 拒绝数 | 0 | 1 | 1 |
| 拒绝后复核 | 0 | 0 | 0 |
| steps | 5.67 | 4.33 | 4 |
| payload | 93,627 | 65,918 | 59,211 |
| **worldCorrect** | **0%** | **100%** | **100%** |

→ none 臂模型**明知事实仍违规（探测 6 次后 unload，3/3）**：知识 ≠ 合规。

**E2 临时约束（activate 需 ready）**

| | none | guard-authority | gauth+promised-delta |
|---|---:|---:|---:|
| 拒绝后复核 | 0 | 3 | **1.67** |
| 收敛 step | 1.33 | 6.67 | 5 |
| steps | 4.33 | 9.67 | 7.67 |
| payload | 62,847 | 172,147 | 130,416 |
| worldCorrect | 0% | 100% | 100% |

→ 承诺兑现：**复核 −45%、payload −24%**（唯一实测有效的复核抑制机制）。

**E3 过期行动（ready→disabled）**

| | guard-plain | guard-authority | injection-only |
|---|---:|---:|---:|
| steps | 10.33 | 9.33 | 8.67 |
| 探测（变更前轮询） | 10 | 9.67 | 5.33 |
| 拒绝数 | 1 | 1 | 0 |
| payload | 206,668 | 195,747 | 195,365 |
| **worldCorrect** | **100%** | **100%** | **0%** |

→ 注入臂最便宜但零强制力（被告知 disabled 仍执行，3/3 违规）；守卫臂 100% 正确但为探时机轮询 ~10 次。

**R2 关键**：teachingFailures=0（无任何 (fact,action) 对二次拒绝）；守卫 = 1 次拒绝教会。

---

## R3：Circuit 熔断（flash，N=3）

E4（任务自带"失败就停"）= 天花板：三臂都 ~2 次尝试，模型自停，熔断零误报但测不出价值。

**E4b（重试压力版：必须完成、失败就重试）**

| | none | circuit | circuitdelta |
|---|---:|---:|---:|
| 失败尝试 | 3.33 | 3 | 2 |
| 开断后尝试 | 1.33 | 1 | **0** |
| 拒绝数 | 0 | 1 | 0 |
| steps | 9 | 5 | 3.67 |
| payload | 286,747（单次最高 385k） | 76,696 | 53,005 |
| 探测 | 5 | 0.67 | 0 |

→ **尝试 −40%、payload −81%、steps −59%**；指纹判据（tool+error 签名，忽略参数）零误报。

---

## R4：H1 provenance 与跨会话拾取（flash，N=3）

**E5（H1：provenance 能否减少拒绝后复核）**

| | guard-plain | guard-authority |
|---|---:|---:|
| 拒绝后复核 | **0** | **0.67** |
| steps | 3.67 | 4 |
| payload | 55,380 | 74,932 |

→ **方向性反转**：authority 臂复核更多，且 3/3 把拒绝文本原样粘贴进结果（引用证据而非信任证据）。

**E6（跨会话拾取，三臂）**

| | baseline（不持久化） | none（持久化+沉默） | pickup（持久化+注入） |
|---|---:|---:|---:|
| 探测 | 7 | 5.33 | 5 |
| steps | 12 | 13 | 10 |
| payload | 1,513,193 | 1,242,519 | 732,427 |
| 正确率 | 3/3 | 3/3 | 3/3 |

→ 持久化消除转移追踪（baseline 的 3 次 state 重探消失）；pickup 臂对刚注入的事实仍 live probe 复核（同 E5 行为）；注入的收益是锚定/收敛快（payload −52%），不是省探测。

---

## R5：v4pro 复测 + 创造性场景（N=2）

**soft 层跨模型对比（flash → v4pro）**

| 实验 | flash | v4pro |
|---|---|---|
| E2 承诺（拒绝后复核） | gauth 3 → delta 1.67 | gauth 3.5 → delta 2.5 ✓同向 |
| E4b 熔断（none 臂燃烧） | 3.33 次 / 287k | 2.5 次 / 117k（**约束任务里 pro 更自律**） |
| E5 H1 | plain 0 → auth 0.67 | plain 0.5 = auth 0.5（**H1 两模型定案：不买信任**） |
| E6 拾取 | 探测 7 → 5 | **探测 10.5 → 3；payload 1.18M → 133k（−89%）** |

**E7 创造性框架（开放式，无交付物，v1+v2）**

| | none | circuitdelta |
|---|---:|---:|
| flaky 尝试 | 3.5 | 3 |
| 开断后尝试 | 1.5 | 1（被守卫挡在 body 外） |
| steps | 22 | 16 |
| payload | 3,304,400 | 2,051,622 |

轨迹结构（读事件级）：none 臂 = 全套探测 → 2 次开断后**真实执行**的纯重试 → 创作（pwsh/编辑器）+ **5 次对 deny 工具的重复调用**（第二类循环，轨迹自然暴露）；circuitdelta = 2 次开断后尝试被守卫拒绝 → delta 后零尝试 → 创作同构。定性证据：none 臂伪造"指纹与宿主一致"声明；circuitdelta 臂拿到真实指纹并明言"不可伪造"。

**E7b 创造性框架（改版：交付物+有限路径+无剧透无反重试指令，b1/b2）**

| | none-b1 | none-b2 | circuitdelta-b1 | circuitdelta-b2 |
|---|---|---|---|---|
| flaky 尝试 | 2 | 3（开断后 1） | 2 | 2 |
| steps | 18 | 7 | 7 | 9 |
| payload | 2.36M | 149k | 234k | 625k |
| 交付物可运行 | ✓ | ✓ | ✓ | ✓ |

→ 4/4 交付物可运行（创造自由未被限制）+ circuitdelta 开断后 0 尝试。**任务形态自调重试**：有交付物时单 run 45-92s；开放式 230-335s。Runtime 切多少取决于任务留给重试的空间。

---

## 过程记录（审计与修正，全部有据）

1. **提示词臂间一致性审计**：同场景各臂第一步模型调用逐字节对比，差异 = 结果文件名长度（任务内容）+ 设计处理（注入/拒绝/delta），工具面逐臂相同；无暗变量。
2. **教学 reason 逐字到达模型**：`EXP_NO_PROBE=1` 行为隔离验证（模型仅凭拒绝文本正确引用事实与谓词）。
3. **E3 度量修正**：guard 拒绝 = 防止违规（不计违规执行），修正后 guard 臂 worldCorrect 100%。
4. **E4b/E7 文件冲突事故**：E7 复用 e4 场景+相同 run 标签覆盖 E4b-v1 数据 → 抢救 E7-v1 数据 + 重跑 E4b-v1 + 插件加独立 e7 场景别名。
5. **E7 提示词审计**：老版两处污染（"不要反复重试"指令、"确定性失败"剧透）→ E7b 移除，重试行为恢复自然（none-b2 出现开断后尝试）。

---

## 汇总结论表（数据背书的决策表）

| 情况 | 机制 | 证据强度 |
|---|---|---|
| 无变化 | silence（不出现） | s1：正事实注入零收益 |
| 确定不成立 | Guard（教学拒绝，1 次教会） | E1/E3：0%→100%，teachingFailures=0 |
| 未来确定会变化 | Commitment + Delta | E2：复核 −45%、payload −24%（双模型同向） |
| 重复无进展 | Circuit（指纹熔断） | E4b：payload −81%；E7 创造性下同样成立 |
| 跨 Session 确定事实 | Persist + 按需应答 | E6：v4pro payload −89%；注入仅作成本优化 |
| 需要模型知道 | 按需 Exposure | E6 pickup 天花板数据 |
| 模型可自己处理的不确定性 | ReAct | A 臂基线全部正确 |
| 负边界① | 正事实不注入（L0） | s1 |
| 负边界② | 注入无强制力 | E3-inject：被告知仍违规 3/3 |
| 负边界③ | provenance 不购买信任 | E5：双模型方向性反转/持平 |
