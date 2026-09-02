// gate-test.mjs - unit-check the per-segment execution gates (ASCII only)
function pwshSegments(callArguments) {
  try {
    const parsed = JSON.parse(callArguments);
    return String(parsed?.command ?? "").split(/[;&|\r\n]+/);
  } catch {
    return [];
  }
}

function segmentExecutesScript(segment, script) {
  const seg = String(segment ?? "").trim();
  if (/^(get-content|type|cat|select-string)\b/i.test(seg)) return false;
  const escaped = script.replace(/\./g, "\\.");
  return new RegExp(`(^|\\s)(&\\s*)?[.\\\\/]*${escaped}\\b`, "i").test(seg);
}

function pwshRunsScript(callArguments, script) {
  return pwshSegments(callArguments).some((segment) => segmentExecutesScript(segment, script));
}

const cases = [
  // [args JSON, script, expected]
  ['{"command": "& .\\\\build.ps1"}', "build.ps1", true],
  ['{"command": "./build.ps1"}', "build.ps1", true],
  ['{"command": ".\\\\build.ps1"}', "build.ps1", true],
  ['{"command": "pwsh -File build.ps1"}', "build.ps1", true],
  ['{"command": "./build.ps1; ./verify.ps1"}', "verify.ps1", true],
  ['{"command": "Get-Content build.ps1"}', "build.ps1", false],
  ['{"command": "type .\\\\build.ps1"}', "build.ps1", false],
  ['{"command": "Get-Content build.ps1; ./build.ps1"}', "build.ps1", true],
  ['{"command": "Get-Content artifact.json; Write-Output x; .\\\\verify.ps1; Get-Content runtime-state.txt"}', "verify.ps1", true],
  ['{"command": "Get-Content artifact.json; .\\\\verify.ps1"}', "build.ps1", false],
  ['{"command": "Write-Output BUILD OK artifact=12"}', "build.ps1", false],
  ['{"command": "& .\\\\reload.ps1; .\\\\verify.ps1"}', "reload.ps1", true],
  ['{"command": "& .\\\\stale-bump.ps1"}', "stale-bump.ps1", true],
  ['{"command": "Write-Output \\u0027.\\\\verify.ps1\\u0027"}', "verify.ps1", false],
];

let failures = 0;
for (const [args, script, expected] of cases) {
  const got = pwshRunsScript(args, script);
  const ok = got === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} script=${script} expect=${expected} got=${got} args=${args}`);
}
console.log(`failures=${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
