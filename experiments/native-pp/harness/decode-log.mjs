// decode-log.mjs — dump the persisted session log events (frame-split zstd
// decode + JSONL parse). Usage: node decode-log.mjs <session.jsonl.zstd> [tailN]
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const file = process.argv[2];
const tailN = Number(process.argv[3] ?? 0);
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
    console.error(`[FRAME-ERROR ${i}] ${error.message}`);
  }
}

const lines = text.split("\n").filter((line) => line.trim() !== "");
const rows = [];
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    rows.push(obj);
  } catch {
    console.error(`[PARSE-ERROR] ${line.slice(0, 120)}`);
  }
}

// Expand packed chunk storage rows with the official decoder when reachable.
let decodeStorageRecord = null;
try {
  const { pathToFileURL } = await import("node:url");
  ({ decodeStorageRecord } = await import(pathToFileURL("<DSH_INSTALL>/node_modules/@deepseek-ai/dsh-session/lib/index.js").href));
} catch (error) {
  console.error(`[EXPAND-UNAVAILABLE] ${String(error)}`);
}

const events = [];
for (const row of rows) {
  if (row.type === "session") continue;
  if (decodeStorageRecord) {
    try {
      events.push(...decodeStorageRecord(row));
      continue;
    } catch {
      /* fall through to raw */
    }
  }
  events.push(row);
}

console.log(`header: ${JSON.stringify(rows.find((row) => row.type === "session"))}`);
console.log(`physical rows: ${rows.length}, expanded events: ${events.length}`);
const list = tailN > 0 ? events.slice(-tailN) : events;
for (const event of list) {
  const brief = JSON.stringify(event.data).slice(0, 160);
  console.log(`seq=${event.seq} type=${event.type} time=${event.time} data=${brief}`);
}
