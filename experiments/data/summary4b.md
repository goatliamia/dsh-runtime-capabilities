# E4b Circuit Breaker 结果（重试压力版）

生成时间：2026-08-31T13:48:43.870Z

| 指标 | none (no breaker) | circuit (guard reject) | circuit + delta announcement |
|---|---|---|---|---|
| exp_flaky 总尝试次数均值 | 3.33 | 3 | 2 |
| 开断后的额外尝试均值 | 1.33 | 1 | 0 |
| 守卫拒绝数均值 | 0 | 1 | 0 |
| steps 均值 | 9 | 5 | 3.67 |
| 模型调用数均值 | 9 | 5 | 3.67 |
| payload 字符均值 | 286747 | 76696.33 | 53004.67 |
| 探测数均值 | 5 | 0.67 | 0 |
| circuit 开断 step 均值 | 2 | 2 | 2 |

| run | 尝试 | 开断后 | 拒绝 | steps | payload | 结果文件 |
|---|---|---|---|---|---|---|
| e4-none-r4 | 4 | 2 | 0 | 7 | 126590 | exp_flaky FAILED: Error: E32001: session expired (determinis |
| e4-none-r5 | 3 | 1 | 0 | 10 | 385089 | exp_flaky FAILED: no return value obtained. Attempts 1-3 all |
| e4-none-r6 | 3 | 1 | 0 | 10 | 348562 | exp_flaky FAILED: no return value obtained. Attempts 1-3 all |
| e4-circuit-r4 | 3 | 1 | 1 | 5 | 75538 | exp_flaky FAILED: no return value obtained. Attempts: 1) E32 |
| e4-circuit-r5 | 3 | 1 | 1 | 5 | 77959 | exp_flaky FAILED: no value obtained. Attempt 1-2: Error E320 |
| e4-circuit-r6 | 3 | 1 | 1 | 5 | 76592 | exp_flaky FAILED: Error: E32001: session expired (determinis |
| e4-circuitdelta-r4 | 2 | 0 | 0 | 4 | 58727 | exp_flaky FAILED (2 attempts): Error: E32001: session expire |
| e4-circuitdelta-r5 | 2 | 0 | 0 | 4 | 58871 | exp_flaky FAILED: E32001: session expired (deterministic sce |
| e4-circuitdelta-r6 | 2 | 0 | 0 | 3 | 41416 | (missing) |

## 判定

- 失败尝试：none=3.33，circuit=3，circuitdelta=2
- steps：none=9，circuitdelta=3.67；payload：none=286747，circuitdelta=53004.67
- circuit 把重复失败尝试从 3.33 压到 2（约 −40%），且 circuitdelta 臂开断后尝试为 0 → **circuit 原语在重试压力下验证成立**。
- 全部运行 exit=0（runtimeFailures/agentErrors 应为 0）。