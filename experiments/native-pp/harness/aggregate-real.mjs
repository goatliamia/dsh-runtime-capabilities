// aggregate-real.mjs — real-scenario comparison (creative mode round).
// real3: success-but-not-effective (investigate/reconcile).
// real6: normal-task negative control (expect ~0 interventions, no regression).
// Usage: node aggregate-real.mjs <resultsDir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const resultsDir = process.argv[2];

function load(name) {
  const path = join(resultsDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const index = load("token-index.json") ?? [];
const lines = [];
lines.push("# 真实场景对比（creative mode: standard preset, 完整工具面）", "");

function countSteps(run) {
  // Baseline arms have no projection bundle; derive steps from the fixture's
  // own raw trace (step/start record count).
  const path = join(resultsDir, `${run}.events.jsonl`);
  if (!existsSync(path)) return null;
  let steps = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.includes('"type":"step/start"')) steps += 1;
  }
  return steps;
}

function cellRow(run) {
  const world = load(`${run}.world.json`);
  const metrics = load(`${run}.metrics.json`);
  const projection = load(`${run}.projection.json`);
  const policy = load(`${run}.policy.json`);
  const tokens = index.find((row) => row.run === run) ?? {};
  return {
    run,
    arm: metrics?.arm ?? null,
    worldCorrect: run.startsWith("real3") ? world?.real3?.worldCorrect : world?.real6?.worldCorrect,
    silentFailure: run.startsWith("real3") ? world?.real3?.silentFailure : null,
    verifyResult: world?.real3?.verifyResult ?? null,
    reloaded: world?.real3?.reloaded ?? null,
    testResult: world?.real6?.testResult ?? null,
    taskArtifact: world?.taskArtifactExists ?? null,
    steps: projection?.projection?.axes?.execution?.steps ?? countSteps(run),
    modelCalls: metrics?.modelCalls ?? null,
    toolCalls: metrics?.toolCalls ?? null,
    toolErrors: metrics?.toolErrors ?? null,
    interventions: policy?.interventions?.length ?? (policy ? 0 : null),
    cacheReadTokens: tokens.cacheReadTokens ?? null,
    inputTokens: tokens.inputTokens ?? null,
    outputTokens: tokens.outputTokens ?? null,
  };
}

// ---------------- real3 ----------------
lines.push("## real3：成功但未生效（edit → build ok → runtime stale）", "");
lines.push("| run | arm | 世界正确 | 静默失败 | verify 结果 | reload 过 | steps | modelCalls | interventions | cacheRead | input | output |", "|---|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|");
for (const run of ["real3-b1", "real3-b2", "real3-a1", "real3-a2"]) {
  const c = cellRow(run);
  if (!c.arm) continue;
  lines.push(`| ${run} | ${c.arm} | ${c.worldCorrect} | ${c.silentFailure} | ${c.verifyResult ?? "-"} | ${c.reloaded} | ${c.steps} | ${c.modelCalls} | ${c.interventions} | ${c.cacheReadTokens?.toLocaleString() ?? "-"} | ${c.inputTokens?.toLocaleString() ?? "-"} | ${c.outputTokens?.toLocaleString() ?? "-"} |`);
}
lines.push("");

// ---------------- real6 ----------------
lines.push("## real6：正常任务（负面对照，要求不误介入）", "");
lines.push("| run | arm | 测试结果 | 任务产物 | steps | modelCalls | interventions | cacheRead | input | output |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const run of ["real6-b1", "real6-b2", "real6-a1", "real6-a2"]) {
  const c = cellRow(run);
  if (!c.arm) continue;
  lines.push(`| ${run} | ${c.arm} | ${c.testResult ?? "-"} | ${c.taskArtifact} | ${c.steps} | ${c.modelCalls} | ${c.interventions} | ${c.cacheReadTokens?.toLocaleString() ?? "-"} | ${c.inputTokens?.toLocaleString() ?? "-"} | ${c.outputTokens?.toLocaleString() ?? "-"} |`);
}
lines.push("");

// ---------------- real2 ----------------
lines.push("## real2：非原子部署（确认超时但已部署）", "");
lines.push("| run | arm | 部署次数 | 重复副作用 | 世界正确(=1次) | policyDenied | steps | modelCalls | cacheRead |", "|---|---|---:|---:|---:|---:|---:|---:|---:|");
for (const run of ["real2-b1", "real2-b2", "real2-a1", "real2-a2"]) {
  const world = load(`${run}.world.json`);
  const metrics = load(`${run}.metrics.json`);
  const tokens = index.find((row) => row.run === run) ?? {};
  const c = cellRow(run);
  if (!c.arm) continue;
  lines.push(`| ${run} | ${c.arm} | ${world?.real2?.deployAttempts ?? "-"} | ${world?.real2?.duplicateSideEffects ?? "-"} | ${world?.real2?.worldCorrect} | ${metrics?.policyDeniedCalls ?? 0} | ${c.steps} | ${c.modelCalls} | ${tokens.cacheReadTokens?.toLocaleString() ?? "-"} |`);
}
lines.push("");

// ---------------- real4 ----------------
lines.push("## real4：异步 job 轮询（polling vs event/state-aware）", "");
lines.push("| run | arm | status 轮询次数 | 最终状态 | 世界正确 | job 事件发出 | interventions | steps | modelCalls | cacheRead |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const run of ["real4-b1", "real4-b2", "real4-a1", "real4-a2"]) {
  const world = load(`${run}.world.json`);
  const policy = load(`${run}.policy.json`);
  const tokens = index.find((row) => row.run === run) ?? {};
  const c = cellRow(run);
  if (!c.arm) continue;
  lines.push(`| ${run} | ${c.arm} | ${world?.real4?.statusPolls ?? "-"} | ${world?.real4?.jobState ?? "-"} | ${world?.real4?.worldCorrect} | ${world?.real4?.jobEventEmitted} | ${policy?.interventions?.length ?? (policy ? 0 : null)} | ${c.steps} | ${c.modelCalls} | ${tokens.cacheReadTokens?.toLocaleString() ?? "-"} |`);
}

const out = join(resultsDir, "real-comparison.md");
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
