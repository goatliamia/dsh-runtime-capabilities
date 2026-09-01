# DSH 原生 Event 语义对照表（实验 3 交付物）

> 生成方式：只读源码核实。所有断言带 `包:文件:行号` 引用；无法核实处标 `uncertain`，绝不编造。
> 源码根：`<DSH_INSTALL>`
> 一阶包：`...\node_modules\@deepseek-ai\dsh-*`（只读其 `lib/*.js` 与 `lib/types/*.js` / `*.d.ts`）

## 判定方法（判定方法）

1. **只读源码**：全程用 read/grep 读 checkout 源码，不修改 checkout 任何文件、不跑任何安装命令。
2. **file:line 引用**：每条语义/来源都落到 `包:文件:行号`。行号来自本次读取的实际文件。
3. **三类事件词表**：
   - **record（持久化 log 记录）**：`Session.append(type, data)` 的 `type` 词汇。全量 key 由 `dsh-session/lib/types/known-event-types.js:18`（`KNOWN_SESSION_EVENT_TYPES`，47 个）与 `dsh-session/lib/types/types.d.ts:223`（核心 `SessionEventMap`）+ 各插件 declaration-merge 声明。
   - **event（活事件）**：`ctx.emit` / `dispatch.emit` / `agentEvents(...).emit` / `ctx.events.dispatch("emit", ...)`。
   - **waterfall**：`ctx.waterfall` / `dispatch.waterfall` / `ctx.serial`（可拦截活事件）。
   - **service（服务 API）**：`ctx.sessions` / `ctx.agents` / `ctx.goals` 等 Cordis Service。
4. **权威签名目录**：`dsh-tool-cordis/lib/index.js:3720` 的 `EVENT_API` 数组给出全部 harness 事件的 `mode`（emit/waterfall/serial/parallel）与精确签名；本表活事件签名优先取自该目录 + 实际 emit 点。
5. **uncertain 标注规则**：凡 payload 字段未在 `.d.ts` 中完整读取、或 emit 点未定位到 `file:line`、或属于覆盖包之外/本 checkout 无对应包的，一律标 `uncertain`，不脑补。

## 分组一：持久化记录（record）

全部 record 均为 `Session.append(type, data)` 写入，`seq = log.length` 连续（跨会话无全局序），持久化为 durable（进 `*.jsonl.zstd`）。重放语义统一为：**构造函数 seed 不 emit**；`session/end-seed` 标记 seed 边界；`firstLiveSeq` = seed 后长度；未知类型需带 `ignorable` 标记才可安全跳过（否则读者必须拒绝重建）。

