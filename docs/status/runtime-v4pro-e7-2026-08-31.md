# v4pro 复测 + E7/E7b 创造性场景实验

日期：**2026-08-31**（隔离 DSH、`minimal` preset、`deepseek-v4-pro`、N=2、全部 exit=0、零 runtime 失败）

## 一、v4pro 复测（只跑模型依赖层）

| 实验 | flash | v4pro | 判定 |
|---|---|---|---|
| E2 承诺（拒绝后复核） | gauth 3 vs delta 1.67 | gauth 3.5 vs delta 2.5 | 承诺在两个模型上都有效 |
| E4b 熔断（none 臂燃烧） | 3.33 次 / 287k | 2.5 次 / 117k | **约束任务里 v4pro 更自律** |
| E5 H1（provenance） | plain 0 vs auth 0.67 | plain 0.5 vs auth 0.5 | **两个模型上都不买信任，H1 定案** |
| E6 拾取（baseline vs pickup） | 探测 7 vs 5 | **探测 10.5 vs 3；payload 1.18M vs 133k** | **强模型重收敛更凶，拾取价值随模型强度放大** |

## 二、E7 轨迹结构阅读（开放式创造，flash 版结论在 v4pro 上复现）

- 纯 retry 可精确切掉：开断后 flaky 尝试 none=1.5 vs circuitdelta=1（且 circuitdelta 的尝试被守卫挡在 body 外，delta 后归零）；
- **轨迹自己暴露了第二类循环**：none 臂对被 deny 的 `read`/`str_replace_editor` 连试 5 次——"工具被拒仍重复调用"与死路重试同构，同一个指纹机制可切；
- 创作自由未被限制：circuitdelta 臂的 pwsh/编辑器创作与 none 臂同构，交付物不受影响；
- 定性证据：none 臂伪造"指纹与宿主一致"的声明（不可重算，纯编造）；circuitdelta 臂从 delta 拿到真实指纹并明言"这是模型无法伪造的 provenance"。

## 三、E7b（重新设计的创造任务：交付物 + 有限路径 + 无剧透无反重试）

任务：交付可运行 pwsh 脚本 + 产出 artifact（必须含 exp_flaky 的返回值或显式错误处理说明 + `creative: <run>` 行）。提示词审计去掉两个污染源（"不要反复重试"指令、失败路径剧透）。

| 臂 | 交付物 | flaky 尝试 | 开断后 | steps | payload |
|---|---|---|---|---|---|
| none-b1 | ✓ | 2 | 0 | 18 | 2.36M |
| none-b2 | ✓ | 3 | 1 | 7 | 149k |
| circuitdelta-b1 | ✓ | 2 | 0 | 7 | 234k |
| circuitdelta-b2 | ✓ | 2 | 0 | 9 | 625k |

结论：

1. **4/4 交付物可运行**——circuit 没有限制创造自由；
2. circuitdelta 两臂开断后 0 尝试（none-b2 有 1 次）；
3. **任务形态自己会调重试**：有明确交付物 + 2-3 路径上限时，模型自然停在 2 次尝试（45-92 秒/run）；开放式无交付物时（E7 老版）单 run 230-335 秒、3.3M 字符。**"RunTime 切多少"取决于任务形态留给重试的空间**——越开放，切的价值越大；
4. 对用户核心问题的回答：**当 Harness 明确知道某路径无进展时，Runtime 能切掉它（开断后 0 执行），且交付物 4/4 证明创造自由未被限制**。切的价值在开放式任务里最大（E7），在有交付物的任务里模型自限、circuit 主要起保险作用（none-b2 的那 1 次后开断尝试就是被保掉的）。

## 文件

- 结果：`runtime-exp/results/`（`e7-*-{v1,v2,b1,b2}.*`、`summary7.md`、verify-e7b.ps1）
- 驱动：`driver7/8/9.ps1`；聚合：`aggregate7.mjs`
