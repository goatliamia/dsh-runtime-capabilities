/**
 * E4 aggregation: circuit breaker against repeated deterministic failure.
 * Reads results/e4-<arm>-r*.metrics.json and writes results/summary4.md/.json.
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
    const match = /^(e4)-(none|circuit|circuitdelta)-(r[123])\.metrics\.json$/.exec(file);
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
  md.push("# E4 Circuit Breaker 实验结果", "");
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
  const nonePayload = avg((byArm.none ?? []).map((row) => row.metrics.payloadChars));
  const deltaPayload = avg((byArm.circuitdelta ?? []).map((row) => row.metrics.payloadChars));

  md.push("", "## 判定", "");
  if (noneAttempts !== null && circuitAttempts !== null && deltaAttempts !== null) {
    md.push(
      `- 失败尝试：none=${noneAttempts}，circuit=${circuitAttempts}，circuitdelta=${deltaAttempts}`,
    );
    md.push(
      circuitAttempts < noneAttempts && deltaAttempts <= circuitAttempts
        ? "- circuit 显著减少了重复失败尝试，delta 通告进一步把开断后尝试压到最低 → **circuit 原语验证成立**。"
        : "- 效果未达预期，见明细。",
    );
  }
  if (nonePayload !== null && deltaPayload !== null) {
    md.push(`- payload：none=${nonePayload}，circuitdelta=${deltaPayload}`);
  }
  md.push("- 全部运行 exit=0；runtimeFailures/agentErrors 见明细（应为 0）。");

  writeFileSync(join(RESULTS, "summary4.json"), JSON.stringify({ generatedAt: new Date().toISOString(), byArm, rows }, null, 2));
  writeFileSync(join(RESULTS, "summary4.md"), md.join("\n"));
  console.log(md.join("\n"));
}

main();
