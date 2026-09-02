// aggregate-rc2.mjs — round-2 boundary + chain aggregation (docs/19 follow-up).
// Scans the round-2 cell list, merges continuation metrics + fixture metrics +
// world truth + retroactive token usage (decode-zstd, zero in-loop metering),
// and writes results/rc2-comparison.md + rc2-token-index.json.
// Usage: node aggregate-rc2.mjs <resultsDir> <home>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { effectiveSessionId } from "./recovered-session-ids.mjs";

const resultsDir = process.argv[2];
const home = process.argv[3];
const sessionsRoot = join(home, "sessions");

const ROUND2_CELLS = [
  "rc-c1f", "rc-cp1", "rc-cp2",
  "rccancel-x1", "rccancel-x2", "rccancel-xm1", "rccancel-xm2",
  "rcguard-g1", "rcguard-g2",
  "rcmulti-m1", "rcmulti-m2",
  "rc-b3",
  "rcbait-t1", "rcbait-t2",
  "rcnofacts-n1", "rcnofacts-n2",
  "rccontrol-ctrl2",
  "rchain-h1", "rchain-h2",
];

function projectKey(cwd) {
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

function encodeSegment(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

function decodeFile(file) {
  const buf = readFileSync(file);
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let idx = buf.indexOf(MAGIC);
  while (idx !== -1) {
    starts.push(idx);
    idx = buf.indexOf(MAGIC, idx + 4);
  }
  let text = "";
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
    try {
      text += zstdDecompressSync(buf.subarray(start, end), { maxOutputLength: 256 * 1024 * 1024 }).toString("utf8");
    } catch (error) {
      text += `\n[FRAME-ERROR ${i}] ${error.message}\n`;
    }
  }
  return text;
}

function sumTokens(pattern, text) {
  let total = 0;
  const re = new RegExp(pattern, "g");
  let match;
  while ((match = re.exec(text)) !== null) total += Number(match[1]);
  return total;
}

const { decodeStorageRecord, KNOWN_SESSION_EVENT_TYPES } = await import(
  pathToFileURL("<HOME>/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js").href
);
const projectDir = join(sessionsRoot, projectKey(resultsDir));
const rows = [];

for (const run of ROUND2_CELLS) {
  const metricsPath = join(resultsDir, `${run}.metrics.json`);
  const worldPath = join(resultsDir, `${run}.world.json`);
  const contPath = join(resultsDir, `${run}.continuation.json`);
  if (!existsSync(metricsPath)) {
    rows.push({ run, missing: true });
    continue;
  }
  const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
  const world = existsSync(worldPath) ? JSON.parse(readFileSync(worldPath, "utf8")) : null;
  const cont = existsSync(contPath) ? JSON.parse(readFileSync(contPath, "utf8")) : null;
  const sessionId = effectiveSessionId(run, metrics.sessionId);

  const row = {
    run,
    arm: metrics.arm,
    scenario: metrics.scenario,
    sessionId,
    modelCalls: metrics.modelCalls ?? null,
    toolCalls: metrics.toolCalls ?? null,
    toolErrors: metrics.toolErrors ?? null,
    guardDenials: metrics.guardDenials ?? 0,
    cancelInjected: metrics.cancelInjected ?? 0,
    staleBumps: metrics.staleBumps ?? 0,
    steps: null,
    turnReason: null,
    compactionEvents: 0,
    confounded: false,
    officialReplayCompatible: null,
    continuation: cont
      ? {
          intents: cont.metrics.intents,
          dispatches: cont.metrics.dispatches,
          discards: cont.metrics.discards,
          blocked: cont.metrics.blocked,
          aborted: cont.metrics.aborted,
          ambiguous: cont.metrics.ambiguous,
          chainRuns: cont.metrics.chainRuns,
          chainHops: cont.metrics.chainHops,
          decisions: cont.metrics.decisions,
        }
      : null,
    world: world ? (world.rc ?? world.rccontrol ?? null) : null,
    taskArtifactExists: world?.taskArtifactExists ?? null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
  };

  if (sessionId) {
    const logPath = join(projectDir, encodeSegment(sessionId), "session.jsonl.zstd");
    if (existsSync(logPath)) {
      const text = decodeFile(logPath);
      const events = [];
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        const obj = JSON.parse(line);
        if (obj.type === "session") continue;
        try {
          events.push(...decodeStorageRecord(obj));
        } catch {
          /* skip unexpandable row */
        }
      }
      row.steps = events.filter((e) => e.type === "step/start").length;
      const lastTurnEnd = events.filter((e) => e.type === "turn/end").at(-1);
      row.turnReason = lastTurnEnd?.data?.reason?.kind ?? null;
      row.compactionEvents = events.filter((e) => ["compaction/start", "compaction/end", "compaction/summary", "compaction/prune"].includes(e.type)).length;
      row.confounded = row.compactionEvents > 0;
      row.officialReplayCompatible = events.every((e) => KNOWN_SESSION_EVENT_TYPES.has(e.type) || e.ignorable === true);
      row.inputTokens = sumTokens(/"inputTokens":(\d+)/, text);
      row.outputTokens = sumTokens(/"outputTokens":(\d+)/, text);
      row.cacheReadTokens = sumTokens(/"cacheReadTokens":(\d+)/, text);
      row.cacheWriteTokens = sumTokens(/"cacheWriteTokens":(\d+)/, text);
      row.reasoningTokens = sumTokens(/"reasoningTokens":(\d+)/, text);
    }
  }
  rows.push(row);
}

