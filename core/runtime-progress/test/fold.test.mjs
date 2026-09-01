// fold.test.mjs — runtime-progress regression tests.
// 1) Synthetic fold assertions (deterministic, no fixtures).
// 2) Real-data regression: fold the accepted loop-a1 experiment trace and
//    compare field-by-field against the accepted projection.json (usage
//    excluded: the trace stores dataKeys only for assistant/message, so usage
//    is not reconstructible from the trace — a documented limitation of the
//    trace format, not of the fold).
import { foldProjection } from "../lib/index.js";
import { readFileSync, existsSync } from "node:fs";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok" : "FAIL"} ${label}${ok ? "" : `\n    actual=${JSON.stringify(actual)}\n    expect=${JSON.stringify(expected)}`}`);
}

// ---- 1) synthetic ----
const events = [
  { type: "turn/start", seq: 0, data: { turn: 1 } },
  { type: "step/start", seq: 1, data: { turn: 1, step: 1 } },
  { type: "tool/call", seq: 2, data: { turn: 1, step: 1, callId: "c1", name: "exp_flaky", arguments: "{}" } },
  { type: "tool/result", seq: 3, data: { turn: 1, step: 1, message: { source: { callId: "c1" }, content: [{ type: "tool-result", isError: true }] } } },
  { type: "step/end", seq: 4, data: { turn: 1, step: 1 } },
  { type: "step/start", seq: 5, data: { turn: 1, step: 2 } },
  { type: "tool/call", seq: 6, data: { turn: 1, step: 2, callId: "c2", name: "exp_unobservable", arguments: "{}" } },
  { type: "tool/result", seq: 7, data: { turn: 1, step: 2, message: { source: { callId: "c2" }, content: [{ type: "tool-result", isError: false }] } } },
  { type: "assistant/message", seq: 8, data: { turn: 1, step: 2, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 30 } } },
  { type: "step/end", seq: 9, data: { turn: 1, step: 2 } },
  { type: "turn/end", seq: 10, data: { turn: 1, reason: { kind: "completed" } } },
  { type: "goal/change", seq: 11, data: { kind: "goal/change", version: 1, operation: "create", goal: { id: "g1", revision: 1, phase: "active" }, roundsStarted: 0 } },
];

const p = foldProjection(events);
check("synthetic verdict.turn", p.verdict.turn, "completed");
check("synthetic verdict.execution", p.verdict.execution, "failed");
check("synthetic exp_flaky worldEffect", p.axes.effect.exp_flaky.worldEffect, "failed");
check("synthetic exp_unobservable worldEffect", p.axes.effect.exp_unobservable.worldEffect, "unknown");
check("synthetic unknownFields", p.unknownFields, ["effects.exp_unobservable.worldEffect"]);
check("synthetic goal axis", p.axes.goal, { operation: "create", phase: "active", revision: 1, roundsStarted: 0, support: [11] });
check("synthetic usage", p.usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 30, cacheWriteTokens: 0, reasoningTokens: 0 });

// ---- 2) real-data regression (accepted loop-a1) ----
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const resultsDir = join(fileURLToPath(new URL("../../../experiments/native-pp/results/", import.meta.url)));
const tracePath = join(resultsDir, "loop-a1.events.jsonl");
const projectionPath = join(resultsDir, "loop-a1.projection.json");
if (existsSync(tracePath) && existsSync(projectionPath)) {
  const rows = readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
    .filter((row) => typeof row.seq === "number")
    .sort((a, b) => a.seq - b.seq);
  const folded = foldProjection(rows);
  const accepted = JSON.parse(readFileSync(projectionPath, "utf8")).projection;
  const strip = (obj) => {
    const clone = JSON.parse(JSON.stringify(obj));
    delete clone.usage; // trace limitation: assistant/message dataKeys only
    delete clone.foldStats;
    return clone;
  };
  check("real-data regression (loop-a1, usage excluded)", strip(folded), strip(accepted));
} else {
  console.log("SKIP real-data regression: accepted results not present in repo");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
