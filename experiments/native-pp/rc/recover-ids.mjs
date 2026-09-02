// recover-ids.mjs — round-2 incident recovery: another session's sanitize pass
// redacted session ids in 5 cells' metrics.json (cells created before 21:31:44).
// The isolated-home sessions directory timestamps map each cell's run window
// to exactly one session dir; this script prints the recovered map.
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const home = "<HOME>/.dsh-native-pp-exp";
const sessionsRoot = join(home, "sessions", "--D-projects-runtime-dsh-runtime-experiments-native-pp-results--");

// Cell run windows from driver-rc4.log timestamps (local).
const WINDOWS = [
  { run: "rc-c1f", start: new Date("2026-09-02T21:15:51"), end: new Date("2026-09-02T21:18:29") },
  { run: "rc-cp1", start: new Date("2026-09-02T21:18:29"), end: new Date("2026-09-02T21:19:53") },
  { run: "rc-cp2", start: new Date("2026-09-02T21:19:53"), end: new Date("2026-09-02T21:20:53") },
  { run: "rccancel-x1", start: new Date("2026-09-02T21:20:53"), end: new Date("2026-09-02T21:23:46") },
  { run: "rccancel-x2", start: new Date("2026-09-02T21:23:46"), end: new Date("2026-09-02T21:27:58") },
];

const sessionDirs = readdirSync(sessionsRoot).filter((name) => name.startsWith("session-"));
const entries = sessionDirs.map((name) => {
  const dir = join(sessionsRoot, name);
  const logPath = join(dir, "session.jsonl.zstd");
  const stat = statSync(dir);
  const logStat = existsSync(logPath) ? statSync(logPath) : null;
  return { name, dirMtime: stat.mtimeMs, logMtime: logStat?.mtimeMs ?? null };
});

const recovered = {};
for (const window of WINDOWS) {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  const candidates = entries
    .filter((e) => (e.dirMtime >= startMs - 5000 && e.dirMtime <= endMs + 5000) || (e.logMtime !== null && e.logMtime >= startMs - 5000 && e.logMtime <= endMs + 5000))
    .sort((a, b) => a.dirMtime - b.dirMtime);
  recovered[window.run] = candidates.map((c) => c.name);
  console.log(`${window.run}: ${candidates.length === 1 ? candidates[0].name : "AMBIGUOUS " + JSON.stringify(candidates)}`);
}

console.log(JSON.stringify(recovered, null, 2));