| id | 语义 | 来源（append 点） | payload 关键字段 | 重放/备注 |
|---|---|---|---|---|
| turn/start | 打开一轮 turn（claim 队列输入、跑 pre-step 之前） | dsh-agent-loop:lib/index.js:523 | turn:number | 无 step 的 turn 可能 reject/空输入/取消关闭 |
| turn/end | 关闭一轮 turn，带结束原因 | dsh-agent-loop:lib/index.js:592 | turn:number, reason:TurnEndReason | reason 见下方深挖 |
| step/start | 打开一步（一次模型调用+其工具执行） | dsh-agent-loop:lib/index.js:548 | turn,step:number | 与 step/end 配对 |
| step/end | 关闭一步（finally 内，成功/错/取消均记） | dsh-agent-loop:lib/index.js:558 | turn,step:number | 与 step/start 平衡 |
| user/message | 模型可见 user 消息（直接提示 / inject 合成上下文 / goal 续轮） | dsh-agent-loop:lib/index.js:554 | message:UserMessage, source.kind:'user'\|'plugin'\|'goal' | surfaceOp:'append'；source 区分来源 |
| assistant/chunk | 原始流式分片（token 级重放保真） | dsh-agent-loop:lib/index.js:621 | turn,step,chunk:StreamChunk | 非 surface；seq 连续含 raw chunk |
| assistant/message | 一步组装后 assistant 消息（派生历史用此），携带 usage | dsh-agent-loop:lib/index.js:632 / :673 | turn,step,message:AssistantMessage,usage?:TokenUsage,interrupted?:true | usage 与消息同行；无独立 usage 记录 |
| tool/call | 模型请求一次工具调用（name+原始 arguments 字符串） | dsh-agent-loop:lib/index.js:293 | turn,step,callId,name,arguments:string | callId 与 tool/result 配对 |
| tool/result | 工具调用完成结果 + 可选 error + 可选 meta | dsh-agent-loop:lib/index.js:308 | turn,step,message:ToolResultMessage,error?:{name,code},meta?:JsonValue | meta 必须 JSON 可序列化 |
| todo/write | todo 列表全量快照（last-write-wins） | dsh-tool-todo:lib/index.js:175 | todos:TodoItem[] | TodoItem={content,status:'pending'\|'in_progress'\|'completed'} |
| request/header | 下一请求完整头（config/system/tools） | dsh-agent-loop:lib/index.js:733 / :738 | header:EpochHeader, reason:'initial'\|'resume'\|'change' | latest snapshot 重建请求头 |
| request/context | 路由元数据（仅路由/容量变化时） | dsh-agent-loop:lib/index.js:749 | provider,model,contextWindow? | 不参与请求重建 |
| session/end-seed | 标记构造函数 seed 结束 | dsh-session:lib/index.js:1391 | (empty) | 构造函数唯一合法写入者；定位最后一个 |
| goal/change | 一次完整 goal 变更快照或 clear 墓碑 | dsh-goal:lib/index.js:785 | kind,version:1,operation,goal:GoalSnapshot,roundsStarted,createdAt,updatedAt（或 cleared,clearedAt） | latest-wins 折叠；见下方深挖 |
| llm/retry | provider 路由重试的 durable 记录 | dsh-llm-retry:lib/index.js:119 | retryId,turn,step,provider,mode:'normal'\|'always',policyKey,retry,maxRetries?,delayMs,failure | mode='normal' 有 maxRetries |
| llm/retry-started | 重试等待成功后的转移 | dsh-llm-retry:lib/index.js:121 | retryId,turn,step,retry | 在对应 llm/retry 之后 |
| compaction/start | 压缩开始（持锁） | dsh-compaction-basic:lib/index.js:437 | compactionId,sourceCommandId?,turn:number\|null | turn:null=turn 间手动事务 |
| compaction/end | 压缩结束（释放锁） | dsh-compaction-basic:lib/index.js:452 / :463 | compactionId,sourceCommandId?,turn,error? | 与 start 配对 |
| compaction/summary | 摘要+输入+模型调用事实 | dsh-compaction-basic:lib/index.js:589 | compactionId,summary,shadowedRange,shadowedSeqs,shadowedTokenCount,provider,model,maxTokens?,usage?,rawOutput,llmStreamCall? | 随后的 user/message replace 完成 surface 替换 |
| compaction/prune | 无模型 prune 替换的影子价格 | dsh-compaction-tool-result-pruner:lib/index.js:161 | shadowedRange,shadowedSeqs,shadowedTokenCount | replace 事件必须紧跟其后 |
| approval/policy | 会话审批策略切换 | dsh-user-approval:lib/index.js:78（delegation: dsh-subagent:614） | policy:ApprovalPolicy, source?:'delegation' | last-wins |
| approval/asked | 审批问题交 answerer 链 | dsh-user-approval:lib/index.js:148 | id:ApprovalRequestId,toolName,callId?,reason? | id 与 decided 配对 |
| approval/decided | 审批结果 | dsh-user-approval:lib/index.js:155 | id,outcome:ApprovalOutcome | 每次 ask 恰好一条 |
| plan/mode | plan 模式是否生效 | dsh-plan-mode:lib/index.js:387 / :402 | active:boolean | last-wins；无记录折叠为 inactive |
| sandbox/mode | 会话沙箱模式切换 | dsh-sandbox-policy:lib/index.js:55（delegation: dsh-subagent:610） | mode:SandboxMode, source?:'delegation' | last-wins |
| permission/preset | 选中 permission 预设 | dsh-permission-presets:lib/index.js:286 / :306 / :317 | preset:string | last-wins |
| schedule/change | Schedule 变更 | dsh-schedule:lib/index.js:841 / :846 / :1235 / :1306 | version:1,operation:'create'\|'delete'\|'dispatch',schedule?/id?/acceptedAt? | owning package 校验转移流 |
| session/title | latest-wins 标题快照 | dsh-session-title:lib/index.js:242 / :406 / :546 / :568 | (SessionTitleEventData) | uncertain：字段未完整读取 |
| session/title-llm-request | 标题模型请求预 dispatch 记录 | dsh-session-title-llm:lib/index.js:218 | titleProvider,messageSeqs,route,system,messages,maxTokens | log-only |
| feedback/record | 一条人类反馈 | dsh-command-feedback:lib/index.js:49 | text:string | eager 但 unflushed |
| agent-preset/selected | 会话 preset 被选择 | dsh-host-apiproxy:lib/index.js:3260 | agentPreset:string | log-only |
| agent/inbox/spliced | 待处理消息列表一次规范化变更 | dsh-agent:lib/index.js:148 | target:'next-turn'\|'next-step',start,removedCount?,inserted:UserMessage[],outcome?:'canceled' | live dispatch 在投影变更前 |
| subagent/descriptor | 子会话身份与生命周期模式 | dsh-subagent:lib/index.js:640（in-process: :144） | version:2,mode:'one-shot'\|'continuable',provider,label?,agentProvider?,agentModel?,persona?,toolFilter? | 首个 descriptor 权威 |
| web/deepseek-search-llm-request | secret-free 辅助搜索请求 | dsh-web-search-deepseek:lib/index.js:283 | (DeepSeekSearchLlmRequest) | uncertain：payload 未完整读取 |
| tool/code-dispatch-start | run_code 子 dispatch 开始 | dsh-tools:lib/index.js:1264 | rootCallId,parentCallId,subCallId,name,arguments | subCallId=<parent>:code:<n> |
| tool/code-dispatch | run_code 子 dispatch 落定 | dsh-tools:lib/index.js:1242 | rootCallId,parentCallId,subCallId,name,arguments,isError,content | deriveMessages 忽略 |
| command/run | 命令执行记录 | dsh-commands:lib/types/types.d.ts:79 | (unknown) | uncertain：覆盖包之外 |
| command/done | 命令结束记录 | dsh-commands:lib/types/types.d.ts:79 | (unknown) | uncertain：覆盖包之外 |
| hook/invoked | 钩子桥接层 invoked | unknown | (unknown) | uncertain：本 checkout 无对应包 |
| hook/result | 钩子桥接层 result | unknown | (unknown) | uncertain：本 checkout 无对应包 |
| team/member | team 域成员 | unknown | (unknown) | uncertain |
| team/message/delivered | team 域消息投递 | unknown | (unknown) | uncertain |
| team/message/queued | team 域消息排队 | unknown | (unknown) | uncertain |
| team/task | team 域任务 | unknown | (unknown) | uncertain |
| tool-workflow/run-start | tool-workflow run 开始 | dsh-tool-workflow:lib/types/types.d.ts:34 | (unknown) | uncertain：覆盖包之外 |
| tool-workflow/run-end | tool-workflow run 结束 | dsh-tool-workflow:lib/types/types.d.ts:34 | (unknown) | uncertain |
| tool-workflow/agent-start | tool-workflow agent 开始 | dsh-tool-workflow:lib/types/types.d.ts:34 | (unknown) | uncertain |
| tool-workflow/agent-end | tool-workflow agent 结束 | dsh-tool-workflow:lib/types/types.d.ts:34 | (unknown) | uncertain |

