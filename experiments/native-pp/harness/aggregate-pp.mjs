// aggregate-pp.mjs — E5 A/B direction report + cost appendix.
// Reads token-index.json (retroactive real usage) and the two E5 metrics
// files, reports ONLY the direction of A-vs-B deltas (per experiment design)
// plus the tool-surface parity check (constraint #8).
// Usage: node aggregate-pp.mjs <resultsDir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const resultsDir = process.argv[2];

const index = existsSync(join(resultsDir, "token-index.json"))
  ? JSON.parse(readFileSync(join(resultsDir, "token-index.json"), "utf8"))
  : [];

const armA = index.find((r) => r.run === "ok-e5a-r1");
const armB = index.find((r) => r.run === "ok-e5b-r1");

const lines = [];
lines.push("# E5 A/B 成本方向报告（native-pp）", "");
lines.push("口径：事后回溯解码 session.jsonl.zstd 真实 usage；循环内零计量。只报方向，不报绝对差异幅度。", "");

function loadMetrics(run) {
  const path = join(resultsDir, `${run}.metrics.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

if (armA && armB) {
  const fields = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"];
  lines.push("## Token 方向", "");
  lines.push("| 指标 | A（无投影） | B（有投影） | 方向 (B - A) |", "|---|---:|---:|---:|");
  for (const f of fields) {
    const delta = armB[f] - armA[f];
    const dir = delta > 0 ? "B > A" : delta < 0 ? "B < A" : "B = A";
    lines.push(`| ${f} | ${armA[f].toLocaleString()} | ${armB[f].toLocaleString()} | ${dir} (${delta > 0 ? "+" : ""}${delta.toLocaleString()}) |`);
  }
  lines.push("", `| modelCalls | ${armA.modelCalls ?? "-"} | ${armB.modelCalls ?? "-"} | ${(armB.modelCalls ?? 0) === (armA.modelCalls ?? 0) ? "B = A" : "diff"} |`);

  const ma = loadMetrics("ok-e5a-r1");
  const mb = loadMetrics("ok-e5b-r1");
  if (ma && mb) {
    const ta = JSON.stringify(ma.initialTools ?? null);
    const tb = JSON.stringify(mb.initialTools ?? null);
    const da = JSON.stringify(ma.deniedTools ?? null);
    const db = JSON.stringify(mb.deniedTools ?? null);
    lines.push("", "## 工具面一致性（约束 #8）", "");
    lines.push(`- initialTools A == B: **${ta === tb ? "true（逐位相等）" : "FALSE"}**`);
    lines.push(`- deniedTools  A == B: **${da === db ? "true" : "FALSE"}**`);
    if (ta !== tb) {
      lines.push(`  - A: ${ta}`);
      lines.push(`  - B: ${tb}`);
    }
    lines.push(`- payloadChars A=${ma.payloadChars ?? "-"} B=${mb.payloadChars ?? "-"}`);
  }
} else {
  lines.push("", "token-index.json 缺少 E5 臂数据，方向表未生成。", "");
}

lines.push("", "## 全部运行回溯（原始数据）", "");
if (index.length > 0) {
  lines.push("| run | arm | input | output | cacheRead | cacheWrite | reasoning | modelCalls | toolErrors |", "|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of index) {
    if (row.sessionId === null) {
      lines.push(`| ${row.run} | - | - | - | - | - | - | - | ${row.note ?? ""} |`);
      continue;
    }
    lines.push(`| ${row.run} | ${row.arm ?? "-"} | ${row.inputTokens?.toLocaleString() ?? "-"} | ${row.outputTokens?.toLocaleString() ?? "-"} | ${row.cacheReadTokens?.toLocaleString() ?? "-"} | ${row.cacheWriteTokens?.toLocaleString() ?? "-"} | ${row.reasoningTokens?.toLocaleString() ?? "-"} | ${row.modelCalls ?? "-"} | ${row.toolErrors ?? "-"} |`);
  }
} else {
  lines.push("token-index.json 不存在（先跑 node token-index.mjs）。");
}

const out = join(resultsDir, "cost-appendix.md");
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
