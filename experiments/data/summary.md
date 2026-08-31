# Runtime 行为实验聚合结果

生成时间：2026-08-31T12:58:38.008Z

## s1

| 指标 | A react-discovery | B change-only | C change-persistent |
|---|---|---|---|
| steps 均值 | 5 | 5 | 4.5 |
| 工具调用数均值 | 4.5 | 4.5 | 4 |
| exp_probe 探测数均值 | 1.5 | 1.5 | 1 |
| 工具错误数均值 | 0 | 0 | 0 |
| 模型调用数均值 | 5 | 5.5 | 5 |
| 请求 payload 字符均值 | 80111.5 | 106798.5 | 95356.5 |
| 注入消息数均值 | 0 | 2 | 1.5 |
| 注入 payload 字符均值 | 0 | 3646 | 3456 |
| 首次探测所在 step 均值 | 1 | 1 | 1 |
| 重复探测均值 | 0 | 0 | 0 |
| runtime 旁路失败数 | 0 | 0 | 0 |
| agent 错误数 | 0 | 0 | 0 |

| run | 结果一致性 | 备注 | 最终报告 |
|---|---|---|---|
| s1-arm-a-r1 | ✓ | paintCalls=1 successful=1 result=painted | ﻿Report: `exp_tmp_paint` was available 鈥?I verified it via the authoritative `exp_probe` query `tools` (which listed it as currently available), called it once, and it returned `{"painted": true}`, so |
| s1-arm-a-r2 | ✓ | paintCalls=1 successful=1 result=painted | ﻿The tool `exp_tmp_paint` was available: I verified it via `exp_probe` with query `tools` (it appeared in the available tool list), called it once (it returned `{"painted":true}`), and wrote the word  |
| s1-arm-b-r1 | ✓ | paintCalls=1 successful=1 result=painted | ﻿Report: The tool `exp_tmp_paint` was available at the time of the check 鈥?I confirmed it via `exp_probe` (query `tools`), which listed it in the current tool surface, then called it once (it returned |
| s1-arm-b-r2 | ✗ | paintCalls=1 successful=1 result=true | ﻿**Report: exp_tmp_paint was available** 鈥?I verified it by querying `exp_probe` with `tools`, which listed `exp_tmp_paint` in the current tool surface; I then called it once (it returned `{"painted": |
| s1-arm-c-r1 | ✓ | paintCalls=1 successful=1 result=painted | **Report:** The tool `exp_tmp_paint` was available 鈥?I determined this by querying `exp_probe` with query `tools` (which returned `exp_tmp_paint` in the authoritative tool list), then successfully cal |
| s1-arm-c-r2 | ✓ | paintCalls=1 successful=1 result=painted | ﻿exp_tmp_paint was available: exp_probe returned it in the tool list (`["exp_probe","exp_tmp_paint","pwsh","str_replace_editor"]`), I called it once (result `{"painted": true}`), and wrote the exact w |

## s2

| 指标 | A react-discovery | B change-only | C change-persistent |
|---|---|---|---|
| steps 均值 | 3.5 | 8 | 8 |
| 工具调用数均值 | 2.5 | 7 | 7 |
| exp_probe 探测数均值 | 1 | 3 | 3 |
| 工具错误数均值 | 0 | 0 | 0 |
| 模型调用数均值 | 3.5 | 8 | 8 |
| 请求 payload 字符均值 | 49084.5 | 160443 | 164260.5 |
| 注入消息数均值 | 0 | 3 | 3 |
| 注入 payload 字符均值 | 0 | 2869 | 3844 |
| 首次探测所在 step 均值 | 1 | 1 | 1 |
| 重复探测均值 | 0 | 2 | 2 |
| runtime 旁路失败数 | 0 | 0 | 0 |
| agent 错误数 | 0 | 0 | 0 |

| run | 结果一致性 | 备注 | 最终报告 |
|---|---|---|---|
| s2-arm-a-r1 | ✗ | result file missing; probeStates=declared lastKnown=declared written=missing | ﻿State: **declared** 鈥?determined by querying `plugins.exp_probe_plugin.state` via the exp_probe tool, which returned `{"status":"known","value":"declared"}`; the exact word was written to `s2-arm-a1. |
| s2-arm-a-r2 | ✓ | probeStates=declared lastKnown=declared written=declared | ﻿State: **declared** 鈥?determined by querying the authoritative runtime probe `exp_probe` with `plugins.exp_probe_plugin.state`, which returned `status: "known", value: "declared"`; the exact word was |
| s2-arm-b-r1 | ✓ | probeStates=declared>mounted>ready lastKnown=ready written=ready | ﻿State: **ready** 鈥?determined by querying `exp_probe` with `plugins.exp_probe_plugin.state`, which returned status `known` with value `ready` (also confirmed by the runtime-observation delta transiti |
| s2-arm-b-r2 | ✓ | probeStates=declared>mounted>ready lastKnown=ready written=ready | ﻿The current lifecycle state of `exp_probe_plugin` is **ready**, determined by querying `exp_probe` with `plugins.exp_probe_plugin.state` (status: known, value: "ready"); the state had transitioned de |
| s2-arm-c-r1 | ✓ | probeStates=declared>mounted>ready lastKnown=ready written=ready | ﻿State: **ready** 鈥?determined by probing the authoritative runtime fact via `exp_probe` with query `plugins.exp_probe_plugin.state`, which returned `{"status":"known","value":"ready"}`. The state had |
| s2-arm-c-r2 | ✓ | probeStates=declared>mounted>ready lastKnown=ready written=ready | ﻿State: **ready** 鈥?determined by querying the exp_probe tool (`plugins.exp_probe_plugin.state`), which returned `{"status":"known","value":"ready"}`; the state had just transitioned declared 鈫?mounte |

## s3

| 指标 | A react-discovery | B change-only | C change-persistent |
|---|---|---|---|
| steps 均值 | 4.5 | 3 | 3 |
| 工具调用数均值 | 4.5 | 3 | 2.5 |
| exp_probe 探测数均值 | 3 | 2 | 1.5 |
| 工具错误数均值 | 0 | 0 | 0 |
| 模型调用数均值 | 4.5 | 3 | 3 |
| 请求 payload 字符均值 | 68949.5 | 50367 | 52465.5 |
| 注入消息数均值 | 0 | 1 | 1 |
| 注入 payload 字符均值 | 0 | 1993 | 2768 |
| 首次探测所在 step 均值 | 1 | 1 | 1 |
| 重复探测均值 | 0 | 0 | 0 |
| runtime 旁路失败数 | 0 | 0 | 0 |
| agent 错误数 | 0 | 0 | 0 |

| run | 结果一致性 | 备注 | 最终报告 |
|---|---|---|---|
| s3-arm-a-r1 | ✓ | result=unknown | ﻿Result written: `unknown` (the authoritative `dependencies.current_host` probe returned unknown 鈥?the host did not expose the dependency topology fact). |
| s3-arm-a-r2 | ✓ | result=unknown | ﻿Wrote `unknown` to s3-arm-a-r2.result.txt: the authoritative `dependencies.current_host` probe reported the fact is not exposed, and no other authoritative source (env vars, plugin state `declared`)  |
| s3-arm-b-r1 | ✓ | result=unknown | ﻿Result: dependency topology is unknown (authoritative probe `dependencies.current_host` returned `unknown` / `host_did_not_expose_fact`); wrote `unknown` to s3-arm-b-r1.result.txt. |
| s3-arm-b-r2 | ✓ | result=unknown | ﻿Result written to s3-arm-b-r2.result.txt: **unknown** (authoritative probe reports `dependencies.current_host` as unknown, reason `host_did_not_expose_fact`). |
| s3-arm-c-r1 | ✓ | result=unknown | ﻿The authoritative probe for `dependencies.current_host` returned status `unknown` (reason: `host_did_not_expose_fact`); wrote `unknown` to s3-arm-c-r1.result.txt. |
| s3-arm-c-r2 | ✓ | result=unknown | ﻿Result: unknown 鈥?the authoritative probe `exp_probe dependencies.current_host` returned status `unknown` (reason: `host_did_not_expose_fact`), and the probe plugin is only `declared`, so no dependen |