## 分组二：活事件（event）

活事件均为 ephemeral（仅内存、不重放），scope 过滤机制统一为 `scopeTarget(base, key)` carrier（见「作用域机制」）。带「注入」字段者由 `agentEvents()` 在 dispatch 时注入 `agent` 并绑定 scope carrier。

| id | 语义 | 来源（emit 点） | payload 关键字段 |
|---|---|---|---|
| session/created | 会话发布期间创建宣告（同步 throw 可 veto） | dsh-session:lib/index.js:1750 | session |
| session/disposed | 会话离开 store（含回滚） | dsh-session:lib/index.js:1770 | session |
| session/event | post-commit fire-and-forget append 流 | dsh-session:lib/index.js:1476 | session, event:SessionEvent |
| session/flush | awaited 并行 durability 检查点（mode=parallel） | dsh-session:lib/index.js:1796 | session |
| agent/created | 完整配置的 agent+session 已发布 | dsh-agent:lib/index.js:668 | agent |
| agent/disposed | agent 离开 registry | dsh-agent:lib/index.js:641 | agent |
| agent/error | 一步或一轮出错 | dsh-agent-loop:lib/index.js:470 | agent(注入),turn,step,error |
| agent/status | 状态变更 idle⇄running | dsh-agent-loop:lib/index.js:388 | agent(注入),status |
| agent/session-start | 会话生命周期开始（首个 turn 前一次） | dsh-agent-loop:lib/index.js:1188 | agent(注入),source:'startup'\|'resume' |
| agent/inbox/inserted | 消息进入 live inbox | dsh-agent-loop:lib/index.js:359 | agent(注入),message |
| agent/inbox/discarded | 消息从 live inbox 丢弃 | dsh-agent-loop:lib/index.js:362 | agent(注入),message |
| agent/inbox/claimed | 消息在其 open turn 内离开 inbox | dsh-agent-loop:lib/index.js:365 | agent(注入),message,turn |
| goal/changed | live agent 接受的 goal 变更（对应 goal/change 已先提交） | dsh-goal:lib/index.js:796 | agent(注入),change:GoalChanged{operation,ref,goal?} |
| tools/change | 工具注册/注销或 scoped 限制变化（unfiltered） | dsh-tools:lib/index.js:2579 | (void) |
| tools/result | 观察冻结的 lossless-JSON 最终结果 | dsh-tools:lib/index.js:3281 | exec,result |
| agent-preset/selected | 会话提交不同 preset（live 形态） | dsh-agent-presets:lib/index.js:870 | sessionId,agentPreset |
| agent-loop/config-start-failed | 声明式 entry 发布前失败 | dsh-agent-loop:lib/index.js:1057 | sessionId,error |
| subagent/start | 子代理已发布 | dsh-subagent (catalog) | info | *(uncertain：emit 点未定位)* |
| subagent/end | 子代理落定 | dsh-subagent (catalog) | info | *(uncertain)* |
| subagent/provider-added | provider 可解析 | dsh-subagent:lib/index.js:2579 | provider |
| workflow/start | run 启动 | dsh-workflow (catalog) | info | *(uncertain)* |
| workflow/end | run 落定 | dsh-workflow (catalog) | info,result | *(uncertain)* |
| workflow/agent-start | agent() 建立子 run | dsh-workflow (catalog) | info,agent | *(uncertain)* |
| workflow/agent-end | agent() 落定 | dsh-workflow (catalog) | info,agent | *(uncertain)* |
| skills/change | skill 目录可能变化（unfiltered） | dsh-skill:lib/index.js:404 | (void) |
| fs/observed | 权威正/负文件观察 | dsh-tool-fs:lib/index.js:277（str-replace-editor:74） | target,observation,actor |

