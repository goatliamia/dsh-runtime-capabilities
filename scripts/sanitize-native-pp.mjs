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
const PORTABLE_DEP_OLD_2 = /"dsh-native-pp-projection": "file:[^"]*dsh-native-pp-projection-0\.1\.0\.tgz"/g;
const PORTABLE_DEP_NEW_2 = '"dsh-native-pp-projection": "file:../projection"';
// Placeholders produced by an earlier pass of this script must be repaired,
// not left behind (a file:<REPO> dependency is uninstallable).
const PLACEHOLDER_DEP = /"file:<REPO>[^"]*"/g;

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

function normalizePackageJson(text) {
  return text
    .replace(PORTABLE_DEP_OLD, PORTABLE_DEP_NEW)
    .replace(PORTABLE_DEP_OLD_2, PORTABLE_DEP_NEW_2)
    .replace(PLACEHOLDER_DEP, (match) => {
      if (match.includes("dsh-runtime-progress")) return '"file:../runtime-progress"';
      if (match.includes("dsh-native-pp-projection")) return '"file:../projection"';
      return match; // unknown placeholder: keep for manual review (verifier flags it)
    });
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
    if (target.endsWith("package.json")) text = normalizePackageJson(text);
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
    if (path.endsWith("package.json")) text = normalizePackageJson(text);
    const out = sanitize(text);
    if (out !== text) {
      writeFileSync(path, out);
      changed += 1;
    }
  });
}

// Final verification: no absolute file: deps, no <REPO> placeholders, no
// session ids, no machine paths may remain anywhere in the scanned area.
const BAD_PATTERNS = [
  [/file:[A-Za-z]:/g, "absolute file: dependency"],
  [/file:<REPO>/g, "<REPO> placeholder dependency"],
  [/session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "session id"],
  [new RegExp(escapeRe(REPO_WIN), "g"), "repo absolute path"],
];
const residue = [];
for (const target of targets) {
  const stat = statSync(target);
  const visit = (path) => {
    const ext = path.slice(path.lastIndexOf("."));
    if (!TEXT_EXT.has(ext)) return;
    const text = readFileSync(path, "utf8");
    for (const [pattern, label] of BAD_PATTERNS) {
      if (pattern.test(text)) residue.push(`${label}: ${path}`);
    }
  };
  if (!stat.isDirectory()) visit(target);
  else walk(target, visit);
}

console.log(`sanitized: ${files} text files scanned, ${changed} rewritten in place`);
if (residue.length > 0) {
  console.error("VERIFY FAILED — residue left behind:");
  for (const line of residue.slice(0, 20)) console.error(`  ${line}`);
  process.exit(1);
}
console.log("verify: clean");
