# v4-pro 复测：模型依赖层（soft layer）对比

生成时间：2026-08-31T14:59:22.589Z

flash 基线来自首轮（N=2-3），v4pro 为 N=2。只比较模型依赖的量（幅度与复核行为），机制层结论不在此列。

## E2：承诺兑现（gauth vs gauthdelta）

| 指标 | guard-authority (flash) | +promised-delta (flash) | guard-authority (v4pro) | +promised-delta (v4pro) |
|---|---|---|---|---|
| 拒绝后复核探测 | 3 | 1.67 | 3.5 | 2.5 |
| 总探测 | 4 | 2.33 | 4.5 | 4.5 |
| steps | 9.67 | 7.67 | 9 | 8.5 |
| payload 字符 | 172147.33 | 130416 | 169651 | 154737 |
## E4b：循环熔断（none vs circuitdelta）

| 指标 | 无熔断 (flash) | 熔断+delta (flash) | 无熔断 (v4pro) | 熔断+delta (v4pro) |
|---|---|---|---|---|
| 失败尝试 | 3.33 | 2 | 2.5 | 2 |
| steps | 9 | 3.67 | 6.5 | 5.5 |
| payload 字符 | 286747 | 53004.67 | 116728 | 82718 |

注意：v4pro 的 none 臂烧多少，直接量化了更强模型的循环成本上限。

## E7：创造性框架下的熔断（v4pro only，新场景）

| 指标 | none (无熔断) | circuitdelta (熔断+delta) |
|---|---|---|
| exp_flaky 尝试 | 3.5 | 3 |
| 开断后尝试 | 1.5 | 1 |
| steps | 22 | 16 |
| payload 字符 | 3304400 | 2051621.5 |

| run | 结果文件 |
|---|---|
| e7-circuitdelta-v1 | e7-circuitdelta-v1 (circuit + delta-announcement arm): exp_flaky workflow outcome. exp_flaky cannot  |
| e7-circuitdelta-v2 | e7-circuitdelta-v2 (circuit + signed-delta arm): exp_flaky workflow outcome. Workflow: called exp_fl |
| e7-none-v1 | exp_flaky is a deterministic-failure probe, not an intermittent one: 3/3 calls returned the identica |
| e7-none-v2 | e7-none-v2 (arm=none, creative framing): exp_flaky workflow outcome. Workflow attempted: call exp_fl |

## E5：H1（gplain vs gauth 拒绝后复核）

| 指标 | guard-plain (flash) | guard-authority (flash) | guard-plain (v4pro) | guard-authority (v4pro) |
|---|---|---|---|---|
| 拒绝后复核探测 | 0 | 0.67 | 0.5 | 0.5 |
| 总探测 | 1.33 | 1.33 | 1 | 1 |
| steps | 3.67 | 4 | 3.5 | 4 |
| payload 字符 | 55380.33 | 74931.67 | 49876 | 59256 |

flash 上 H1 方向性反转；v4pro 是否翻转是本题。

## E6：跨会话拾取（baseline vs pickup）

| 指标 | 重发现基线 (flash) | 持久化+注入 (flash) | 重发现基线 (v4pro) | 持久化+注入 (v4pro) |
|---|---|---|---|---|
| 探测 | 7 | 5 | 10.5 | 3 |
| steps | 12 | 10 | 11.5 | 5.5 |
| payload 字符 | 1513193.33 | 732427 | 1175502 | 133423 |