writeFileSync(join(resultsDir, "rc2-token-index.json"), `${JSON.stringify(rows, null, 2)}\n`);

const md = [];
md.push("# Runtime Continuation — round 2 boundary + chain (generated)");
md.push("");
md.push("| run | arm | scenario | modelCalls | steps | intent | disp | disc | blk | abrt | amb | chainRuns | chainHops | reload(w) | rollback(w) | aligned | turn | confounded | replay | guardDeny | cancelInj | input | output | cacheRead | reasoning |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  if (r.missing) {
    md.push(`| ${r.run} | MISSING | | | | | | | | | | | | | | | | | | | | | | |`);
    continue;
  }
  const w = r.world ?? {};
  const aligned = r.scenario === "rccontrol" ? w.worldCorrect : w.worldAligned;
  md.push(
    `| ${r.run} | ${r.arm} | ${r.scenario} | ${r.modelCalls} | ${r.steps} | ${r.continuation?.intents ?? "-"} | ${r.continuation?.dispatches ?? "-"} | ${r.continuation?.discards ?? "-"} | ${r.continuation?.blocked ?? "-"} | ${r.continuation?.aborted ?? "-"} | ${r.continuation?.ambiguous ?? "-"} | ${r.continuation?.chainRuns ?? "-"} | ${r.continuation?.chainHops ?? "-"} | ${w.reloadCount ?? "-"} | ${w.rollbackCount ?? "-"} | ${aligned ?? "-"} | ${r.turnReason ?? "-"} | ${r.confounded ? "YES" : "no"} | ${r.officialReplayCompatible === null ? "-" : r.officialReplayCompatible ? "yes" : "REFUSED"} | ${r.guardDenials} | ${r.cancelInjected} | ${r.inputTokens ?? "-"} | ${r.outputTokens ?? "-"} | ${r.cacheReadTokens ?? "-"} | ${r.reasoningTokens ?? "-"} |`,
  );
}
md.push("");
const total = (field) => rows.filter((r) => !r.missing).reduce((s, r) => s + (r[field] ?? 0), 0);
md.push(`## Totals (${rows.filter((r) => !r.missing).length} round-2 cells, retroactive decode-zstd, zero in-loop metering)`);
md.push("");
md.push(`- input ${total("inputTokens")} / output ${total("outputTokens")} / cacheRead ${total("cacheReadTokens")} / cacheWrite ${total("cacheWriteTokens")} / reasoning ${total("reasoningTokens")}`);
writeFileSync(join(resultsDir, "rc2-comparison.md"), `${md.join("\n")}\n`);
console.log(JSON.stringify(rows, null, 2));