> `session/event` 是 durable→ephemeral 的 re-publication：其 `event` 参数正是已提交的 durable 事件，故标为 **reconstructible**（读 log 即可重建）。其余活事件均 ephemeral。

## 分组三：waterfall（可拦截活事件）

waterfall 均为 ephemeral、串行链内顺序。`agent/turn-stopping` 在 catalog 中 mode=serial（await 链，非 waterfall veto）。

| id | 语义 | 来源（dispatch 点） | payload 关键字段 |
|---|---|---|---|
| agent/pre-step | 拒绝提议 step 或替换进入消息 | dsh-agent-loop:lib/index.js:501 | agent(注入),messages,turn,step,signal |
| agent/request | 替换冻结调用配置 | dsh-agent-loop:lib/index.js:708 | agent(注入),turn,step,signal |
| agent/request-error | 处理失败模型请求尝试 | dsh-agent-loop:lib/index.js:653 | agent(注入),turn,step,provider,failure,retryPolicy?,signal |
| agent/turn-stopping | turn 即将关闭前 awaited | dsh-agent-loop:lib/index.js:565 | agent(注入),turn,signal |
| llm/stream | 围绕每次流式模型调用 | dsh-llm:lib/index.js:1640 | this:LlmRuntime,options,next |
| tools/execute | around-dispatch 瀑布 | dsh-tools:lib/index.js:3202 | exec,next |
| tools/pre-execute | dispatch 前 allow/deny/ask | dsh-tools (catalog:4280) | exec,next |
| tools/post-execute | 接受/替换/丰富/阻止结果 | dsh-tools (catalog:4291) | exec,result,next |
| tools/code-dispatch-log | 替换 run_code 子 dispatch log 副本 | dsh-tools (catalog:4269) | dispatch,next |
| approval/request | 向 answerer 请求决策 | dsh-user-approval (catalog:3879) | req,next |
| session-telemetry/record | redaction 扩展点 | dsh-session-telemetry:lib/index.js:174 | record,next |
| system-prompt/assemble | 组装后专家瀑布 | dsh-system-prompt (catalog:4239) | assembly,context,next |

