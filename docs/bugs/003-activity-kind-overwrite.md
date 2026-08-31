# Bug 003: activity kind 被 payload.kind 覆盖

## Problem

介入记录里 delta 显示成 circuit-open，活动面板 delta 计数恒为 0——数据面板与真实行为对不上。

## Root Cause

`recordActivity(kind, data)` 把 payload 原样展开进记录对象，payload 自带 `kind` 字段（circuit-open 等）覆盖了外层传入的 kind；子类型信息被塞进同一字段互相覆盖。

## Correct Pattern

记录构造时剥离 payload 的 `kind`，子类型用独立字段 `type` 表达：`{ t, kind: 'delta', type: 'committed-delta', ... }`。

## Regression

发布自检断言：活动面板各 kind 计数与 arm 内实际行为一致（delta 计数 > 0 当且仅当 arm 发过 delta）。
