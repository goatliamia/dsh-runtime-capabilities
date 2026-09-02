// aggregate-rc4.mjs — round 4: Intent/Event/Runtime/Model ownership boundary.
// Merges continuation + fixture + world + retroactive tokens for the rcc4
// cells, and reports chain accounting (hops, per-hop events, staleness).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { effectiveSessionId } from "./recovered-session-ids.mjs";

const resultsDir = process.argv[2];
const home = process.argv[3];
const sessionsRoot = join(home, "sessions");

const CELLS = [
  "rcc4-aa1", "rcc4-aa2", "rcc4-am1", "rcc4-am2",
  "rcc4-ba1", "rcc4-ba2", "rcc4-bm1", "rcc4-bm2",
  "rcc4-ca1", "rcc4-ca2", "rcc4-cm1", "rcc4-cm2",
  "rcc4-da1",
  "rcc4-chain1", "rcc4-stale1", "rcc4-stale2",
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

for (const run of CELLS) {
  const metricsPath = join(resultsDir, `${run}.metrics.json`);
  const worldPath = join(resultsDir, `${run}.world.json`);
  const contPath = join(resultsDir, `${run}.continuation.json`);
  const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
  const world = existsSync(worldPath) ? JSON.parse(readFileSync(worldPath, "utf8")) : null;
  const cont = existsSync(contPath) ? JSON.parse(readFileSync(contPath, "utf8")) : null;
  const sessionId = effectiveSessionId(run, metrics.sessionId);

  const row = {
    run,
    arm: metrics.arm,
    sessionId,
    modelCalls: metrics.modelCalls ?? null,
    toolCalls: metrics.toolCalls ?? null,
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
          guardDenials: cont.metrics.guardDenials,
          chainRuns: cont.metrics.chainRuns,
          chainHops: cont.metrics.chainHops,
          decisions: cont.metrics.decisions,
        }
      : null,
    world: world?.rc ?? null,
    staleBumps: metrics.staleBumps ?? 0,
    taskArtifactExists: world?.taskArtifactExists ?? null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    reasoningTokens: null,
    continuationRecords: null,
    chainEventSpans: null,
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
          /* skip unexpandable */
        }
      }
      row.steps = events.filter((e) => e.type === "step/start").length;
      const lastTurnEnd = events.filter((e) => e.type === "turn/end").at(-1);
      row.turnReason = lastTurnEnd?.data?.reason?.kind ?? null;
      row.compactionEvents = events.filter((e) => ["compaction/start", "compaction/end", "compaction/summary", "compaction/prune"].includes(e.type)).length;
      row.confounded = row.compactionEvents > 0;
      row.officialReplayCompatible = events.every((e) => KNOWN_SESSION_EVENT_TYPES.has(e.type) || e.ignorable === true);
      const contEvents = events.filter((e) => e.type === "runtime/continuation");
      row.continuationRecords = contEvents.map((e) => ({ seq: e.seq, contract: e.data?.contract, outcome: e.data?.outcome, callSeq: e.data?.callSeq ?? null, resultSeq: e.data?.resultSeq ?? null }));
      if (contEvents.length >= 2) {
        row.chainEventSpans = contEvents.map((e) => ({ seq: e.seq, eventsBetweenPrev: e.seq - (contEvents[contEvents.indexOf(e) - 1]?.seq ?? -1) }));
      }
      row.inputTokens = sumTokens(/"inputTokens":(\d+)/, text);
      row.outputTokens = sumTokens(/"outputTokens":(\d+)/, text);
      row.cacheReadTokens = sumTokens(/"cacheReadTokens":(\d+)/, text);
      row.reasoningTokens = sumTokens(/"reasoningTokens":(\d+)/, text);
    }
  }
  rows.push(row);
}

writeFileSync(join(resultsDir, "rc4-token-index.json"), `${JSON.stringify(rows, null, 2)}\n`);

const md = [];
md.push("# Runtime Continuation — round 4 ownership boundary (generated)");
md.push("");
md.push("| run | arm | prompt | world-start | modelCalls | intent | disp | guardDeny | reload(w) | health(w) | aligned | task | turn | confounded | staleBumps | chainHops | input | cacheRead |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const w = r.world ?? {};
  md.push(
    `| ${r.run} | ${r.arm} | ${r.run.split("-")[1]} | ${w.artifactRev === w.runtimeRev ? "aligned" : "mis"} | ${r.modelCalls} | ${r.continuation?.intents ?? "-"} | ${r.continuation?.dispatches ?? "-"} | ${r.continuation?.guardDenials ?? "-"} | ${w.reloadCount ?? "-"} | ${w.healthCheck ?? "-"} | ${w.worldAligned ?? "-"} | ${r.taskArtifactExists ?? "-"} | ${r.turnReason ?? "-"} | ${r.confounded ? "YES" : "no"} | ${r.staleBumps} | ${r.continuation?.chainHops ?? "-"} | ${r.inputTokens ?? "-"} | ${r.cacheReadTokens ?? "-"} |`,
  );
}
md.push("");
const total = (field) => rows.reduce((s, r) => s + (r[field] ?? 0), 0);
md.push(`## Totals (${rows.length} cells)`);
md.push("");
md.push(`- input ${total("inputTokens")} / output ${total("outputTokens")} / cacheRead ${total("cacheReadTokens")} / reasoning ${total("reasoningTokens")}`);
writeFileSync(join(resultsDir, "rc4-comparison.md"), `${md.join("\n")}\n`);
console.log(JSON.stringify(rows, null, 2));
