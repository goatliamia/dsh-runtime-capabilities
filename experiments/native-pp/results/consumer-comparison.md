# Consumer 实验对比（baseline vs progress-aware）

指标口径：retries=exp_* 工具重复调用数（world）；realExecutions=工具体真实执行次数；
duplicateSideEffects=exp_apply 世界副作用写入次数；cacheReadTokens=事后回溯真实 usage。

## loop

| run | retries | realExec | dupSideEffects | taskOk | toolErrors | policyDenied | steps | modelCalls | cacheRead | input | output | turn |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| loop-b1 | 5 | 6 | 0 | true | 6 | 0 | 13 | 14 | 97,280 | 2,308 | 3,136 | completed |
| loop-b2 | 5 | 6 | 0 | true | 6 | 0 | 9 | 11 | 64,000 | 1,506 | 2,264 | completed |
| loop-b3 | 5 | 6 | 0 | true | 6 | 0 | 9 | 11 | 83,968 | 3,782 | 3,226 | completed |
| loop-b4 | 5 | 6 | 0 | true | 6 | 0 | 8 | 9 | 59,904 | 2,276 | 3,108 | completed |
| loop-a1 | 2 | 2 | 0 | true | 3 | 1 | 7 | 8 | 47,104 | 1,772 | 3,504 | completed |
| loop-a2 | 2 | 2 | 0 | true | 3 | 1 | 9 | 10 | 71,936 | 1,622 | 5,300 | completed |
| loop-a3 | 2 | 2 | 0 | true | 3 | 1 | 6 | 7 | 47,872 | 1,774 | 5,542 | completed |
| loop-a4 | 2 | 2 | 0 | true | 3 | 1 | 8 | 9 | 57,088 | 1,484 | 3,172 | completed |

| 均值 | baseline 5 / aware 2 | baseline 6 / aware 2 | baseline 0 / aware 0 | all / all | baseline 6 / aware 3 | baseline 0 / aware 1 | baseline 10 / aware 8 | baseline 11 / aware 9 | baseline 76,288 / aware 56,000 | baseline 2,468 / aware 1,663 | baseline 2,934 / aware 4,380 | |

## nonatomic

| run | retries | realExec | dupSideEffects | taskOk | toolErrors | policyDenied | steps | modelCalls | cacheRead | input | output | turn |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| nonatomic-b1 | 3 | 4 | 4 | true | 4 | 0 | 9 | 10 | 58,112 | 7,302 | 2,282 | completed |
| nonatomic-b2 | 3 | 4 | 4 | true | 4 | 0 | 10 | 11 | 69,120 | 2,180 | 2,074 | completed |
| nonatomic-b3 | 3 | 4 | 4 | true | 4 | 0 | 11 | 13 | 133,888 | 7,812 | 3,230 | completed |
| nonatomic-b4 | 3 | 4 | 4 | true | 4 | 0 | 9 | 10 | 61,696 | 1,566 | 1,872 | completed |
| nonatomic-a1 | 1 | 1 | 1 | true | 2 | 1 | 6 | 7 | 45,824 | 1,198 | 4,826 | completed |
| nonatomic-a2 | 3 | 1 | 1 | true | 4 | 3 | 10 | 11 | 84,480 | 2,002 | 4,390 | completed |
| nonatomic-a3 | 1 | 1 | 1 | true | 3 | 1 | 7 | 9 | 64,512 | 1,426 | 9,820 | completed |
| nonatomic-a4 | 1 | 1 | 1 | true | 3 | 1 | 7 | 9 | 51,968 | 1,148 | 4,012 | completed |

| 均值 | baseline 3 / aware 2 | baseline 4 / aware 1 | baseline 4 / aware 1 | all / all | baseline 4 / aware 3 | baseline 0 / aware 2 | baseline 10 / aware 8 | baseline 11 / aware 9 | baseline 80,704 / aware 61,696 | baseline 4,715 / aware 1,444 | baseline 2,365 / aware 5,762 | |

## noop（success+stalled，record-only）

| run | arm | realExecutions | turn | policyDenied |
|---|---|---:|---:|---:|
| noop-b1 | baseline | 1 | completed | 0 |
| noop-a1 | aware | 1 | completed | 0 |

## pretend（success+claimed，investigate/reconcile）

| run | arm | pretendCalls | checkCalls | repairCalls | applied(世界正确) | silentError | interventions | steps | modelCalls | cacheRead |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pretend-b1 | baseline | 1 | 0 | 0 | false | true | - | 4 | 5 | 21,504 |
| pretend-b2 | baseline | 1 | 0 | 0 | false | true | - | 3 | 4 | 18,432 |
| pretend-a1 | aware | 1 | 1 | 1 | true | false | 1 | 5 | 6 | 31,488 |
| pretend-a2 | aware | 1 | 2 | 1 | true | false | 1 | 8 | 9 | 58,880 |

- 世界正确率（applied=true）：baseline 0/2，aware 2/2
- 静默错误（谎报成功且未修复）：baseline 2/2，aware 0/2
## ok 对照（success+progressed，aware 臂不介入）

- world: exp_reportCalls=1, taskArtifactExists=false
- policy interventions=0（预期 0）