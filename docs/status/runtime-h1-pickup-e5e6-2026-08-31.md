# E5（H1 provenance）+ E6（跨会话拾取）实验结果

日期：**2026-08-31**（隔离 DSH、`minimal` preset、`deepseek-v4-flash`、N=3/臂、全部 exit=0、零 runtime 失败）

## E5：H1——provenance 能否减少拒绝后的复核？

设计：任务把错误信念（state=ready）植入模型，实际 state=disabled；守卫拒绝。两臂拒绝内容完全相同，只差 provenance 行（authority+revision+fingerprint）。

| 指标 | guard-plain | guard-authority |
|---|---:|---:|
| 拒绝数 | 1 | 1 |
| **拒绝后复核探测** | **0** | **0.67** |
| 总探测 | 1.33 | 1.33 |
| steps | 3.67 | 4 |
| payload | 55,380 | 74,932 |

**H1 未获支持，且方向性反转**：authority 臂拒绝后反而探测更多（2/3 次运行出现复核），payload 更高。附带观察：authority 臂 3/3 把整段拒绝文本原样粘贴进结果文件——模型在"引用证据"而不是"信任证据"。

**结论**：provenance 三字段**不购买信任**。模型只信任自己的探测（与此前 E2 发现一致）。三字段的真实价值回到 Reconcile 的仲裁面（版本差检测），而不是"让模型相信"。H1 可以收场。

## E6：跨会话拾取（三臂水位语义）

设计：p1 收敛会话把权威事实（state=ready, rev3+fingerprint；dependencies=unknown）落盘。p2 冷启动三臂：

- **baseline**：不持久化，世界照常 declared→mounted→ready，模型重新收敛（重发现基线）；
- **none**：持久化但沉默（水位 0），探测时 L2 直接以权威答案伺候；
- **pickup**：持久化 + 第一轮注入（天花板）。

| 指标 | baseline | none (L2) | pickup (注入) |
|---|---:|---:|---:|
| 探测数 | 7 | 5.33 | 5 |
| steps | 12 | 13 | 10 |
| payload 字符 | 1,513,193 | 1,242,519 | 732,427 |
| 结论正确率 | 3/3 | 3/3 | 3/3 |

探测序列（r1）：

- baseline：8 次探测分布在 step1→11，其中 state 探测 3 次（追踪 declared→ready 转移）+ 全环境探索；
- none：step1 一次批探 5 项（持久化状态即时命中）——**重发现成本被 L2 压缩成一次批探**；
- pickup：step1-2 探 4 项——**包括对刚注入的 state 再做一次 live probe 复核**。

**结论（方向性，N=3，方差大）**：

1. 持久化消除了"转移追踪"：baseline 的 state 重探（3 次）在 none/pickup 中消失；
2. **模型无论如何都会复核**：pickup 臂对刚注入的事实仍做 live probe——与 E5 一致，注入/文本不购买信任；
3. 但 pickup 的总成本方向性最低（732k vs none 1.24M vs baseline 1.51M）——注入的收益不在"减少探测"，在"锚定早、收敛快、总 transcript 短"；
4. **对水位问题的回答**：默认水位应为 0——持久化 + L2 伺候已拿下"消除重发现"的大头；注入保留为**成本优化手段**（长会话、多事实时），不是信任机制。

## 边界声明（用户设定，写入设计）

pickup 只允许拾取 **Runtime 确认过、带 revision+fingerprint、仍然有效的 authoritative facts**；永不恢复 transcript、模型结论或任何历史记忆（防滑向 Memory）。注入形态是"当前权威状态"，不出现"上一会话"字样；会话来源只留在共享文件的审计元数据里。见好就收。

## 成本补充（真实 token，2026-09-01 回溯解码）

| 臂 | n | input | output | reasoning | cacheRead |
|---|---|---:|---:|---:|---:|
| e5-gplain | 5 | 1,767 | 1,112 | 590 | 22,682 |
| e5-gauth | 5 | 3,408 | 1,609 | 906 | 29,286 |
| e6-baseline | 3 | 93,523 | 16,136 | 10,791 | 853,333 |
| e6-none | 5 | 63,416 | 10,412 | 6,205 | 539,648 |
| e6-pickup | 3 | 31,079 | 7,149 | 3,460 | 314,965 |
| e6-baseline-v4 | 2 | 78,111 | 13,668 | 9,319 | 552,064 |
| e6-pickup-v4 | 2 | 7,687 | 2,576 | 1,426 | 58,112 |

要点：pickup 相对重发现基线 cacheRead −63%（flash）/ −89%（v4pro）——拾取的经济价值随模型强度放大；e5 中 authority 臂略贵（provenance 不买信任，见 H1 定案）。完整口径见 docs/13。

## 文件

- 结果：`runtime-exp/results/`（`e5-*-r*.{metrics,events,result,stdout}`、`e6-{baseline,none,pickup}-r*.`、`e6-shared-r*.json`、`summary56.md/.json`）
- 聚合：`runtime-exp/aggregate56.mjs`
- 插件：`runtime-exp/plugin/dsh-runtime-experiment/lib/index.js`（e5/e6 场景、persistence、三臂）
