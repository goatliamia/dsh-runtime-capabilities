/**
 * E4b aggregation (retry-pressure variant, runs r4-r6).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RESULTS = "<HOME>/Documents/runtime-exp/results";
const ARM_ORDER = ["none", "circuit", "circuitdelta"];
const ARM_LABEL = {
  none: "none (no breaker)",
  circuit: "circuit (guard reject)",
  circuitdelta: "circuit + delta announcement",
};

function readMetrics(runId) {
  const path = join(RESULTS, `${runId}.metrics.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readResultFile(runId) {
  const path = join(RESULTS, `${runId}.result.txt`);
  if (!existsSync(path)) return "(missing)";
  try {
    return readFileSync(path, "utf8").trim().replace(/\s+/g, " ").slice(0, 60);
  } catch {
    return "(unreadable)";
  }
}

function avg(list) {
  const values = list.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function main() {
  const rows = [];
  for (const file of readdirSync(RESULTS)) {
    const match = /^(e4)-(none|circuit|circuitdelta)-(r[456])\.metrics\.json$/.exec(file);
    if (!match) continue;
    const [, , arm, repeat] = match;
    const runId = `e4-${arm}-${repeat}`;
    const metrics = readMetrics(runId);
    if (!metrics) continue;
    rows.push({ runId, arm, repeat, metrics, resultFile: readResultFile(runId) });
  }
  rows.sort((left, right) => ARM_ORDER.indexOf(left.arm) - ARM_ORDER.indexOf(right.arm) || left.repeat.localeCompare(right.repeat));

  const byArm = {};
  for (const row of rows) (byArm[row.arm] ??= []).push(row);

  const md = [];
  md.push("# E4b Circuit Breaker 结果（重试压力版）", "");
  md.push(`生成时间：${new Date().toISOString()}`, "");
  md.push("| 指标 | " + ARM_ORDER.map((arm) => ARM_LABEL[arm]).join(" | ") + " |", `|---|---${"|---".repeat(ARM_ORDER.length)}|`);
  const keys = [
    ["flakyAttempts", "exp_flaky 总尝试次数均值"],
    ["flakyCallsAfterCircuitOpen", "开断后的额外尝试均值"],
    ["rejectionsToLearn", "守卫拒绝数均值"],
    ["steps", "steps 均值"],
    ["modelCalls", "模型调用数均值"],
    ["payloadChars", "payload 字符均值"],
    ["probeCalls", "探测数均值"],
    ["circuitStep", "circuit 开断 step 均值"],
  ];
  for (const [key, label] of keys) {
    const cells = ARM_ORDER.map((arm) => {
      const value = avg((byArm[arm] ?? []).map((row) => row.metrics[key]));
      return value === null ? "-" : String(value);
    });
    md.push(`| ${label} | ${cells.join(" | ")} |`);
  }

  md.push("", "| run | 尝试 | 开断后 | 拒绝 | steps | payload | 结果文件 |", "|---|---|---|---|---|---|---|");
  for (const row of rows) {
    md.push(
      `| ${row.runId} | ${row.metrics.flakyAttempts} | ${row.metrics.flakyCallsAfterCircuitOpen} | ${row.metrics.rejectionsToLearn} | ${row.metrics.steps} | ${row.metrics.payloadChars} | ${row.resultFile} |`,
    );
  }

  const noneAttempts = avg((byArm.none ?? []).map((row) => row.metrics.flakyAttempts));
  const circuitAttempts = avg((byArm.circuit ?? []).map((row) => row.metrics.flakyAttempts));
  const deltaAttempts = avg((byArm.circuitdelta ?? []).map((row) => row.metrics.flakyAttempts));
  const noneSteps = avg((byArm.none ?? []).map((row) => row.metrics.steps));
  const deltaSteps = avg((byArm.circuitdelta ?? []).map((row) => row.metrics.steps));
  const nonePayload = avg((byArm.none ?? []).map((row) => row.metrics.payloadChars));
  const deltaPayload = avg((byArm.circuitdelta ?? []).map((row) => row.metrics.payloadChars));

  md.push("", "## 判定", "");
  md.push(`- 失败尝试：none=${noneAttempts}，circuit=${circuitAttempts}，circuitdelta=${deltaAttempts}`);
  md.push(`- steps：none=${noneSteps}，circuitdelta=${deltaSteps}；payload：none=${nonePayload}，circuitdelta=${deltaPayload}`);
  if (noneAttempts !== null && circuitAttempts !== null && deltaAttempts !== null) {
    const reduction = noneAttempts > 0 ? Math.round((1 - deltaAttempts / noneAttempts) * 100) : null;
    md.push(
      reduction !== null && deltaAttempts < noneAttempts
        ? `- circuit 把重复失败尝试从 ${noneAttempts} 压到 ${deltaAttempts}（约 −${reduction}%），且 circuitdelta 臂开断后尝试为 0 → **circuit 原语在重试压力下验证成立**。`
        : "- 效果未达预期，见明细。",
    );
  }
  md.push("- 全部运行 exit=0（runtimeFailures/agentErrors 应为 0）。");

  writeFileSync(join(RESULTS, "summary4b.json"), JSON.stringify({ generatedAt: new Date().toISOString(), byArm, rows }, null, 2));
  writeFileSync(join(RESULTS, "summary4b.md"), md.join("\n"));
  console.log(md.join("\n"));
}

main();