## 分组四：服务 API（service）

| id | 语义 | 来源 | 关键方法 |
|---|---|---|---|
| ctx.sessions | 内存会话 store | dsh-session:lib/index.js:1584 | create/prepare/enter/list/get/fork/flush |
| ctx.agents | live agent registry+工厂+initiator scope | dsh-agent:lib/index.js:415 | get/list/register/create/resume/withInitiator/currentInitiator |
| ctx.goals | Goal 域控制器 | dsh-goal:lib/index.js:512 | get/create/edit/pause/resume/complete/block/clear/disarm |
| ctx.planMode | plan 状态控制器 | dsh-plan-mode (catalog:1751) | (PlanModeController) |
| ctx.permissionPresets | permission 预设服务 | dsh-permission-presets (catalog) | (PermissionPresetService) *(uncertain)* |
| ctx.approval | 审批 seam | dsh-user-approval (catalog) | (ApprovalService) |
| ctx.sessionPersistence | 持久化协调器 | dsh-session-persistence:lib/index.js:768 | prepare/load/inspect/readFrom/list/archive |
| ctx.tools | 工具 registry+调度器 | dsh-tools (catalog) | executionMode/get/调度器 |
| ctx.llm | llm 服务 | dsh-llm (catalog:1501) | stream/prepareCall |
| ctx.sandboxPolicy | 沙箱策略解析 | dsh-sandbox-policy:lib/types/session-mode.d.ts:10 | resolve() |

---

## 重点深挖

### 1. goal/change 结构（verdict 关键）

