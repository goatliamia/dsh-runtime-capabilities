# dsh-runtime-progress

**Reference `runtime-*` plugin on top of `dsh-runtime-seam`** (host-only): demonstrates how a domain capability composes with the seam — a shell-lock guard, plus an `onActivity` reaction for no-progress circuit events.

> 参考插件：展示 domain 能力如何挂在 `dsh-runtime-seam` 上——shell-lock 守卫示例 + 对 circuit 介入记录的响应。它不是功能承诺，是**写法样板**。

## 它演示了什么

1. **注入 seam**（`cordis.patch.yml` 里 `inject: [runtimeSeam]`），用 `seam.setFact` 声明一个确定性事实。
2. **Guard 示例**：`shell-lock` 事实存在时，拒绝对锁定 shell 的操作（`seam.registerGuard`，教学式 reason）。
3. **onActivity 反应**：监听 `circuit-open` 介入记录，做自己的记录/降级处理（不拦截、不改变 seam 行为）。
4. **宿主空转**：`runtimeSeam` 缺失时静默退出，不拖垮 boot。

## 安装

```powershell
cd plugins/runtime-progress
pnpm pack
dsh plugin add dsh-runtime-progress-<version>.tgz
```

依赖 `dsh-runtime-seam`（workspace `file:` 依赖，发布前替换为版本号）。

## 新写一个 runtime-* plugin 的最小步骤

```text
1. 回答贡献清单 docs/contribution.md 的 9 个问题（确定性部分是否真的存在？）
2. cordis.patch.yml 声明 inject: [runtimeSeam]（可选注入）
3. setFact 声明事实 → registerGuard 守卫动作边界 / onActivity 响应介入
4. 宿主失败必须可隔离：缺 seam、缺事实、异常都不影响其他 plugin
```

## 文档

- 机制与证据：仓库根 `README.md`（English）/ `README.zh-CN.md`（简体中文）
- 贡献边界：`docs/contribution.md`
- 实验记录：`docs/status/runtime-*.md`
