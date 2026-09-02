// recover-ids-extra.mjs — map additional round-1/chain cells to session dirs by
// driver-log time windows (anchored like the round-2 recovery: each cell's
// session dir log mtime lands exactly inside its run window).
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = "<HOME>/.dsh-native-pp-exp";
const sessionsRoot = join(home, "sessions", "--D-projects-runtime-dsh-runtime-experiments-native-pp-results--");

const WINDOWS = [
  { run: "rc-a1", start: "2026-09-02T20:25:31", end: "2026-09-02T20:26:44" },
  { run: "rc-a2", start: "2026-09-02T20:26:44", end: "2026-09-02T20:28:24" },
  { run: "rc-b1", start: "2026-09-02T20:55:23", end: "2026-09-02T20:56:16" },
  { run: "rc-b2", start: "2026-09-02T20:56:16", end: "2026-09-02T20:58:10" },
  { run: "rchain-h1", start: "2026-09-02T21:59:01", end: "2026-09-02T22:00:36" },
  { run: "rchain-h2", start: "2026-09-02T22:00:36", end: "2026-09-02T22:01:21" },
];

const sessionDirs = readdirSync(sessionsRoot).filter((name) => name.startsWith("session-"));
const entries = sessionDirs.map((name) => {
  const dir = join(sessionsRoot, name);
  const logPath = join(dir, "session.jsonl.zstd");
  const stat = statSync(dir);
  const logStat = existsSync(logPath) ? statSync(logPath) : null;
  return { name, dirMtime: stat.mtimeMs, logMtime: logStat?.mtimeMs ?? null };
});

const map = {};
for (const window of WINDOWS) {
  const startMs = new Date(window.start).getTime();
  const endMs = new Date(window.end).getTime();
  const candidates = entries
    .filter((e) => e.logMtime !== null && e.logMtime >= startMs - 3000 && e.logMtime <= endMs + 3000)
    .sort((a, b) => a.logMtime - b.logMtime);
  map[window.run] = candidates.map((c) => c.name);
  console.log(`${window.run}: ${JSON.stringify(candidates.map((c) => c.name))}`);
}
console.log(JSON.stringify(map, null, 2));
