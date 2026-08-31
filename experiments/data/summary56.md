# E5 (H1) + E6 (Pickup) 结果

生成时间：2026-08-31T14:11:24.910Z

## E5：H1（provenance 是否减少拒绝后的复核）

| 指标 | guard-plain | guard-authority |
|---|---|---|---|
| 拒绝数均值 | 1 | 1 |
| 拒绝后复核探测均值 | 0 | 0.67 |
| 总探测均值 | 1.33 | 1.33 |
| steps 均值 | 3.67 | 4 |
| payload 字符均值 | 55380.33 | 74931.67 |

| run | 结果文件 |
|---|---|
| e5-gplain-r1 | exp_run rejected: plugins.exp_runner.state = "disabled" (host fact contradicts session snapshot of "ready"); action not valid from this host |
| e5-gplain-r2 | Error: [action-rejected] exp_run fact: plugins.exp_runner.state = "disabled" predicate: exp_run requires state == ready temporal: no next: t |
| e5-gplain-r3 | Error: [action-rejected] exp_run fact: plugins.exp_runner.state = "disabled" predicate: exp_run requires state == ready temporal: no next: t |
| e5-gauth-r1 | Error: [action-rejected] exp_run fact: plugins.exp_runner.state = "disabled" status: known | authority: host | revision: 2 | fingerprint: 27 |
| e5-gauth-r2 | Error: [action-rejected] exp_run fact: plugins.exp_runner.state = "disabled" status: known | authority: host | revision: 2 | fingerprint: 27 |
| e5-gauth-r3 | Error: [action-rejected] exp_run fact: plugins.exp_runner.state = "disabled" status: known | authority: host | revision: 2 | fingerprint: 27 |

**H1 判定**：plain 复核=0（拒绝 1 次），authority 复核=0.67（拒绝 1 次）。
→ authority 臂未减少复核，H1 在本条件下未获支持。

## E6：跨会话拾取（三臂水位语义）

| 指标 | baseline (no persist) | persist + silent (L2) | persist + inject (ceiling) |
|---|---|---|---|---|
| 探测数均值 | 7 | 5.33 | 5 |
| steps 均值 | 12 | 13 | 10 |
| 模型调用数均值 | 12 | 13.33 | 10.33 |
| payload 字符均值 | 1513193.33 | 1242519.33 | 732427 |
| 注入消息均值 | 0 | 0 | 1 |
| runtime 失败 | 0 | 0 | 0 |

| run | 结果文件 |
|---|---|
| e6-baseline-r1 | plugins.exp_plugin_x.state=ready: exp_plugin_x is ready on this host (known via host-runtime, having progressed declared -> mounted -> ready |
| e6-baseline-r2 | plugins.exp_plugin_x.state=ready: exp_plugin_x is ready on this host (known via host-runtime, revision 3; state progressed declared -> mount |
| e6-baseline-r3 | plugins.exp_plugin_x.state=ready: exp_plugin_x is ready on this host (known via host-runtime, having progressed declared -> mounted -> ready |
| e6-none-r1 | plugins.exp_plugin_x.state=ready: exp_plugin_x is ready on this host (probe status known, authority host-runtime). dependencies.current_host |
| e6-none-r2 | plugins.exp_plugin_x.state=ready: exp_plugin_x is ready on this host (probe status known, authority host-runtime). dependencies.current_host |
| e6-none-r3 | plugins.exp_plugin_x.state=ready: exp_plugin_x is ready on this host (probe status known, authority host-runtime). dependencies.current_host |
| e6-pickup-r1 | plugins.exp_plugin_x.state: ready (status known, authority host-runtime, revision 3, fingerprint d7b5efcf4210ba84) dependencies.current_host |
| e6-pickup-r2 | plugins.exp_plugin_x.state: ready (status known, authority host-runtime, revision 3, fingerprint d7b5efcf4210ba84) dependencies.current_host |
| e6-pickup-r3 | plugins.exp_plugin_x state: ready (known, host-runtime, revision 3). dependencies.current_host: unknown — host did not expose the fact, so d |

判定：none（L2 沉默）与 pickup（注入）的成本对比回答『水位是否该默认归零』；baseline 是重发现基线。