- **operation 枚举**（`dsh-goal/lib/types/domain.d.ts:12`）：`GoalOperation = 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'block' | 'clear'`。
- **快照结构**（`dsh-goal/lib/types/types.d.ts:46`）：`GoalSnapshot extends GoalRef { objective, phase, blockedReason?, maxGoalRounds }`；`GoalRef = { id, revision }`。
- **快照变更 meta**（`domain.d.ts:14-30`）：`{ kind:'goal/change', version:1, operation:<非clear>, goal:GoalSnapshot, roundsStarted, createdAt, updatedAt }`；clear 墓碑为 `{ kind:'goal/change', version:1, operation:'clear', cleared:GoalRef, clearedAt }`。
- **phase 枚举与合法转移**（`types.d.ts:37`；转移逻辑 `dsh-goal/lib/index.js`）：
  - `GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'`。
  - `GoalActivation = 'armed' | 'disarmed'`（**进程本地、绝不持久化**，不是 phase）。
  - `create`：无 goal 或当前 `phase==='complete'` → `active` + `armed`（:573）。
  - `pause`：仅 `active` → `paused` + `disarmed`（:610）。
  - `resume`：`active|paused|blocked` → `active` + `armed`；已 active+armed 或 `roundsStarted>=maxGoalRounds` 拒绝（:619-630）。
  - `complete`：`active|paused|blocked` → `complete` + `disarmed`（:638）。
  - `block`：仅 `active` → `blocked` + `disarmed`（:652）。
  - `clear`：任意 phase → 墓碑 + `disarmed`（:667）。
- **goal/changed 活事件 payload**（`domain.d.ts:68,86`）：`{ change: GoalChanged }` + agent 注入；`GoalChanged = { operation, ref:GoalRef, goal?:GoalView }`（goal 为最新投影或 clear 墓碑时缺省）。emit 点 `dsh-goal/lib/index.js:796`。
- **作用域机制**：`GoalController`（`goals` Service）通过 `agentEvents(this.ctx, agent).emit("goal/changed", ...)` 做 scope 过滤；`agent/session-start` 时 activation 置 `disarmed`（:519）；mutation 通过 `pendingActivation.seq` 精确回填 activation（:778-789）。

### 2. turn/end reason 枚举与 assistant/message usage（verdict 关键）

- **TurnEndReason**（`dsh-session/lib/types/types.d.ts:135-168`，merge-extensible）：`completed` / `aborted{reason:TurnEndCancelCause}` / `blocked` / `error{error:LlmFailure}` / `max-tokens` / `interrupted`。
- **关键**：`interrupted` 由**持久化后端**在 reload 时关闭崩溃孤儿 turn 合成（`types.d.ts:160-166`；`dsh-session-persistence/lib/index.js:995` `interruptedTurnClosers`），loop 从不 emit。
- **turn/end 生成**（`dsh-agent-loop/lib/index.js:574-599`）：signal aborted→`aborted`；LlmError→`error`（`{message,code:'UNKNOWN'}` 兜底）；max-tokens→`max-tokens`；pre-step reject→`blocked`（:539）；空 claim→`completed`（:544）。
- **assistant/message 的 usage**（`dsh-llm/lib/types/types.d.ts:123-129`）：`TokenUsage = { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`。
  - **注意**：字段是 `cacheReadTokens` **和** `cacheWriteTokens` 两个（任务线索只提了 `cacheReadTokens`，实测还有 `cacheWriteTokens`）。计数不相交：`inputTokens` 是不含缓存的输入，`cacheReadTokens`/`cacheWriteTokens` 单独报。
  - `usage` 出现在 `assistant/message`（`dsh-agent-loop:632,673`），仅在 adapter 上报 token 时存在（`...assembler.usage === void 0 ? {} : { usage }`）。
  - `interrupted:true` 标记 mid-stream 取消后已交付的前缀（`dsh-agent-loop:632-647`）。

### 3. dsh-session 信封 / append / seq / Store / 持久化

