# Bug 001: 状态文件跨 preset 污染

## Problem

strict-e2 轮的持久化状态（`flaky=failed`、`x.state=ready`）泄漏进后续 off/minimal 轮，对照臂数据被污染，E4b 结论一度失真。

## Root Cause

`dsh-runtime-seam` 启动时无条件 `readFileSync(STATE_FILE)` 加载持久化事实；`persistence` 能力开关只控制"是否写入"，不控制"是否加载"。preset 切换没有隔离状态文件的读写路径。

## Correct Pattern

加载同样按 preset 门控：`persistence` 关闭时完全不读 state.json。同时 driver 每格起跑前清空状态文件，保证跨格零残留。

## Regression

每个 arm 起跑断言 `state.json` 不存在或为空；preset=off/minimal 时 registry 里不得出现任何持久化事实。
