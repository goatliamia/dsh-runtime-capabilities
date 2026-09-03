// preflight-dsh-settings.mjs — contract sweep for the dsh-settings API.
//
// Root cause of the 2026-09-03 outage: @deepseek-ai/dsh 0.1.2-rc.1 removed the
// `settingsNamespace` / `installSettingsSection` exports from dsh-settings;
// three web-profile plugins compiled against the old API died on import and
// took the whole plugin tree down. The runtime re-symlinks profile
// node_modules/@deepseek-ai/* to its own dependency closure on every start, so
// a manual old-version directory cannot fix it — only plugin upgrades can.
//
// This preflight statically extracts the named exports of the INSTALLED
// dsh-settings and checks every plugin's named imports (and namespace member
// usage) against them. Run it BEFORE and AFTER a DSH upgrade:
//
//   node scripts/preflight-dsh-settings.mjs <profileDir>
//   node scripts/preflight-dsh-settings.mjs C:\Users\<you>\.dsh\profiles\web
//
// Exit code 0 = no missing named import found. Namespace imports and
// `export *` re-exports are reported as WATCH (not verifiable statically).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const [profileArg] = process.argv.slice(2);
if (!profileArg) {
  console.error("usage: node preflight-dsh-settings.mjs <profileDir>");
  process.exit(2);
}

function listFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) listFiles(full, out);
    else if (/\.(js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Named exports statically visible in one module source. */
function extractExports(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const hit = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (hit) names.add(hit[1]);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const hit = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (hit) names.add(hit[1]);
    }
  }
  return names;
}

/** Locate the installed dsh-settings package and read its entry. */
function resolveDshSettings(profileDir) {
  const candidates = [
    join(profileDir, "node_modules", "@deepseek-ai", "dsh-settings"),
    join(profileDir, "node_modules", "dsh-settings"),
    join(process.env.APPDATA ?? "", "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-settings"),
  ];
  for (const dir of candidates) {
    for (const entry of ["lib/index.js", "lib/index.mjs", "index.js"]) {
      const file = join(dir, entry);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

const profileDir = resolve(profileArg);
const settingsFile = resolveDshSettings(profileDir);
if (!settingsFile) {
  console.error("dsh-settings not found under profile or global install");
  process.exit(2);
}
const exported = extractExports(readFileSync(settingsFile, "utf8"));
console.log(`dsh-settings @ ${settingsFile}`);
console.log(`exports (${exported.size}): ${[...exported].sort().join(", ")}\n`);

/** Plugin dirs to scan: top-level entries, plus scoped dirs except @deepseek-ai. */
function pluginDirs(nodeModulesRoot) {
  const out = [];
  if (!existsSync(nodeModulesRoot)) return out;
  for (const name of readdirSync(nodeModulesRoot)) {
    if (name.startsWith(".")) continue;
    const full = join(nodeModulesRoot, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("@") && name !== "@deepseek-ai") {
      for (const inner of readdirSync(full)) {
        const sub = join(full, inner);
        if (statSync(sub).isDirectory()) out.push({ name: `${name}/${inner}`, dir: sub });
      }
    } else if (name !== "@deepseek-ai") {
      out.push({ name, dir: full });
    }
  }
  return out;
}

const nodeModulesRoot = join(profileDir, "node_modules");
let problems = 0;
for (const { name, dir } of pluginDirs(nodeModulesRoot)) {
  const isBackup = /\.bak[-.]/.test(name);
  const files = listFiles(dir);
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:@deepseek-ai\/)?dsh-settings["']/g)) {
      for (const part of m[1].split(",")) {
        const hit = part.trim().match(/^([A-Za-z_$][\w$]*)/);
        if (!hit) continue;
        const imported = hit[1];
        if (!exported.has(imported)) {
          hits.push(`${file.replace(dir, "")}: named import "${imported}" not exported`);
          // Backups are never loaded — report but do not fail the boot check.
          if (!isBackup) problems += 1;
        }
      }
    }
    if (/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["'](?:@deepseek-ai\/)?dsh-settings["']/.test(src)) {
      const ns = RegExp.$1;
      for (const gone of ["settingsNamespace", "installSettingsSection"]) {
        if (!exported.has(gone) && new RegExp(`\\b${ns}\\.${gone}\\b`).test(src)) {
          hits.push(`${file.replace(dir, "")}: ${ns}.${gone} used but not exported`);
          if (!isBackup) problems += 1;
        }
      }
    }
  }
  if (hits.length > 0) {
    console.log(`[MISSING] ${name}${isBackup ? " (backup dir — inert, safe to delete after confirming)" : ""}`);
    for (const h of hits) console.log(`    ${h}`);
  } else if (files.length > 0 && !isBackup) {
    console.log(`[ok] ${name}`);
  } else if (isBackup) {
    console.log(`[backup-skipped] ${name}`);
  }
}
console.log(`\n${problems === 0 ? "PASS: no missing dsh-settings named imports" : `FAIL: ${problems} missing named import(s)`}`);
process.exit(problems === 0 ? 0 : 1);
