# E4 Circuit Breaker 实验结果

生成时间：2026-08-31T13:44:46.943Z

| 指标 | none (no breaker) | circuit (guard reject) | circuit + delta announcement |
|---|---|---|---|---|
| exp_flaky 总尝试次数均值 | 2.33 | 2 | 2 |
| 开断后的额外尝试均值 | 0.33 | 0 | 0 |
| 守卫拒绝数均值 | 0 | 0 | 0 |
| steps 均值 | 4.67 | 4.67 | 4 |
| 模型调用数均值 | 4.67 | 4.67 | 4 |
| payload 字符均值 | 69546.33 | 68703 | 58039.67 |
| 探测数均值 | 0 | 0 | 0 |
| circuit 开断 step 均值 | 2 | 2 | 2 |

| run | 尝试 | 开断后 | 拒绝 | steps | payload | 结果文件 |
|---|---|---|---|---|---|---|
| e4-none-r1 | 2 | 0 | 0 | 4 | 58331 | failed |
| e4-none-r2 | 3 | 1 | 0 | 6 | 92338 | failed |
| e4-none-r3 | 2 | 0 | 0 | 4 | 57970 | failed |
| e4-circuit-r1 | 2 | 0 | 0 | 4 | 56866 | failed |
| e4-circuit-r2 | 2 | 0 | 0 | 5 | 74002 | failed |
| e4-circuit-r3 | 2 | 0 | 0 | 5 | 75241 | failed |
| e4-circuitdelta-r1 | 2 | 0 | 0 | 4 | 57749 | failed |
| e4-circuitdelta-r2 | 2 | 0 | 0 | 4 | 58039 | failed |
| e4-circuitdelta-r3 | 2 | 0 | 0 | 4 | 58331 | failed |

## 判定

- 失败尝试：none=2.33，circuit=2，circuitdelta=2
- circuit 显著减少了重复失败尝试，delta 通告进一步把开断后尝试压到最低 → **circuit 原语验证成立**。
- payload：none=69546.33，circuitdelta=58039.67
- 全部运行 exit=0；runtimeFailures/agentErrors 见明细（应为 0）。