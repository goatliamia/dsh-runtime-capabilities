# native-pp：Progress / Effect Projection 实验线（2026-09-01 ~ 09-02）

三轮实验 → 结构升级 → 验收。全部在隔离 home（`<HOME>\.dsh-native-pp-exp`）完成，token 全部事后回溯（循环内零计量）。

## 阶段映射（对应 docs/status/native-pp-*.md）

| 逻辑阶段 | 目录 | 内容 |
|---|---|---|
| progress-semantics | `docs/16-native-pp-experiment.md` + `docs/16-native-pp/event-semantics.{md,json}` + `harness/{driver-pp,verify-fold,decode-log,token-index,aggregate-pp}.mjs` + `harness/task-{ok,toolfail,unobservable}.txt` | 四象限语义成立：live fold == 官方重放 == 独立实现；reload 一致性；零成本面（第 1 轮结果已被消费进 docs，原始 results 已清） |
| progress-consumer | `fixture/`、`projection/`、`policy/` + `harness/driver-pp{2,3}.ps1` + `harness/task-{loop,nonatomic,noop,pretend}.txt` + `results/loop-*、nonatomic-*、pretend-*、noop-*、ok-ctrl1` | 四个格子：circuit（6→2，−67%）、reconcile（重复副作用 4→1，−75%）、investigate（静默失败 2/2→0/2）、正常任务 0 介入；N=4 稳定 |
| real-coding | `harness/{driver-pp{4,5,5b}.ps1,task-real{2,3,4,6}.txt,world/}` + `results/real*-*` | 创造模式（standard preset、无工具钳制）真实场景：real3 静默失败→0、real6 0 介入、real2/real4 价值边界（模型自己看穿时 policy 沉默） |
| structure-upgrade acceptance | `harness/driver-pp6.ps1` + `results/{loop,nonatomic,pretend}-{ab}{12}、ok-acc1` + `results/driver6.log` | 新结构（core/runtime-progress+circuit+reconcile+investigate）重放四象限，行为数字逐项复现（见下方验收表） |

## 结构升级验收（2026-09-02，新 core 包）

| 验收项 | 目标 | 实测 |
|---|---|---|
| loop aware 真实执行 | 2（baseline 6） | 2 / 2 ✓ |
| nonatomic aware 重复副作用 | 0（baseline 3） | 0 / 0 ✓ |
| pretend aware 静默失败 | false | false / false ✓（check=2、repair=1） |
| ok 对照三 policy 介入 | 0 | 0 / 0 / 0 ✓ |

circuit 拒绝证据带 Progress support 引用（如 `support:[100,400]`）——policy 消费事实层的形状验收。

## 资产约定

- `fixture/`：测试世界（确定性工具 + 轨迹 + 世界真值 + 契约注册 EXP_CONTRACTS=1）——只进实验 profile；
- `projection/`、`policy/`：已由 `core/runtime-progress` 与 `core/runtime-circuit|reconcile|investigate` 取代（实验期单包版本，留作对照）；
- `results/`：全部经 `scripts/sanitize-native-pp.mjs` 脱敏（home 路径/session id/安装路径/仓库绝对路径）；
- `dist/`：本地 profile 安装用的 tgz，不进提交语义（按需重建：各包 `pnpm pack`）。
