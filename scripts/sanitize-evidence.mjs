/**
 * Desensitize + materialize experiment evidence into the dsh-runtime repo.
 * Rules: home paths -> <HOME>; session ids -> session-<redacted>; never copy
 * credentials, bridge/reactor/maker sources, or anything outside the runtime
 * experiment line.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.env.RUNTIME_EVIDENCE_SRC ?? null; // local runtime-exp dir
const ZIP = process.env.RUNTIME_EVIDENCE_ZIP ?? null; // local unpacked migration snapshot
const DST = process.env.RUNTIME_EVIDENCE_DST ?? join(process.cwd(), "..");
if (!SRC || !ZIP) {
  console.error("set RUNTIME_EVIDENCE_SRC and RUNTIME_EVIDENCE_ZIP (local, one-shot evidence ingestion)");
  process.exit(1);
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Local-home patterns are built at runtime from the environment so the
// committed script carries no machine-specific paths or usernames.
const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
const HOME_PATTERNS = home
  ? [
      [new RegExp(escapeRe(home).replace(/\\/g, "\\\\"), "gi"), "<HOME>"],
      [new RegExp(escapeRe(home).replace(/\\/g, "/"), "gi"), "<HOME>"],
    ]
  : [];
const SESSION_PATTERN = [/session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "session-<redacted>"];

function sanitize(text) {
  let out = String(text);
  for (const [pattern, replacement] of HOME_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(...SESSION_PATTERN);
  return out;
}

function copySanitized(from, to) {
  if (!existsSync(from)) return false;
  const stat = statSync(from);
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) copySanitized(join(from, entry), join(to, entry));
    return true;
  }
  const text = readFileSync(from, "utf8");
  writeFileSync(to, sanitize(text));
  return true;
}

// 1) experiment harness (plugin + drivers + aggregators + verifier)
mkdirSync(join(DST, "experiments", "harness"), { recursive: true });
for (const name of ["plugin", "driver.ps1", "driver2.ps1", "driver3.ps1", "driver4.ps1", "driver4b.ps1", "driver5.ps1", "driver6.ps1", "driver7.ps1", "driver8.ps1", "driver9.ps1", "aggregate.mjs", "aggregate2.mjs", "aggregate4.mjs", "aggregate4b.mjs", "aggregate56.mjs", "aggregate7.mjs", "verify-e7b.ps1"]) {
  copySanitized(join(SRC, name), join(DST, "experiments", "harness", name));
}

// 2) experiment data (metrics/events/results/stdout/summaries/shared state)
mkdirSync(join(DST, "experiments", "data"), { recursive: true });
for (const entry of readdirSync(join(SRC, "results"))) {
  const from = join(SRC, "results", entry);
  const to = join(DST, "experiments", "data", entry);
  if (entry === "driver.log") continue; // run log noise
  copySanitized(from, to);
}

// 3) docs: the runtime experiment line only (07-14 + relevant adr/status)
mkdirSync(join(DST, "docs"), { recursive: true });
for (const name of ["07-runtime-exposure-experiment.md", "08-dsh-kv-prefix-replay.md", "09-isolated-runtime-behavior-experiment.md", "10-guard-teaching-experiment-design.md", "11-runtime-plugin-capability-modes.md", "13-experiment-data-report.md", "14-runtime-plugin-design-review.md"]) {
  copySanitized(join(ZIP, "docs", name), join(DST, "docs", name));
}
mkdirSync(join(DST, "docs", "adr"), { recursive: true });
for (const name of ["0003-out-of-band-constraints-and-zero-cost-fast-path.md", "0007-runtime-exposure-timing.md"]) {
  copySanitized(join(ZIP, "docs", "adr", name), join(DST, "docs", "adr", name));
}
mkdirSync(join(DST, "docs", "status"), { recursive: true });
for (const name of ["runtime-exposure-2026-08-31.md", "runtime-behavior-2026-08-31.md", "runtime-guard-round2-2026-08-31.md", "runtime-circuit-e4-2026-08-31.md", "runtime-h1-pickup-e5e6-2026-08-31.md", "runtime-v4pro-e7-2026-08-31.md"]) {
  copySanitized(join(ZIP, "docs", "status", name), join(DST, "docs", "status", name));
}

console.log("materialized. verification follows.");
