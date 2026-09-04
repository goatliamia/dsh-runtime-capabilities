# Bug 005: 会话日志修复时整体重压破坏帧结构 → boot 挂死

## Problem

修复 corrupt session 时，把整个 `session.jsonl.zstd` 重编码为 100/59 个 256KB 大帧（替换原始 40196/25041 个逐帧结构）。`dsh-workspace` 启动列举会话时 `assertZstdHeaderFrame` 抛 `corrupt Zstandard session log`，整个 DSH boot 跟着挂掉。两份日志（9d9b289a / 8f5c713d）因此被二次破坏（隔离件 `session.jsonl.zstd.ai-broken-0935`），最终靠修复前的 `.bak` 备份恢复。

## Root Cause

修复脚本只验证了**内容等价**（解码 → 改行 → 重压 → 再解码，行数一致、目标行只变标签），没有验证持久化层的**格式不变量**：

1. 第一个 zstd 帧解压后必须**恰好一行 header**（`assertZstdHeaderFrame` 在会话列举时强制）；
2. 后续事件按"每帧一行/一批"逐帧追加压缩，不是任意分块。

"任意合法帧拼接即可"的假设对内容解码器成立（magic-split + 逐帧 `zstdDecompressSync`），对 loader 的结构断言不成立。手术前没有读 loader 的全部结构校验（`scanZstdFrames` / `assertZstdHeaderFrame`）就动手了。

## Correct Pattern

**帧边界保持手术**：

1. 解码时记录每个帧对应的行范围（line → frame 映射）；
2. 只对包含目标行的帧做替换并**单独重压**（`zstdCompressSync` + checksum 标志，与后端写入端一致）；
3. 其余所有帧**字节原样保留**；header 帧绝不触碰；
4. 验证分两层：内容等价（逐行 diff 只差目标行）+ 格式等价（帧数与边界不变、首帧仍为单行 header、跑 loader 的会话列举路径或最小 boot smoke）。

## Regression

修复后除目标行所在帧外，新文件与原始文件逐字节相同；并对修复结果跑 `dsh-workspace` 的会话列举（或最小 boot smoke），而非仅做解码往返验证。
