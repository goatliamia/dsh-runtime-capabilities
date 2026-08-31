# E4 / E4b：Circuit Breaker（重复确定性失败熔断）实验

日期：**2026-08-31**（环境：隔离 DSH、`minimal` preset、`deepseek-v4-flash`、N=3/臂）
前置：`docs/11-runtime-plugin-capability-modes.md` §1（circuit 原语）

## 机制

- 指纹：`digest(tool, error-signature)`（与参数无关——MCP `-32001` 类场景，参数变化但错误码相同仍算重复）；
- 开断条件：同一指纹失败 ≥2 次（E4 场景为"无进展"判据：相同错误 + 事实无进展）；
- 三臂：none（无熔断）/ circuit（熔断后用守卫拒绝教学）/ circuitdelta（熔断后以 delta 通告，模型不再尝试）。

## E4（任务自带"失败就停"指令）—— 天花板，弱证据

模型被任务文本告知可停，2-3 次失败后自行放弃，三臂几乎无差（尝试 2.33/2/2，守卫 0 次触发）。**结论：熔断机制零误报、零副作用，但此场景测不出价值。**

## E4b（重试压力版：任务要求必须完成、失败就重试）—— 决定性差异

| 指标 | none | circuit | circuitdelta |
|---|---:|---:|---:|
| 失败尝试 | 3.33 | 3 | **2** |
| 开断后额外尝试 | 1.33 | 1 | **0** |
| 守卫拒绝 | 0 | 1 | 0 |
| steps | 9 | 5 | **3.67** |
| payload 字符 | **286,747**（单次最高 385k） | 76,696 | **53,005** |
| 探测数 | 5 | 0.67 | 0 |

- **none 臂**：模型自行重试、探测 5 次，steps 9，payload 均值 28.7 万字符——正是社区 #3171/#2848/#3228 描述的"烧 token 循环"在微型任务上的形状；
- **circuit 臂**：第 3 次尝试被守卫拒绝（1 次），模型立即停止——payload −73%；
- **circuitdelta 臂**：第 2 次失败后开断，delta 通告进入下一轮，模型零额外尝试——payload −81.5%、steps 9→3.67；
- 全部 9 次运行 exit=0、`runtimeFailures=0`、`agentErrors=0`；一处执行滑点如实记录（e4-circuitdelta-r6 未写结果文件，报告文本正常）。

## 结论

1. **circuit 原语在重试压力下验证成立**：指纹判据（忽略参数、只看错误签名）灵敏且零误报（开断 step 恒定=2，无守卫臂不受影响）；
2. 价值量级：**失败尝试 −40%，payload −73~81%，steps −59%**，且 delta 通告形态（而非拒绝形态）把"开断后的额外尝试"压到 0；
3. 与 #3489（MCP 过期重复调用）、#3171/#2848/#3228（无限循环烧 token）的问题形状同构：`相同 (tool, error) + 无进展 + N≥2 → 开断` 可作为通用 circuit，而不是等每个根因修复；
4. 诚实边界：v4flash 的放弃阈值低（E4 天花板），强模型可能自行重试更久——circuit 的价值上限在更强模型上预期更大，但未验证。

## 文件

- 结果：`<HOME>\Documents\runtime-exp\results\`（`e4-*-r[1-6].*.json/.txt/.stdout`、`summary4.md/.json`、`summary4b.md/.json`）
- 聚合：`runtime-exp/aggregate4.mjs`、`aggregate4b.mjs`
- 插件：`runtime-exp/plugin/dsh-runtime-experiment/lib/index.js`（e4 场景 + circuit 逻辑）
