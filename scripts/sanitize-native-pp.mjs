/**
 * sanitize-native-pp.mjs — in-place desensitization of the native-pp
 * experiment line inside the dsh-runtime repo (runs before commit).
 *
 * Rules:
 *   - <user home> -> <HOME>           (both slash styles)
 *   - session-<uuid> -> session-<redacted>
 *   - DSH install path -> <DSH_INSTALL>
 *   - repo absolute path -> <REPO>    (machine-specific drive/paths)
 *   - core policy package deps normalized back to portable
 *     "file:../runtime-progress" (the absolute dist paths exist only for
 *     local profile installs)
 *
 * Never touches credentials (none exist under experiments/), never copies
 * anything outside the repo. Skips binaries (*.tgz) and run logs (*.log).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const REPO = join(fileURLToPath(new URL("..", import.meta.url)));
const REPO_WIN = "D:\\projects\\runtime\\dsh-runtime"; // machine-specific drive path

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const home = homedir(); // e.g. C:\Users\14100
// escapeRe already regex-escapes each backslash once; do NOT double-escape.
const HOME_PATTERNS = [
  [new RegExp(escapeRe(home), "gi"), "<HOME>"],
  [new RegExp(escapeRe(home).replace(/\\\\/g, "/"), "gi"), "<HOME>"],
];
const DSH_INSTALL_PATTERNS = [
  [/C:\\Users\\[^"'\s\\]*\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh/gi, "<DSH_INSTALL>"],
  [/C:\/Users\/[^"'\s/]*\/AppData\/Roaming\/npm\/node_modules\/@deepseek-ai\/dsh/gi, "<DSH_INSTALL>"],
];
const REPO_PATTERNS = [
  [new RegExp(escapeRe(REPO_WIN), "g"), "<REPO>"],
  [new RegExp(escapeRe(REPO_WIN).replace(/\\\\/g, "/"), "g"), "<REPO>"],
];
const SESSION_PATTERN = [/session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "session-<redacted>"];

const TEXT_EXT = new Set([".md", ".json", ".jsonl", ".txt", ".mjs", ".js", ".ps1", ".yml", ".yaml"]);

function sanitize(text) {
  let out = String(text);
  for (const [pattern, replacement] of HOME_PATTERNS) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of DSH_INSTALL_PATTERNS) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of REPO_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(...SESSION_PATTERN);
  return out;
}

const PORTABLE_DEP_OLD = /"dsh-runtime-progress": "file:[^"]*dsh-runtime-progress-0\.1\.0\.tgz"/g;
const PORTABLE_DEP_NEW = '"dsh-runtime-progress": "file:../runtime-progress"';

function walk(dir, action) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
      walk(path, action);
      continue;
    }
    action(path);
  }
}

let files = 0;
let changed = 0;

const targets = [
  join(REPO, "experiments", "native-pp"),
  join(REPO, "core"),
  join(REPO, "docs", "16-native-pp"),
  join(REPO, "docs", "status"),
  join(REPO, "docs", "16-native-pp-experiment.md"),
  join(REPO, "docs", "17-repo-structure-plan.md"),
  join(REPO, "docs", "18-runtime-frontend-design.md"),
];

for (const target of targets) {
  const stat = statSync(target);
  if (!stat.isDirectory()) {
    if (!TEXT_EXT.has(target.slice(target.lastIndexOf(".")))) continue;
    files += 1;
    let text = readFileSync(target, "utf8");
    if (target.endsWith("package.json")) text = text.replace(PORTABLE_DEP_OLD, PORTABLE_DEP_NEW);
    const out = sanitize(text);
    if (out !== text) {
      writeFileSync(target, out);
      changed += 1;
    }
    continue;
  }
  walk(target, (path) => {
    const ext = path.slice(path.lastIndexOf("."));
    if (!TEXT_EXT.has(ext)) return;
    files += 1;
    let text = readFileSync(path, "utf8");
    if (path.endsWith("package.json")) text = text.replace(PORTABLE_DEP_OLD, PORTABLE_DEP_NEW);
    const out = sanitize(text);
    if (out !== text) {
      writeFileSync(path, out);
      changed += 1;
    }
  });
}

console.log(`sanitized: ${files} text files scanned, ${changed} rewritten in place`);
