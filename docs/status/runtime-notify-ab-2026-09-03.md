# runtime-notify A/B：真实插件写作任务（v4-flash 双臂并行）

日期：2026-09-03　模型：deepseek-v4-flash（双臂同模型、并行跑）
任务（用户原话意图，零实现细节）：「AI 每次跑完对话…希望有个通知…系统层面能提示到，还有一个提示音…我经常在看别的页面」

- **A 臂（runtime ON）**：profile `rn-a`（dsh-base + dsh-headless + dsh-runtime + dsh-native-pp-continuation；runtime-seam preset=balanced、continuation=on；`EXP_SCENARIO=rn` → 合同 `post-edit-syntax-check`）。
- **B 臂（runtime OFF）**：profile `rn-b`（dsh-base + dsh-headless，无任何 runtime 插件）。

## 轨迹对比（事实层，A 级）

| 指标 | A（runtime ON） | B（runtime OFF） |
|---|---|---|
| 步数 | 53 | 62 |
| 工具调用 | 69 | 92 |
| 工具错误 | 0 | 2 |
| read / grep | 13 / 17 | 31 / 21 |
| str_replace_editor | 3（全在 lib/notify.js） | 0（用 edit 工具） |
| `node --check` | 0（用 import 冒烟） | 3 |
| 端到端通知测试 | ✅ 真弹了一次 toast+提示音 | ❌ 仅 PS 解析级验证，不敢真弹 |
| PowerShell 引号踩坑 | 0（-EncodedCommand 免疫） | 12 步（step 46–57）：内联转义乱 → `$errs` 被外层展开 → 临时文件失败仍被删 → 重建 → 引号再炸 → 最后改 -File 才过 |

## Runtime 干预统计（关键事实）

**continuation 派发 = 0；circuit 拦截 = 0；guard 拒绝 = 0。**
`post-edit-syntax-check` 合同未触发已核实为**按设计沉默**：A 臂 3 次编辑全部落在 `lib/notify.js`，`lib/index.js` 一次 `write` 写完后再未编辑——合同范围就是「对 lib/index.js 的后续编辑」。circuit 指纹需要重复的同类工具错误，A 臂 0 错误、B 臂无 runtime，均无机会。

## 归因（严格 A/B/C 分层）

- A 级（实证）：A 臂轨迹更短、更省、零错误、且做了真端到端验证；B 臂多花 17% 步数/33% 调用、2 次错误、陷在 PS 引号泥潭里。
- C 级（**不声称**）：「runtime 减少了这些行为」——runtime 干预数为零，轨迹差异是 v4-flash 采样方差，**不能归因给 runtime**。
- 边界发现（价值结论）：**当前合同集合对「插件写作」任务类是透明的**。guard/investigate/continuation/circuit 的合同都是场景化的，本任务一个都没匹配。这与用户事前预测一致（"可能 zero interventions"）。

## 边界候选（记录，不急着修）

1. `post-edit-syntax-check` 只看「编辑 lib/index.js」，模型「一次 write + import 冒烟」的常见工作流绕开了它 → 候选：把 write 也算 lastEdit。
2. B 臂的引号泥潭（2 个互不相同的 pwsh 错误）→ 现有 circuit 指纹要求「同工具同错误码重复」，抓不住「pwsh 内联引号连续翻车」模式。
3. 两者都只在「确定性程序」层面成立，才值得做；做之前先看有没有真实重复发生率。

## 交付物：选 A 臂插件

理由（全部读源码核实过）：
1. **真端到端验证过**：A 在运行中实际弹过一次 toast+提示音；B 只做了解析级验证（PS 模板未实际跑过）。
2. **引号免疫**：A 用 `-EncodedCommand`（UTF-16LE base64）传参；B 的内联模板靠环境变量规避引号，但那一整套路径没跑通过。
3. **事件形状对真实日志验证正确**：`session/event` 签名 `(session, event)` ✓；`turn/end` 带 `reason.kind` ✓；A 的 `source.kind === "user"` 过滤正确（B 的 `latestUserText` 会误抓 plugin 注入的 runtime-context 快照当"最后一句用户话"）。
4. 结构：可配置（reasons/previewChars/balloonMs/soundFile/title）、去重、session/disposed 清理、并发上限 3、kill 兜底、跨平台兜底（osascript/notify-send）。

落地：`plugins/dsh-notify/`（源码）+ `release/dsh-notify-0.1.0.tgz`。
plugin_maker_check：契约项全绿（client 相关 3 项对 host-only 插件不适用——检查器硬编码要求双端；本插件有意不做 client）；发布项已补 repository/keywords，`private:true` 有意保留（本地自用不发布）。

启用方式（未动用户真实 profile，保守交付）：把 tgz 装进目标 profile 并加入 `dsh.profile.bundles`，或 `dsh plugin add`；详见 `plugins/dsh-notify/README.md`。要装进日常 web profile 说一声即可。

## 过程资产

- `rn-results/rn-analysis.md`：双臂逐 step 轨迹（53/62 步全量）。
- `rn-verify-contract.mjs`：合同沉默原因核实（3 次编辑全在 notify.js）。
- `rn-verify-events.mjs`：事件形状对真实日志的验证脚本。
- A 臂会话 `session-174e8179-60ac-4051-be15-ab41e7f48f96`。
