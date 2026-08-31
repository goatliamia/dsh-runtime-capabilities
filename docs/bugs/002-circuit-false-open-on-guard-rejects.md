# Bug 002: Circuit 误开在守卫拒绝上

## Problem

strict-e2 假熔断：guard 的确定性拒绝被 circuit 失败指纹计数，工具被错误熔断——"拒绝"与"失败"两类语义被混进同一个指纹空间。

## Root Cause

circuit 观察失败流时未区分来源：守卫拒绝（`[action-rejected]` 开头）与执行期错误走同一 `observeFailure` 入口，相同拒绝文案重复出现即触发阈值。

## Correct Pattern

守卫拒绝不进 circuit 指纹：`[action-rejected]` 前缀的拒绝直接跳过计数；只有执行期同指纹错误累积到 `circuitThreshold` 才熔断。

## Regression

strict-e2 场景断言：N 次确定性守卫拒绝后 circuit 不得 open；同场景执行期 flaky 错误达到阈值必须 open。
