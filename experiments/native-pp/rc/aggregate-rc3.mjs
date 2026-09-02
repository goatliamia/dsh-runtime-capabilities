// aggregate-rc3.mjs — round 3: instruction continuity aggregation.
// Merges continuation metrics + fixture metrics + world truth + retroactive
// token usage for the 7 rccont cells; writes rc3-comparison.md + rc3-token-index.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { effectiveSessionId } from "./recovered-session-ids.mjs";

const resultsDir = process.argv[2];
const home = process.argv[3];
const sessionsRoot = join(home, "sessions");

const CELLS = ["rccont-p1a1", "rccont-p1a2", "rccont-p2b1", "rccont-p2b2", "rccont-p3c1", "rccont-p3c2", "rccont-base1"];

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
          decisions: cont.metrics.decisions,
        }
      : null,
    world: world?.rc ?? null,
    taskArtifactExists: world?.taskArtifactExists ?? null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
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
          /* skip unexpandable */
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
      row.reasoningTokens = sumTokens(/"reasoningTokens":(\d+)/, text);
    }
  }
  rows.push(row);
}

writeFileSync(join(resultsDir, "rc3-token-index.json"), `${JSON.stringify(rows, null, 2)}\n`);

const md = [];
md.push("# Runtime Continuation — round 3 instruction continuity (generated)");
md.push("");
md.push("| run | prompt | modelCalls | steps | intent | disp | guardDeny | reload(w) | aligned | task | turn | confounded | replay | input | output | cacheRead | reasoning |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const w = r.world ?? {};
  md.push(
    `| ${r.run} | ${r.run.split("-")[1]} | ${r.modelCalls} | ${r.steps} | ${r.continuation?.intents ?? "-"} | ${r.continuation?.dispatches ?? "-"} | ${r.continuation?.guardDenials ?? "-"} | ${w.reloadCount ?? "-"} | ${w.worldAligned ?? "-"} | ${r.taskArtifactExists ?? "-"} | ${r.turnReason ?? "-"} | ${r.confounded ? "YES" : "no"} | ${r.officialReplayCompatible === null ? "-" : r.officialReplayCompatible ? "yes" : "REFUSED"} | ${r.inputTokens ?? "-"} | ${r.outputTokens ?? "-"} | ${r.cacheReadTokens ?? "-"} | ${r.reasoningTokens ?? "-"} |`,
  );
}
md.push("");
const total = (field) => rows.reduce((s, r) => s + (r[field] ?? 0), 0);
md.push(`## Totals (${rows.length} cells)`);
md.push("");
md.push(`- input ${total("inputTokens")} / output ${total("outputTokens")} / cacheRead ${total("cacheReadTokens")} / reasoning ${total("reasoningTokens")}`);
writeFileSync(join(resultsDir, "rc3-comparison.md"), `${md.join("\n")}\n`);
console.log(JSON.stringify(rows, null, 2));