- **信封**（`types.d.ts:425`）：`SessionEvent = { type, seq, time, data } & (surface 事件加 sourceEventSeqs?/surfaceOp?)` + 可选 `ignorable?: true`。surface 类型仅 `user/message|assistant/message|tool/result`（`types.d.ts:367`）。
- **append 约束**（`dsh-session/lib/index.js:1444-1484`）：`snapshotJsonValue` 校验 lossless JSON（BigInt/function/symbol/undefined/负零/非有限数/环引用/稀疏数组/Map/Set/Date/类实例均拒绝）；`seq = this.log.length`；`time = Date.now()`；`deepFreeze`；surface 校验；随后 `collectSessionCallbacks` → push → 广播 `session/event`。
- **seq 连续性契约**：`get seq()` 返回 `this.log.length`（`:1406-1408`），seed 要求 `seq===index`（`:1381`）。
- **events 快照深冻结**：`get events()` 返回 `Object.freeze([...log])`（`:1401-1404`）；事件与嵌套 data 在 accept 时 deep-frozen。
- **SessionStore**（`:1584`）：`create/prepare/enter/list/get/fork/flush`；`announce`(session/created)/`emitDisposed`(session/disposed)；`fork` 要求 boundary 不落在 open turn 内（`:1873-1874`）。
- **sessionPersistence**（`dsh-session-persistence/lib/index.js:768`）：`prepare/load/inspect/readFrom/list/archive`；write path 监听 `session/created`→initFor、`session/event`→write-behind enqueue、`session/flush`→flush、`session/disposed`→retire（`:1152-1161`）。
- **jsonl 后端**（`dsh-session-persistence-jsonl`）：默认 `zstd` 压缩，文件 `*.jsonl.zstd`（`index.js:29`）。
- **session/event firehose 作用域**：`SessionStore.enter` 用 `scopeTarget(session, scopeOf(this.ctx))` 建 carrier（`dsh-session:1695`）；`agentEvents` 用 `scopeTarget(agent, agent)`（`dsh-agent:323`）；scope 语义见 `dsh-scope/lib/index.js:327`（tag 沿祖先链向上传播，向下不传播）。

### 4. dsh-headless 一任务一会话生命周期

`dsh-headless/lib/index.js:63-99`：`agents.create(sessionId: session-<uuid>)` → `agent.whenIdle()`（等 session-start setup）→ 记 `firstSeq = session.seq` → `agent.followup(task)` → `whenIdle()` → `sessions.flush()` → `summarize(events, firstSeq)`。`summarize`（:30-51）按 seq 过滤后读取 `turn/start`、`assistant/message`（拼接 text 块为最终文本）、`turn/end`（reason 决定 exit code：completed→0，否则 1）。

### 5. dsh-goal-round-driver 回合推进

`dsh-goal-round-driver/lib/index.js:103-164`（`drive`）：quiescence 时若 `goal.phase==='active' && activation==='armed'` 且 `roundsStarted < maxGoalRounds`，渲染 `<goal_round>` 提示并 `agent.followup(message)`（source.kind='goal', round>0）。触发续轮：`agent/status`(idle)、`goal/changed`（置 needsCheckpoint + requestDrive）、`session/event`(user/message admitted / turn/end)。回合上限：`roundsStarted >= maxGoalRounds` → `block(code:'round-limit')`（:125-130）。disarm/arm：`disarm()` 进程本地关续轮权限（:87）；`arm` 由 `goals.resume()` 产生（`dsh-goal:630`）。pre-step 用 `validReservation` fail-closed 校验排队提示仍拥有精确 live revision（:276-279）。

## 作用域机制（scopeTarget / carrier）小结

`dsh-scope/lib/index.js`：`createScope(ctx,key)` 造带 `kScope` 标签的 scoped context；`scopeTarget(base,key)` 造 carrier（保留 base 的 Cordis filter + 对「无标签 listener 全局放行、对 tag===key 或其祖先的 listener 放行」）；事件沿 scope 链**向上**传播，从不向下。因此一个 agent-scoped listener 收到该 agent 及其后代的事件；一个 standing composition 通过 ancestor tag 观察其下所有 agent。

## 附：known 词汇增长机制（ignorable）

`dsh-session/lib/types/types.d.ts:434-443`：`ignorable?: true` 标记「纯信息记录、丢失不影响重建」；缺省为 required——读者遇未知类型且无此标记必须拒绝重建而非静默丢弃。新增普通事件类型不 bump `SESSION_FORMAT_VERSION`（`:28-32`），靠 per-event `ignorable` 守卫覆盖词汇增长。
