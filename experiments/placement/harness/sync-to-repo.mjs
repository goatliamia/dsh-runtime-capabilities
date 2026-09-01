// One-shot sync: placement experiment records -> dsh-runtime repo
// (experiments/placement). Sanitizes local paths and session ids; generates
// per-run metrics.json from the raw transcripts; raw zstd transcripts stay
// local (repo precedent: derived sanitized artifacts only).
//
// Local-home patterns are built at runtime from the environment so the
// committed script carries no machine-specific paths or usernames.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const SRC = process.env.CTX_PLACE_SRC ?? null; // local experiment dir
const DST = process.env.CTX_PLACE_DST ?? join(process.cwd(), "..");
if (!SRC) {
  console.error("set CTX_PLACE_SRC (local ctx-place-exp dir)");
  process.exit(1);
}
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
const HOME_PATTERNS = home
  ? [
      [new RegExp(escapeRe(home).replace(/\\/g, "\\\\"), "gi"), "<HOME>"],
      [new RegExp(escapeRe(home).replace(/\\/g, "/"), "gi"), "<HOME>"],
    ]
  : [];

function sanitize(text) {
  let out = String(text);
  for (const [pattern, replacement] of HOME_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(/session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "session-<redacted>");
  return out;
}

function writeSanitized(from, to) {
  if (!existsSync(from)) return;
  writeFileSync(to, sanitize(readFileSync(from, "utf8")));
}

function decode(buf) {
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
    } catch {
      /* skip bad frame */
    }
  }
  return text;
}

function sum(pattern, text) {
  let total = 0;
  const re = new RegExp(pattern, "g");
  let m;
  while ((m = re.exec(text)) !== null) total += Number(m[1]);
  return total;
}

// harness: plugin + drivers + scripts
const harness = join(DST, "harness");
mkdirSync(join(harness, "plugin", "dsh-ctx-place", "lib"), { recursive: true });
for (const f of ["package.json", "cordis.patch.yml"]) {
  writeSanitized(join(SRC, "plugin", "dsh-ctx-place", f), join(harness, "plugin", "dsh-ctx-place", f));
}
writeSanitized(join(SRC, "plugin", "dsh-ctx-place", "lib", "index.js"), join(harness, "plugin", "dsh-ctx-place", "lib", "index.js"));
for (const f of ["driver.ps1", "driver2.ps1", "copy-transcripts.mjs", "aggregate.mjs"]) {
  writeSanitized(join(SRC, f), join(harness, f));
}

// data: per-run sanitized artifacts + generated metrics.json; no raw transcripts
const data = join(DST, "data");
mkdirSync(data, { recursive: true });
const runs = readdirSync(join(SRC, "results")).filter((d) => d.startsWith("place-"));
for (const run of runs.sort()) {
  const runSrc = join(SRC, "results", run);
  const runDst = join(data, run);
  mkdirSync(runDst, { recursive: true });

  let metrics = null;
  const tPath = join(runSrc, "transcript.zstd");
  if (existsSync(tPath)) {
    const text = decode(readFileSync(tPath));
    metrics = {
      run,
      modelCalls: (text.match(/"cacheReadTokens":\d+/g) ?? []).length,
      inputTokens: sum(/"inputTokens":(\d+)/, text),
      outputTokens: sum(/"outputTokens":(\d+)/, text),
      cacheReadTokens: sum(/"cacheReadTokens":(\d+)/, text),
      reasoningTokens: sum(/"reasoningTokens":(\d+)/, text),
      factInTranscript: text.includes("v3.0.0"),
    };
  }
  const tagPath = join(runSrc, "build-tag.txt");
  const tag = existsSync(tagPath) ? readFileSync(tagPath, "utf8").trim() : "(no file)";
  if (metrics) metrics.tag = tag;
  writeFileSync(join(runDst, "metrics.json"), JSON.stringify(metrics ?? { run, tag, note: "no transcript" }, null, 2) + "\n");

  writeSanitized(tagPath, join(runDst, "build-tag.txt"));
  writeSanitized(join(runSrc, "tags.txt"), join(runDst, "tags.txt"));
  writeSanitized(join(runSrc, "stdout.txt"), join(runDst, "stdout.txt"));
}

// summaries + logs
for (const f of ["SUMMARY.md", "results/aggregate.md", "results/driver.log", "results/driver2.log"]) {
  writeSanitized(join(SRC, f), join(data, f.split("/").pop()));
}

console.log(`synced ${runs.length} runs + harness to ${DST}`);
