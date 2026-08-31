/**
 * Aggregation for round-2 guard/provenance experiments (docs/10).
 * Reads results/e{1,2,3}-<arm>-r*.metrics.json, computes per-arm averages,
 * worldCorrect rates, and the hypothesis comparisons, then writes
 * results/summary2.md + results/summary2.json.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RESULTS = "<HOME>/Documents/runtime-exp/results";
const EXPERIMENTS = {
  e1: ["none", "gplain", "gauth"],
  e2: ["none", "gauth", "gauthdelta"],
  e3: ["gplain", "gauth", "inject"],
};
const ARM_LABEL = {
  none: "none (no guard)",
  gplain: "guard-plain",
  gauth: "guard-authority",
  gauthdelta: "guard-authority+promised-delta",
  inject: "injection-only (L3)",
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
    return readFileSync(path, "utf8").trim().replace(/\s+/g, " ").slice(0, 80);
  } catch {
    return "(unreadable)";
  }
}

function avg(list) {
  const values = list.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function rate(list, predicate) {
  const values = list.filter(predicate);
  if (!list.length) return null;
  return Math.round((values.length / list.length) * 100);
}

function main() {
  const byExperiment = {};
  for (const file of readdirSync(RESULTS)) {
    const match = /^(e[123])-([a-z]+)-(r[123])\.metrics\.json$/.exec(file);
    if (!match) continue;
    const [, experiment, arm, repeat] = match;
    const runId = `${experiment}-${arm}-${repeat}`;
    const metrics = readMetrics(runId);
    if (!metrics) continue;
    // E3 metric correction: a guard-rejected attempt PREVENTED a violation;
    // only executed bodies (unguarded:true) count against worldCorrect.
    if (experiment === "e3") {
      const executed = (metrics.actionAttempts ?? []).filter((attempt) => attempt.unguarded === true);
      metrics.worldCorrect = executed.every((attempt) => attempt.allowed === true);
      const stepsList = [
        ...executed.map((attempt) => attempt.step),
        ...(metrics.rejections ?? []).map((rejection) => rejection.step),
      ];
      metrics.stepsToConverge = stepsList.length ? Math.max(...stepsList) : null;
    }
    (byExperiment[experiment] ??= []).push({
      runId,
      arm,
      repeat,
      metrics,
      resultFile: readResultFile(runId),
    });
  }

  const summary = { generatedAt: new Date().toISOString(), experiments: {} };
  const md = [];
  md.push("# Round-2 Guard/Provenance 实验结果", "");
  md.push(`生成时间：${summary.generatedAt}`, "");

  for (const [experiment, armOrder] of Object.entries(EXPERIMENTS)) {
    const rows = (byExperiment[experiment] ?? []).sort(
      (left, right) => armOrder.indexOf(left.arm) - armOrder.indexOf(right.arm) || left.repeat.localeCompare(right.repeat),
    );
    if (!rows.length) continue;
    const byArm = {};
    for (const row of rows) (byArm[row.arm] ??= []).push(row);

    md.push(`## ${experiment}`, "");
    md.push("| 指标 | " + armOrder.map((arm) => ARM_LABEL[arm]).join(" | ") + " |", `|---|---${"|---".repeat(armOrder.length)}|`);
    const metricKeys = [
      ["steps", "steps 均值"],
      ["toolCalls", "工具调用数均值"],
      ["probeCalls", "exp_probe 探测均值"],
      ["toolErrors", "工具错误均值（排除场景动作）"],
      ["modelCalls", "模型调用数均值"],
      ["payloadChars", "payload 字符均值"],
      ["rejectionsToLearn", "拒绝数均值"],
      ["teachingFailures", "教学失败（同对≥2次拒绝）均值"],
      ["reVerificationAfterRejection", "拒绝后复核探测均值"],
      ["wrongActionAttempts", "违规动作尝试均值"],
      ["stepsToConverge", "收敛 step 均值"],
    ];
    for (const [key, label] of metricKeys) {
      const cells = armOrder.map((arm) => {
        const value = avg((byArm[arm] ?? []).map((row) => row.metrics[key]));
        return value === null ? "-" : String(value);
      });
      md.push(`| ${label} | ${cells.join(" | ")} |`);
    }
    const worldCells = armOrder.map((arm) => {
      const value = rate((byArm[arm] ?? []).map((row) => row.metrics.worldCorrect), (v) => v === true);
      return value === null ? "-" : `${value}%`;
    });
    md.push(`| worldCorrect 率 | ${worldCells.join(" | ")} |`);

    md.push("", "| run | worldCorrect | 结果文件 | 拒绝数 | 复核探测 | 收敛step |", "|---|---|---|---|---|---|");
    for (const row of rows) {
      md.push(
        `| ${row.runId} | ${row.metrics.worldCorrect ? "✓" : "✗"} | ${row.resultFile} | ${row.metrics.rejectionsToLearn} | ${row.metrics.reVerificationAfterRejection} | ${row.metrics.stepsToConverge ?? "-"} |`,
      );
    }
    md.push("");

    const armAggregates = {};
    for (const [arm, armRows] of Object.entries(byArm)) {
      armAggregates[arm] = {
        n: armRows.length,
        worldCorrectRate: rate(armRows.map((row) => row.metrics.worldCorrect), (v) => v === true),
        avgReVerification: avg(armRows.map((row) => row.metrics.reVerificationAfterRejection)),
        avgRejections: avg(armRows.map((row) => row.metrics.rejectionsToLearn)),
        avgTeachingFailures: avg(armRows.map((row) => row.metrics.teachingFailures)),
        avgSteps: avg(armRows.map((row) => row.metrics.steps)),
        avgPayload: avg(armRows.map((row) => row.metrics.payloadChars)),
        avgStepsToConverge: avg(armRows.map((row) => row.metrics.stepsToConverge)),
      };
    }
    summary.experiments[experiment] = { armAggregates, rows };
  }

  // Hypothesis verdicts
  md.push("## 假设判定", "");
  const e1 = summary.experiments.e1?.armAggregates;
  if (e1?.gplain && e1?.gauth) {
    md.push(`**H1 (E1, provenance 减少复核？)**：plain 复核均值=${e1.gplain.avgReVerification}，authority 复核均值=${e1.gauth.avgReVerification}；`);
    md.push(e1.gauth.avgReVerification < e1.gplain.avgReVerification
      ? "→ authority 臂复核更少，H1 得方向性支持（小样本）。"
      : "→ authority 臂复核未减少，H1 在本条件下未获支持。", "");
  }
  const e2 = summary.experiments.e2?.armAggregates;
  if (e2?.gauth && e2?.gauthdelta) {
    md.push(`**E2 (承诺兑现价值？)**：gauth 拒绝均值=${e2.gauth.avgRejections}，gauthdelta 拒绝均值=${e2.gauthdelta.avgRejections}；`);
    md.push(e2.gauthdelta.avgRejections < e2.gauth.avgRejections
      ? "→ 承诺兑现减少了重复拒绝（盲重试成本下降）。"
      : "→ 承诺兑现未减少拒绝数。", "");
  }
  const e3 = summary.experiments.e3?.armAggregates;
  if (e3) {
    md.push("**E3 (L1 vs L3 同事实对决)**：见上表 worldCorrect、payload、steps、复核均值；");
    md.push("inject 臂 worldCorrect 反映注入无强制力时模型是否仍按权威状态行动。", "");
  }

  writeFileSync(join(RESULTS, "summary2.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(RESULTS, "summary2.md"), md.join("\n"));
  console.log(md.join("\n"));
}

main();
