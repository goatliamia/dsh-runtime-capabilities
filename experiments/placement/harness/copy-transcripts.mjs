// Fixup: copy each run's session transcript (session.jsonl.zstd) from the
// isolated home into the run dir, matching by the workspace-key run id.
import { readdirSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HOME = "<HOME>/.dsh-place-exp/sessions";
const RESULTS = "<HOME>/Documents/ctx-place-exp/results";

let ok = 0, miss = 0;
for (const run of readdirSync(RESULTS)) {
  if (!run.startsWith("place-")) continue;
  for (const ws of readdirSync(HOME)) {
    if (!ws.includes(run)) continue;
    const sessionDir = readdirSync(join(HOME, ws))[0];
    const src = join(HOME, ws, sessionDir, "session.jsonl.zstd");
    if (existsSync(src)) {
      copyFileSync(src, join(RESULTS, run, "transcript.zstd"));
      ok++;
    } else {
      console.log("MISS", run, src);
      miss++;
    }
  }
}
console.log(`copied=${ok} miss=${miss}`);
