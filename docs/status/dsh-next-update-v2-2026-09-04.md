# DSH 下一更新（v2 系）对我们的影响与落地验收清单（2026-09-04 定稿）

- 状态：`awaiting-release` —— 本文件是"发布那一刻照单执行"的验收清单，避免重新调研
- 触发信号：`npm view @deepseek-ai/dsh version` 出现 > `0.1.2-rc.1` 的版本号
- 关联：issue #1（Pre continuation 通道非法警示）、docs/bugs/005（帧结构不变量）

## 版本事实（2026-09-04 核对）

- 已装 = npm `latest` = `0.1.2-rc.1`（发布于 09-03；rc.1 官方 release note 见 upstream releases）
- rc.1 note 内含**实验性 Web Preview** 与**实验性 Inspector**（@imccyu）——**不在已装包里**（无对应包/无前端字符串痕迹），属"公告了未落地"
- 下一个更新（公告已出、未发布）：Session format v2、SessionHandle+会话锁（破坏性）、DeepSeek 续传分片修复（坏会话族）、通用文件上传/预览区、read_image 工具卡渲染等
- npm 元数据 09-04 有 modified 记录，但无新版本号

## 公告中对我们的影响分级

| 条目 | 影响 | 说明 |
|---|---|---|
| Session format v2：v0/v1 日志经不可变相邻 generation 迁移；Assistant 流按 attempt 聚合 | **最高** | 两个坏会话（9d9b289a：4 条坏事件 seq 643817/646714/653169/654711；8f5c713d：372908）是 v0/v1；docs/bugs/005 钉的帧格式可能是 v1 专属 |
| Session persistence API → SessionHandle + 同 session 至多一进程持有（破坏性） | 高 | 任何碰 session append 的插件代码要迁移；"会话打不开"多一个锁的原因 |
| 修复续传分片空值覆盖 callId/name → 无法重开的会话记录 | 中 | 与事故同族；上游在官方修"坏会话" |
| 已知性能回退：部分历史会话加载变慢（下下版修） | 低 | 大会话迁移后加载慢是预期的 |
| 实验性 Web Preview / Inspector | 低（本线） | 主要影响 visual-html 线（展示面迁移 + UI 检视层），其验收已交该线仓库，本线仅在发布后确认是否存在即可 |

## 发布后照单执行（每项都不要再查一遍来源，指路见"证据位置"）
| 其余（上传/渲染/UI/UX） | 低 | 无关 |

## 发布后照单执行（每项都不要再查一遍来源，指路见"证据位置"）

```text
① 读新 dsh-session types：SessionHandle / format v2 / generation 迁移
   → 证据位置：更新后的 <dsh 安装>/node_modules/@deepseek-ai/dsh-session*/lib/types
② 让 9d9b289a / 8f5c713d 走 v2 迁移，观察 4+1 条 runtime-continuation 坏事件：
   被保留 / 被改写 / 被拒绝？
③ v2 validator 是否已接受 source.kind="runtime-continuation"？
   → 旧版拒绝点：dsh-session lib/index.js:1182 与 lib/types/index.js:250
   → 若已接受：Line B 变零 patch（上游天然解决）
④ 有无"runtime-owned state"正式概念（非对话、可持久化、属于 Runtime 的状态分区）？
   → 有：第三条路成立（Session=Conversation+Runtime State），引擎改写检查结果为 runtime state
⑤ Web Preview / Inspector 落地评估归 visual-html 线（该线仓库有独立验收）；本线只需确认二者出现在发布版
⑥ （归 visual-html 线）
⑦ docs/bugs/005 帧不变量（首帧=一行 header、逐帧追加）在 v2 是否仍成立
⑧ 若仍需手术：Line B patch（validator 放行 runtime-continuation）目标行号按 v2 重定位；
   数据手术只用"帧边界保持法"（只重压含目标行的帧，bug 005），严禁整体重压
```

## 更新前不要做的事（防白做/防再炸）

- 不要在已装 rc.1 上手工修坏会话（v2 迁移是官方修复时刻；标本保留作回归夹具）
- 不要对已装 dsh 打 Line B patch（跑着的安装 = 自杀；patch 实验放 fork/副本）
- 不要整体重压 zstd（bug 005）
- 不要重新合并 Pre 引擎代码（issue #1 禁条），除非验收③④通过并改走合法形态

## 并行不受影响的工作

- 仓库 master（355acb5 基座）：纯插件维持线，不动
- vhtml / DSH UI Design Mode：属 visual-html 线，交接与验收在 `goatliamia/visual-html-agent-editor` 仓库，勿在本线处理
