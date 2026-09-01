// Aggregate the context-placement experiment: decode each run's transcript,
// extract real token usage and model-call count, read the probe outcome.
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const RESULTS = "<HOME>/Documents/ctx-place-exp/results";
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const FACT_MARK = "v3.0.0";

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
      /* frame error: skip */
    }
  }
  return { frames: starts.length, text };
}

function sum(pattern, text) {
  let total = 0;
  const re = new RegExp(pattern, "g");
  let match;
  while ((match = re.exec(text)) !== null) total += Number(match[1]);
  return total;
}

const rows = [];
for (const dir of readdirSync(RESULTS)) {
  if (!dir.startsWith("place-")) continue;
  const runDir = join(RESULTS, dir);
  const row = { run: dir };

  const tagPath = join(runDir, "build-tag.txt");
  row.tag = existsSync(tagPath) ? readFileSync(tagPath, "utf8").trim() : "(no file)";
  row.followedFact = row.tag.includes(FACT_MARK) ? "fact" : row.tag.includes("v2.1.0") ? "file" : "other";

  const tPath = existsSync(join(runDir, "transcript.zstd"))
    ? join(runDir, "transcript.zstd")
    : join(runDir, "transcript.jsonl");
  if (existsSync(tPath)) {
    const { frames, text } = decode(readFileSync(tPath));
    row.frames = frames;
    row.inputTokens = sum(/"inputTokens":(\d+)/, text);
    row.outputTokens = sum(/"outputTokens":(\d+)/, text);
    row.cacheReadTokens = sum(/"cacheReadTokens":(\d+)/, text);
    row.reasoningTokens = sum(/"reasoningTokens":(\d+)/, text);
    row.modelCalls = (text.match(/"cacheReadTokens":\d+/g) ?? []).length;
    row.factInTranscript = text.includes(FACT_MARK);
  } else {
    row.frames = 0;
    row.inputTokens = row.outputTokens = row.cacheReadTokens = row.reasoningTokens = 0;
    row.modelCalls = 0;
    row.factInTranscript = false;
  }

  const outPath = join(runDir, "stdout.txt");
  if (existsSync(outPath)) {
    const out = readFileSync(outPath, "utf8").trim();
    const lines = out.split(/\r?\n/).filter(Boolean);
    row.stdoutTail = lines.slice(-3).join(" | ");
  } else {
    row.stdoutTail = "";
  }

  rows.push(row);
}

rows.sort((a, b) => a.run.localeCompare(b.run));

// console table + md file
console.table(rows.map(({ run, tag, followedFact, modelCalls, inputTokens, outputTokens, cacheReadTokens, reasoningTokens, factInTranscript }) =>
  ({ run, tag, followedFact, modelCalls, inputTokens, outputTokens, cacheReadTokens, reasoningTokens, factInTranscript })));

let md = "# ctx-place experiment raw results\n\n";
md += "| run | tag | followed | modelCalls | input | output | cacheRead | reasoning | factInTranscript |\n";
md += "|---|---|---|---|---|---|---|---|---|\n";
for (const r of rows) {
  md += `| ${r.run} | ${r.tag} | ${r.followedFact} | ${r.modelCalls} | ${r.inputTokens} | ${r.outputTokens} | ${r.cacheReadTokens} | ${r.reasoningTokens} | ${r.factInTranscript} |\n`;
}
writeFileSync(join(RESULTS, "aggregate.md"), md);
console.log("wrote", join(RESULTS, "aggregate.md"));
