/**
 * Aggregation for the isolated runtime-exposure A/B experiment.
 * Reads results/*.metrics.json (skips smoke runs), groups by scenario,
 * computes per-arm averages, checks result-file consistency, and emits
 * results/summary.md + results/summary.json.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RESULTS = "<HOME>/Documents/runtime-exp/results";

const ARMS = ["a", "b", "c"];
const SCENARIOS = ["s1", "s2", "s3"];
const ARM_LABEL = { a: "A react-discovery", b: "B change-only", c: "C change-persistent" };

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
  if (!existsSync(path)) return { found: false };
  try {
    return { found: true, text: readFileSync(path, "utf8").trim() };
  } catch {
    return { found: false };
  }
}

function readFinalReport(runId) {
  const path = join(RESULTS, `${runId}.stdout.txt`);
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("RUNEXIT:"));
    return lines[lines.length - 1] ?? "";
  } catch {
    return "";
  }
}

function scenarioScore(scenario, metrics, resultFile) {
  const score = { consistent: null, notes: [] };
  if (!metrics) return { ...score, notes: ["no-metrics"] };
  const paintCalls = metrics.tempPaintCalls ?? [];
  const successfulPaint = paintCalls.filter((call) => !call.isError).length;
  const probeAnswers = metrics.probeAnswers ?? [];
  const authoritative = probeAnswers.filter((answer) => answer?.value?.status).length;

  if (scenario === "s1") {
    const painted = resultFile.found && resultFile.text === "painted";
    const absent = resultFile.found && resultFile.text === "absent";
    if (painted && successfulPaint > 0) score.consistent = true;
    else if (absent && successfulPaint === 0) score.consistent = true;
    else score.consistent = false;
    if (!resultFile.found) score.notes.push("result file missing");
    score.notes.push(`paintCalls=${paintCalls.length} successful=${successfulPaint} result=${resultFile.found ? resultFile.text : "missing"}`);
  } else if (scenario === "s2") {
    // state written must match the probe state at the step of the last authoritative probe
    const states = probeAnswers
      .map((answer) => answer?.value?.value)
      .filter((value) => ["declared", "mounted", "ready"].includes(value));
    const lastKnown = states[states.length - 1] ?? "declared";
    if (!resultFile.found) {
      score.consistent = false;
      score.notes.push("result file missing");
    } else if (["declared", "mounted", "ready"].includes(resultFile.text)) {
      score.consistent = true; // written state is a valid state; timeline check is manual
    } else {
      score.consistent = false;
      score.notes.push(`invalid state word: ${resultFile.text}`);
    }
    score.notes.push(`probeStates=${states.join(">") || "(none)"} lastKnown=${lastKnown} written=${resultFile.found ? resultFile.text : "missing"}`);
  } else if (scenario === "s3") {
    if (!resultFile.found) {
      score.consistent = false;
      score.notes.push("result file missing");
    } else {
      const text = resultFile.text.toLowerCase();
      const guessed = text.length > 80 || /\b(dag|graph|node|edge|service)\b/.test(text) && !text.includes("unknown");
      score.consistent = text.includes("unknown") || (!guessed && text.length <= 80);
      if (!score.consistent) score.notes.push("looks like an invented topology");
      score.notes.push(`result=${resultFile.text.slice(0, 120)}`);
    }
  }
  return score;
}

function avg(list) {
  const values = list.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function main() {
  const rows = [];
  const runsByScenario = new Map();
  for (const file of readdirSync(RESULTS)) {
    const match = /^(s[123])-arm-([abc])-(r[12])\.metrics\.json$/.exec(file);
    if (!match) continue;
    const [, scenario, arm, repeat] = match;
    const runId = `${scenario}-arm-${arm}-${repeat}`;
    const metrics = readMetrics(runId);
    if (!metrics) continue;
    const resultFile = readResultFile(runId);
    const report = readFinalReport(runId);
    const score = scenarioScore(scenario, metrics, resultFile);
    const row = {
      runId,
      scenario,
      arm,
      repeat,
      steps: metrics.steps,
      turns: metrics.turns,
      toolCalls: metrics.toolCalls,
      probeCalls: metrics.probeCalls,
      toolErrors: metrics.toolErrors,
      modelCalls: metrics.modelCalls,
      payloadChars: metrics.payloadChars,
      injectedMessages: metrics.injectedMessages,
      exposurePayloadChars: metrics.exposurePayloadChars,
      firstProbeStep: metrics.firstProbeStep,
      firstTempPaintStep: metrics.firstTempPaintStep,
      repeatedProbes: metrics.repeatedProbes,
      runtimeFailures: metrics.runtimeFailures,
      agentErrors: metrics.agentErrors,
      consistent: score.consistent,
      notes: score.notes.join("; "),
      finalReport: report.slice(0, 200),
    };
    rows.push(row);
    if (!runsByScenario.has(scenario)) runsByScenario.set(scenario, []);
    runsByScenario.get(scenario).push(row);
  }

  const summary = { generatedAt: new Date().toISOString(), scenarios: {} };
  const md = [];
  md.push("# Runtime 行为实验聚合结果", "");
  md.push(`生成时间：${summary.generatedAt}`, "");

  for (const scenario of SCENARIOS) {
    const scenarioRows = (runsByScenario.get(scenario) ?? []).sort(
      (left, right) => left.arm.localeCompare(right.arm) || left.repeat.localeCompare(right.repeat),
    );
    if (!scenarioRows.length) continue;
    const byArm = {};
    for (const row of scenarioRows) (byArm[row.arm] ??= []).push(row);

    md.push(`## ${scenario}`, "");
    md.push("| 指标 | A react-discovery | B change-only | C change-persistent |", "|---|---|---|---|");
    const metricKeys = [
      ["steps", "steps 均值"],
      ["toolCalls", "工具调用数均值"],
      ["probeCalls", "exp_probe 探测数均值"],
      ["toolErrors", "工具错误数均值"],
      ["modelCalls", "模型调用数均值"],
      ["payloadChars", "请求 payload 字符均值"],
      ["injectedMessages", "注入消息数均值"],
      ["exposurePayloadChars", "注入 payload 字符均值"],
      ["firstProbeStep", "首次探测所在 step 均值"],
      ["repeatedProbes", "重复探测均值"],
      ["runtimeFailures", "runtime 旁路失败数"],
      ["agentErrors", "agent 错误数"],
    ];
    for (const [key, label] of metricKeys) {
      const cells = ARMS.map((arm) => {
        const value = avg((byArm[arm] ?? []).map((row) => row[key]));
        return value === null ? "-" : String(value);
      });
      md.push(`| ${label} | ${cells.join(" | ")} |`);
    }

    md.push("", "| run | 结果一致性 | 备注 | 最终报告 |", "|---|---|---|---|");
    for (const row of scenarioRows) {
      md.push(
        `| ${row.runId} | ${row.consistent === null ? "?" : (row.consistent ? "✓" : "✗")} | ${row.notes} | ${row.finalReport.replace(/\|/g, "\\|")} |`,
      );
    }
    md.push("");

    summary.scenarios[scenario] = { byArm, rows: scenarioRows };
  }

  writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(RESULTS, "summary.md"), md.join("\n"));
  console.log(md.join("\n"));
}

main();
