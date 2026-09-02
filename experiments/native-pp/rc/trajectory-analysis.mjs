// trajectory-analysis.mjs — per-step behavioral timeline for the A/B/chain
// cells: what the MODEL did and said at each step, and where the runtime
// continuation landed. Reads the persisted session logs through the
// independent decode path (session ids recovered from directory timestamps).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

const home = "<HOME>/.dsh-native-pp-exp";
const resultsDir = "<REPO>/experiments/native-pp/results";
const sessionsRoot = join(home, "sessions", "--D-projects-runtime-dsh-runtime-experiments-native-pp-results--");

const CELLS = {
  "rc-a1": "session-<redacted>",
  "rc-a2": "session-<redacted>",
  "rc-b1": "session-<redacted>",
  "rc-b2": "session-<redacted>",
  "rchain-h1": "session-<redacted>",
  "rchain-h2": "session-<redacted>",
};

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
    text += zstdDecompressSync(buf.subarray(start, end), { maxOutputLength: 256 * 1024 * 1024 }).toString("utf8");
  }
  return text;
}

const { decodeStorageRecord } = await import(
  pathToFileURL("<HOME>/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js").href
);

function shortCommand(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText);
    const command = String(parsed?.command ?? "");
    return command.length > 90 ? `${command.slice(0, 90)}...` : command;
  } catch {
    return String(argumentsText ?? "").slice(0, 90);
  }
}

const report = [];
for (const [cell, sessionId] of Object.entries(CELLS)) {
  const logPath = join(sessionsRoot, encodeSegment(sessionId), "session.jsonl.zstd");
  if (!existsSync(logPath)) {
    report.push(`## ${cell}\n\nlog not found: ${logPath}\n`);
    continue;
  }
  const text = decodeFile(logPath);
  const events = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const obj = JSON.parse(line);
    if (obj.type === "session") continue;
    events.push(...decodeStorageRecord(obj));
  }

  const lines = [`## ${cell}`, ""];
  const stepEntries = new Map();
  for (const event of events) {
    // Classify by the record's OWN step field: the continuation appends its
    // records during pre-step, BEFORE the loop's step/start, so a
    // step/start-cursor classification would misplace them into the
    // previous step.
    let step = null;
    if (event.type === "tool/call" || event.type === "tool/result") step = event.data?.step;
    else if (event.type === "assistant/message") step = event.data?.step;
    if (step === undefined || step === null) continue;
    if (!stepEntries.has(step)) stepEntries.set(step, { modelCalls: [], continuation: [], stale: [], modelText: [] });
    const entry = stepEntries.get(step);
    if (event.type === "tool/call") {
      const callId = String(event.data.callId ?? "");
      const item = { callId, name: event.data.name, command: shortCommand(event.data.arguments) };
      if (callId.startsWith("cont_")) entry.continuation.push(item);
      else if (callId.startsWith("stale_")) entry.stale.push(item);
      else entry.modelCalls.push(item);
    }
    if (event.type === "assistant/message") {
      const content = event.data?.message?.content ?? [];
      for (const block of content) {
        if (block?.type === "text" && String(block.text ?? "").trim() !== "") {
          const t = String(block.text).replace(/\s+/g, " ").trim();
          entry.modelText.push(t.length > 140 ? `${t.slice(0, 140)}...` : t);
        }
      }
    }
  }
  for (const [step, entry] of [...stepEntries.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`### step ${step}`);
    for (const item of entry.continuation) lines.push(`- [runtime] ${item.name}: ${item.command}`);
    for (const item of entry.stale) lines.push(`- [stale-actor] ${item.name}: ${item.command}`);
    for (const item of entry.modelCalls) lines.push(`- [model] ${item.name}: ${item.command}`);
    for (const t of entry.modelText.slice(0, 1)) lines.push(`- [model said] ${t}`);
    if (entry.modelCalls.length === 0 && entry.continuation.length === 0 && entry.modelText.length === 0) lines.push("- (no visible action this step)");
    lines.push("");
  }
  report.push(lines.join("\n"));
}

const out = report.join("\n");
writeFileSync(join(resultsDir, "rc-trajectory-analysis.md"), `${out}\n`);
console.log(out);
