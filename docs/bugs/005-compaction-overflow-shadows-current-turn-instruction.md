# Bug 005: context-overflow compaction shadows the current turn's admitted work message, then retries

日期：2026-09-02（晚）| 版本核实：0.1.1-rc.2（本机安装）与 0.1.2-alpha.5（npm 包）| 状态：**上游未修（两条线均复现于源码）**，本轮实验按「confounded sample」策略处理

## Problem

`context-overflow` 触发自动 compaction 时，`dsh-compaction-basic` 的 overflow 路径把 `retainTokens` 硬编码为 `0`。在 tool-loop 中，本轮已准入的 user 工作消息（schedule/goal/webhook 等一次性工作提示）只要不是 surface 的最后一个节点，就会被 shadow 进 compaction 范围，只保留最后一对 assistant/tool-call + tool/result。而 compaction 成功后 Harness 返回 `{ kind: 'retry' }`，让 Model 继续本轮——于是：

```text
本轮 user instruction
↓
tool call / tool result
↓
context overflow (provider 400)
↓
compaction (retainTokens=0)
↓
user instruction 被 shadow，只剩 checkpoint 摘要 + 最后一对 tool/result
↓
retry：Model 只能看到 checkpoint + 尾部 fragment
```

> **Harness 把当前 turn 的必要工作提示压掉了，却仍然把这个状态判断为「可以继续」。**

与 Runtime 实验线已有命题同构：*Tool success ≠ world effect* → *Compaction success ≠ turn continuation valid*。

## Root Cause（源码逐条核实）

版本：0.1.1-rc.2 安装树 `...\dsh\node_modules\@deepseek-ai\dsh-*`；0.1.2-alpha.5 为 npm pack 解包。行号为各自版本实际行号。

1. **overflow 路径硬编码 retainTokens=0**：`dsh-compaction-basic:compactIfNeeded`，`trigger === "context-overflow"` 分支直接 `selectCompactableRange(agent.session, measurement, 0)`。
   - rc.2：`dsh-compaction-basic/lib/index.js:873`
   - alpha.5：`dsh-compaction-basic/lib/index.js:875`（**alpha 未修**）
2. **保留范围只按「尾部 token 预算 + tool 配对平衡」计算**：`selectCompactableRange` 从尾部往回累加 token 直到 `accumulated >= retainTokens`（=0 时立即停在最后一个节点），再回退到 `toolPairingBalancedBefore` 的切点；返回 `{start: surfaceNodes[0], end: surfaceNodes[keepFromIdx-1]}`——即**头锚定、整段 shadow**，只留尾部配对。
   - `dsh-compaction-basic/lib/index.js:379-401`
   - 配对平衡定义：切点前不得有未应答 tool call（`dsh-compaction/lib/index.js:85-87`）
3. **没有任何机制保护本轮已准入的 user/message**：user 工作消息在 turn 开始时作为 surface node 头部位置进入，tool-loop 后必然远离尾部 → 被 shadow。
4. **成功后仍 retry**：`agent/request-error` 监听 `CONTEXT_WINDOW_EXCEEDED_CODE` → 执行 overflow compaction → 成功（或 surface 已推进）即 `return { kind: "retry" }`。
   - `dsh-compaction-basic/lib/index.js:802-827`
5. **指令并非完全消失，而是进 LLM 摘要 checkpoint**：shadow 范围被一条 `compaction/summary` + checkpoint user/message（`source.plugin = "compact"`）替换，摘要输入包含被 shadow 的对话前缀。因此**指令是否存活取决于摘要模型的保真度**——这是「不可靠代理」，不是保序保留。

## Correct Pattern（上游修复建议，用户指定方向）

1. overflow compaction 不得 shadow 当前 turn 已准入的 user message（范围选择必须把当前 turn 的 user/message 锚定在保留侧，或显式拒绝包含它的范围）；
2. 若无法保证这一点，**不要返回成功 retry**——保留原始 request error 失败（`return next()`），让上层按真实失败处理；
3. 修在 `@deepseek-ai/dsh-compaction-basic` 本体：不要给 schedule/goal/webhook 各加 consumer 层 workaround，也不要新增 config 开关。

## Regression

单元测试（上游补）：构造「turn 准入 user message → 多步 tool loop → overflow compaction」轨迹，断言 compaction 后的 surface 仍逐字包含该 turn 的 user/message；不满足时断言请求路径收到原始 overflow error 而非 retry。

## 对本实验线的影响与策略

- **本轮（docs/19 最小 continuation 实验）**：7 格均为短会话（小世界、约 5-8 步、上下文远低于 overflow 阈值），溢出 compaction 实际触发概率趋零；但**任何出现 compaction 记录的轨迹一律标记 harness-invalid / confounded sample，退出结论**。
- **落地动作**：验证管线加零成本事后闸门——decode-zstd 解码各格持久化日志后扫描 `compaction/start` / `compaction/summary` 记录，命中即在该格 verdict 上打 `confounded: compaction` 标记并从对比结论中剔除（循环内零计量，符合硬约束 8）。
- **上游现状**：0.1.2-alpha.5 与 0.1.1-rc.2 行为一致（均硬编码 0），需随 `agent/continue`（路线 B）提案一起向上游反馈。

## 未验证项（不编造）

- 未做真实 overflow 复现运行（需要把会话推到 provider 400 边界，成本高且本轮场景不会溢出）；
- 摘要模型对「指令保真」的实际表现未测量；
- `CONTEXT_WINDOW_EXCEEDED_CODE` 由 provider 失败码映射而来，具体映射路径未逐行核实。
