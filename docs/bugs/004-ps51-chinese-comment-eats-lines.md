# Bug 004: PS 5.1 无 BOM 中文注释吞行

## Problem

driver.ps1 里的中文注释导致后续行被吞、`$task` 为空；任务经 pwsh→cmd→dsh 链路后完全丢失，run 静默跑空任务。

## Root Cause

Windows PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI 读取，UTF-8 中文字节在解析时破坏行结构；错误只在链路末端暴露（空任务），距离源头很远。

## Correct Pattern

driver 脚本全 ASCII（英文任务、英文注释）；中文只进 docs/*.md。任何 .ps1 不得含非 ASCII 字节。

## Regression

发布自检项：对 `experiments/harness/*.ps1` 跑非 ASCII 扫描，命中即失败。
