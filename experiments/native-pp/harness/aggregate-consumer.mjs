// aggregate-consumer.mjs — baseline vs progress-aware comparison for the
// consumer experiment. Metrics per cell from world.json / metrics.json /
// projection.json / policy.json / token-index.json.
// Usage: node aggregate-consumer.mjs <resultsDir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const resultsDir = process.argv[2];

function load(name) {
  const path = join(resultsDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const index = load("token-index.json") ?? [];

const cells = [];
for (const scenario of ["loop", "nonatomic", "pretend", "noop"]) {
  for (const armRun of ["b1", "b2", "b3", "b4", "a1", "a2", "a3", "a4"]) {
    const run = `${scenario}-${armRun}`;
    const world = load(`${run}.world.json`);
    if (!world) continue;
    const metrics = load(`${run}.metrics.json`);
    const projection = load(`${run}.projection.json`);
    const policy = load(`${run}.policy.json`);
    const tokens = index.find((row) => row.run === run) ?? {};
    const realKey =
      scenario === "loop" ? "exp_flakyCalls" :
      scenario === "nonatomic" ? "exp_applyCalls" :
      scenario === "pretend" ? "exp_pretendCalls" :
      "exp_noopCalls";
    cells.push({
      run,
      scenario,
      arm: armRun.startsWith("b") ? "baseline" : "aware",
      retries: world.retries,
      realExecutions: world[realKey] ?? null,
      duplicateSideEffects: world.exp_applyWrites ?? 0,
      taskSuccess: world.taskArtifactExists,
      worldCorrect: scenario === "pretend" ? world.applied : null,
      silentError: scenario === "pretend" ? world.silentError : null,
      checkCalls: world.exp_checkCalls ?? 0,
      repairCalls: world.exp_repairCalls ?? 0,
      toolErrors: metrics?.toolErrors ?? null,
      policyDenied: metrics?.policyDeniedCalls ?? null,
      modelCalls: metrics?.modelCalls ?? null,
      steps: projection?.projection?.axes?.execution?.steps ?? null,
      turnOutcome: projection?.projection?.axes?.execution?.turnOutcome ?? null,
      interventions: policy?.interventions?.length ?? (policy ? 0 : null),
      cacheReadTokens: tokens.cacheReadTokens ?? null,
      inputTokens: tokens.inputTokens ?? null,
      outputTokens: tokens.outputTokens ?? null,
    });
  }
}

function avg(list, field) {
  const values = list.map((c) => c[field]).filter((v) => v !== null && v !== undefined);
  if (!values.length) return "-";
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

const lines = [];
lines.push("# Consumer 实验对比（baseline vs progress-aware）", "");
lines.push("指标口径：retries=exp_* 工具重复调用数（world）；realExecutions=工具体真实执行次数；");
lines.push("duplicateSideEffects=exp_apply 世界副作用写入次数；cacheReadTokens=事后回溯真实 usage。", "");

for (const scenario of ["loop", "nonatomic"]) {
  const base = cells.filter((c) => c.scenario === scenario && c.arm === "baseline");
  const aware = cells.filter((c) => c.scenario === scenario && c.arm === "aware");
  if (!base.length || !aware.length) continue;
  lines.push(`## ${scenario}`, "");
  const header = "| run | retries | realExec | dupSideEffects | taskOk | toolErrors | policyDenied | steps | modelCalls | cacheRead | input | output | turn |";
  lines.push(header, "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const c of [...base, ...aware]) {
    lines.push(`| ${c.run} | ${c.retries} | ${c.realExecutions} | ${c.duplicateSideEffects} | ${c.taskSuccess} | ${c.toolErrors} | ${c.policyDenied} | ${c.steps} | ${c.modelCalls} | ${c.cacheReadTokens?.toLocaleString() ?? "-"} | ${c.inputTokens?.toLocaleString() ?? "-"} | ${c.outputTokens?.toLocaleString() ?? "-"} | ${c.turnOutcome} |`);
  }
  lines.push("");
  lines.push(`| 均值 | baseline ${avg(base, "retries")} / aware ${avg(aware, "retries")} | baseline ${avg(base, "realExecutions")} / aware ${avg(aware, "realExecutions")} | baseline ${avg(base, "duplicateSideEffects")} / aware ${avg(aware, "duplicateSideEffects")} | ${base.every((c) => c.taskSuccess) ? "all" : "mixed"} / ${aware.every((c) => c.taskSuccess) ? "all" : "mixed"} | baseline ${avg(base, "toolErrors")} / aware ${avg(aware, "toolErrors")} | baseline ${avg(base, "policyDenied")} / aware ${avg(aware, "policyDenied")} | baseline ${avg(base, "steps")} / aware ${avg(aware, "steps")} | baseline ${avg(base, "modelCalls")} / aware ${avg(aware, "modelCalls")} | baseline ${avg(base, "cacheReadTokens").toLocaleString()} / aware ${avg(aware, "cacheReadTokens").toLocaleString()} | baseline ${avg(base, "inputTokens").toLocaleString()} / aware ${avg(aware, "inputTokens").toLocaleString()} | baseline ${avg(base, "outputTokens").toLocaleString()} / aware ${avg(aware, "outputTokens").toLocaleString()} | |`);
  lines.push("");
}

// noop + control
const noop = cells.filter((c) => c.scenario === "noop");
if (noop.length) {
  lines.push("## noop（success+stalled，record-only）", "");
  lines.push(`| run | arm | realExecutions | turn | policyDenied |`, "|---|---|---:|---:|---:|");
  for (const c of noop) lines.push(`| ${c.run} | ${c.arm} | ${c.realExecutions} | ${c.turnOutcome} | ${c.policyDenied} |`);
  lines.push("");
}

// pretend: success+claimed -> investigate/reconcile
const pretend = cells.filter((c) => c.scenario === "pretend");
if (pretend.length) {
  lines.push("## pretend（success+claimed，investigate/reconcile）", "");
  lines.push("| run | arm | pretendCalls | checkCalls | repairCalls | applied(世界正确) | silentError | interventions | steps | modelCalls | cacheRead |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const c of pretend) {
    lines.push(`| ${c.run} | ${c.arm} | ${c.realExecutions} | ${c.checkCalls} | ${c.repairCalls} | ${c.worldCorrect} | ${c.silentError} | ${c.interventions ?? "-"} | ${c.steps} | ${c.modelCalls} | ${c.cacheReadTokens?.toLocaleString() ?? "-"} |`);
  }
  const base = pretend.filter((c) => c.arm === "baseline");
  const aware = pretend.filter((c) => c.arm === "aware");
  lines.push("");
  lines.push(`- 世界正确率（applied=true）：baseline ${base.filter((c) => c.worldCorrect).length}/${base.length}，aware ${aware.filter((c) => c.worldCorrect).length}/${aware.length}`);
  lines.push(`- 静默错误（谎报成功且未修复）：baseline ${base.filter((c) => c.silentError).length}/${base.length}，aware ${aware.filter((c) => c.silentError).length}/${aware.length}`);
}

const ctrl = load("ok-ctrl1.world.json");
if (ctrl) {
  const ctrlPolicy = load("ok-ctrl1.policy.json");
  lines.push("## ok 对照（success+progressed，aware 臂不介入）", "");
  lines.push(`- world: exp_reportCalls=${ctrl.exp_reportCalls}, taskArtifactExists=${ctrl.taskArtifactExists}`);
  lines.push(`- policy interventions=${ctrlPolicy?.interventions?.length ?? 0}（预期 0）`);
}

const out = join(resultsDir, "consumer-comparison.md");
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
