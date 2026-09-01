// token-index.mjs — retroactive real-token backtracking for the native-pp runs.
// For every live run (metrics.json -> sessionId), locate the persisted session
// log (session.jsonl.zstd), decode all zstd frames, and sum the usage fields
// from the durable records. Zero instrumentation inside the runs themselves.
// Usage: node token-index.mjs <resultsDir> <home>
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const resultsDir = process.argv[2];
const home = process.argv[3];
const sessionsRoot = join(home, "sessions");

// Same project-key algorithm as dsh-session-persistence-jsonl (docs-verified).
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
  if (raw.length === 0) return "";
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
  return { text, frames: starts.length };
}

function sum(pattern, text) {
  let total = 0;
  const re = new RegExp(pattern, "g");
  let match;
  while ((match = re.exec(text)) !== null) total += Number(match[1]);
  return total;
}

const projectDir = join(sessionsRoot, projectKey(resultsDir));
const rows = [];

for (const file of readdirSync(resultsDir)) {
  if (!file.endsWith(".metrics.json")) continue;
  const run = file.slice(0, -".metrics.json".length);
  const metrics = JSON.parse(readFileSync(join(resultsDir, file), "utf8"));
  const sessionId = metrics.sessionId;
  if (!sessionId) {
    rows.push({ run, sessionId: null, note: "no sessionId in metrics" });
    continue;
  }
  const logPath = join(projectDir, encodeSegment(sessionId), "session.jsonl.zstd");
  if (!existsSync(logPath)) {
    rows.push({ run, sessionId, note: `session log not found: ${logPath}` });
    continue;
  }
  const { text, frames } = decodeFile(logPath);
  rows.push({
    run,
    sessionId,
    arm: metrics.arm ?? null,
    scenario: metrics.scenario ?? null,
    modelCalls: metrics.modelCalls ?? null,
    toolCalls: metrics.toolCalls ?? null,
    toolErrors: metrics.toolErrors ?? null,
    inputTokens: sum(/"inputTokens":(\d+)/, text),
    outputTokens: sum(/"outputTokens":(\d+)/, text),
    cacheReadTokens: sum(/"cacheReadTokens":(\d+)/, text),
    cacheWriteTokens: sum(/"cacheWriteTokens":(\d+)/, text),
    reasoningTokens: sum(/"reasoningTokens":(\d+)/, text),
    frames,
    decodedChars: text.length,
  });
}

const outPath = join(resultsDir, "token-index.json");
writeFileSync(outPath, `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify(rows, null, 2));
