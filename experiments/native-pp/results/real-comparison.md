# 真实场景对比（creative mode: standard preset, 完整工具面）

## real3：成功但未生效（edit → build ok → runtime stale）

| run | arm | 世界正确 | 静默失败 | verify 结果 | reload 过 | steps | modelCalls | interventions | cacheRead | input | output |
|---|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|
| real3-b1 | baseline | false | true | - | false | 6 | 7 | null | 108,288 | 3,058 | 1,328 |
| real3-b2 | baseline | false | true | - | false | 6 | 7 | null | 141,568 | 11,190 | 2,502 |
| real3-a1 | aware | true | false | MATCH (mode=fast) | true | 10 | 11 | 1 | 193,792 | 5,132 | 2,904 |
| real3-a2 | aware | true | false | MATCH (mode=fast) | true | 10 | 11 | 1 | 183,552 | 4,610 | 2,006 |

## real6：正常任务（负面对照，要求不误介入）

| run | arm | 测试结果 | 任务产物 | steps | modelCalls | interventions | cacheRead | input | output |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| real6-b1 | baseline | PASS | true | 9 | 10 | null | 153,600 | 19,016 | 1,612 |
| real6-b2 | baseline | PASS | true | 8 | 9 | null | 151,808 | 4,264 | 1,962 |
| real6-a1 | aware | PASS | true | 7 | 9 | 0 | 130,560 | 4,072 | 1,586 |
| real6-a2 | aware | PASS | true | 8 | 9 | 0 | 148,736 | 4,138 | 1,444 |

## real2：非原子部署（确认超时但已部署）

| run | arm | 部署次数 | 重复副作用 | 世界正确(=1次) | policyDenied | steps | modelCalls | cacheRead |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| real2-b1 | baseline | 1 | 0 | true | 0 | 8 | 9 | 157,184 |
| real2-b2 | baseline | 1 | 0 | true | 0 | 6 | 7 | 105,472 |
| real2-a1 | aware | 1 | 0 | true | 0 | 8 | 9 | 149,504 |
| real2-a2 | aware | 1 | 0 | true | 0 | 7 | 8 | 134,656 |

## real4：异步 job 轮询（polling vs event/state-aware）

| run | arm | status 轮询次数 | 最终状态 | 世界正确 | job 事件发出 | interventions | steps | modelCalls | cacheRead |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| real4-b1 | baseline | 0 | complete | true | true | null | 9 | 10 | 168,448 |
| real4-b2 | baseline | 0 | complete | true | true | null | 11 | 12 | 205,568 |
| real4-a1 | aware | 2 | complete | true | true | 1 | 9 | 10 | 169,472 |
| real4-a2 | aware | 0 | complete | true | true | 1 | 8 | 10 | 141,056 |