// verify-fold.mjs — E2 P2: an INDEPENDENT fold implementation over the
// PERSISTED session log, read through a different path than the replay runner:
// this script decodes the zstd frames itself, expands packed chunk rows with
// the official decodeStorageRecord, and folds with independently written logic
// (two-pass callId map). Compares field-by-field against the live
// <run>.projection.json (excluding time-derived foldMs/hostTiming/writtenAt).
// Usage: node verify-fold.mjs <resultsDir> <home> <runId>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

const resultsDir = process.argv[2];
const home = process.argv[3];
const runId = process.argv[4];

const metrics = JSON.parse(readFileSync(join(resultsDir, `${runId}.metrics.json`), "utf8"));
const sessionId = metrics.sessionId;

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

const logPath = join(home, "sessions", projectKey(resultsDir), encodeSegment(sessionId), "session.jsonl.zstd");
if (!existsSync(logPath)) {
  console.error(`session log not found: ${logPath}`);
  process.exit(2);
}

const buf = readFileSync(logPath);
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
  text += zstdDecompressSync(buf.subarray(start, end), { maxOutputLength: 256 * 1024 * 1024 }).toString("utf8");
}

const { decodeStorageRecord } = await import(pathToFileURL("<DSH_INSTALL>/node_modules/@deepseek-ai/dsh-session/lib/index.js").href);

const events = [];
for (const line of text.split("\n")) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line);
  if (row.type === "session") continue;
  events.push(...decodeStorageRecord(row));
}

const live = JSON.parse(readFileSync(join(resultsDir, `${runId}.projection.json`), "utf8"));

// --- independent fold (two-pass: callId -> name map first) ---
const callNames = new Map();
for (const event of events) {
  if (event.type === "tool/call" && event.data?.callId) {
    callNames.set(String(event.data.callId), String(event.data.name ?? "unknown"));
  }
}

const turns = [];
let open = null;
let steps = 0;
const goalChanges = [];
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
const perTool = new Map();

for (const event of events) {
  const data = event.data ?? {};
  switch (event.type) {
    case "turn/start":
      if (open) turns.push(open);
      open = { turn: data.turn ?? null, steps: 0, toolCalls: 0, toolErrors: 0, reason: null };
      break;
    case "step/start":
      steps += 1;
      if (open) open.steps += 1;
      break;
    case "tool/result": {
      const callId = data.callId ?? data.message?.source?.callId;
      const name = String(data.name ?? (callId != null ? callNames.get(String(callId)) : null) ?? "unknown");
      const blocks = Array.isArray(data.message?.content) ? data.message.content : [];
      const isError = data.isError === true || data.error !== undefined || blocks.some((block) => block?.isError === true);
      const entry = perTool.get(name) ?? { calls: [] };
      entry.calls.push({ seq: event.seq, isError });
      perTool.set(name, entry);
      if (open) {
        open.toolCalls += 1;
        if (isError) open.toolErrors += 1;
      }
      break;
    }
    case "turn/end":
      if (open) open.reason = data.reason ?? null;
      if (open) turns.push(open);
      open = null;
      break;
    case "goal/change":
      goalChanges.push({ operation: data.operation ?? null, phase: data.goal?.phase ?? null, revision: data.goal?.revision ?? null, roundsStarted: data.roundsStarted ?? null, seq: event.seq });
      break;
    case "assistant/message": {
      const u = data.usage ?? {};
      for (const f of Object.keys(usage)) if (typeof u[f] === "number") usage[f] += u[f];
      break;
    }
    default:
      break;
  }
}
if (open) turns.push(open);

const toolErrors = turns.reduce((s, t) => s + t.toolErrors, 0);
const EFFECT_MODEL = { exp_report: "result", exp_flaky: "result", exp_unobservable: "none" };
const effect = {};
const unknownFields = [];
for (const [name, entry] of perTool) {
  const model = EFFECT_MODEL[name] ?? "result";
  const anyError = entry.calls.some((c) => c.isError);
  const callResult = entry.calls.length === 0 ? null : anyError ? "failed" : "success";
  if (model === "none") {
    effect[name] = { called: entry.calls.length > 0, calls: entry.calls, callResult, worldEffect: "unknown", support: [] };
    if (entry.calls.length > 0) unknownFields.push(`effects.${name}.worldEffect`);
  } else {
    effect[name] = { called: entry.calls.length > 0, calls: entry.calls, callResult, worldEffect: callResult ?? "unknown", support: entry.calls.map((c) => c.seq) };
    if (callResult === null) unknownFields.push(`effects.${name}.worldEffect`);
  }
}
const goal = goalChanges.length > 0 ? { operation: goalChanges.at(-1).operation, phase: goalChanges.at(-1).phase, revision: goalChanges.at(-1).revision, roundsStarted: goalChanges.at(-1).roundsStarted, support: [goalChanges.at(-1).seq] } : null;

const projection = {
  axes: {
    execution: { turns: turns.length, steps, toolCalls: turns.reduce((s, t) => s + t.toolCalls, 0), toolErrors, turnHistory: turns, turnOutcome: turns.at(-1)?.reason?.kind ?? null },
    goal,
    effect,
  },
  verdict: {
    turn: turns.at(-1)?.reason?.kind ?? null,
    execution: turns.reduce((s, t) => s + t.toolCalls, 0) === 0 ? "none" : toolErrors > 0 ? "failed" : "success",
    effect: Object.fromEntries(Object.entries(effect).map(([k, e]) => [k, e.worldEffect])),
  },
  unknownFields: [...new Set(unknownFields)],
  usage,
};

const strip = (obj) => {
  const clone = JSON.parse(JSON.stringify(obj));
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      if (key === "foldMs" || key === "foldStats" || key === "hostTiming" || key === "writtenAt") {
        delete node[key];
        continue;
      }
      walk(node[key]);
    }
  };
  walk(clone);
  return clone;
};

const a = JSON.stringify(strip(projection));
const b = JSON.stringify(strip(live.projection ?? live));
const equal = a === b;
const out = { run: runId, equal, source: "persisted-log independent decode", eventsDecoded: events.length, diffs: [] };
if (!equal) {
  const diff = (x, y, path) => {
    const found = [];
    if (x === null || y === null || typeof x !== "object" || typeof y !== "object") {
      if (x !== y) found.push(`${path}: live=${JSON.stringify(y)} verify=${JSON.stringify(x)}`);
      return found;
    }
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) found.push(...diff(x[key], y[key], `${path}.${key}`));
    return found;
  };
  out.diffs = diff(JSON.parse(a), JSON.parse(b), "").slice(0, 50);
}

writeFileSync(join(resultsDir, `${runId}.verify.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
process.exitCode = equal ? 0 : 1;
