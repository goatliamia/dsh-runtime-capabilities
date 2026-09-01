# driver-pp4.ps1 - real-scenario round (creative mode: standard preset, full
# tool surface, no whitelist clamp).
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
# Cells:
#   real3-b1/b2 (pp-f) real3-a1/a2 (pp-g)  -> success-but-not-effective
#   real6-b1/b2 (pp-f) real6-a1/a2 (pp-g)  -> normal-task negative control
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$world = "$harness\world"
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver4.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Reset-World($scenario) {
  # Remove only transient world/artifact files; keep other cells' runId.* data.
  foreach ($transient in @('config.json','runtime-state.txt','verify-result.txt','reload-marker.txt','build.log','test-result.txt','result.txt','count.txt','attempts.txt','math.js','test.js','run-tests.ps1','apply-config.ps1','verify.ps1','reload.ps1')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  if ($scenario -eq 'real3') {
    Copy-Item "$world\real3-config.json" "$results\config.json" -Force
    Copy-Item "$world\real3-runtime-state.txt" "$results\runtime-state.txt" -Force
    Copy-Item "$world\real3-apply-config.ps1" "$results\apply-config.ps1" -Force
    Copy-Item "$world\real3-verify.ps1" "$results\verify.ps1" -Force
    Copy-Item "$world\real3-reload.ps1" "$results\reload.ps1" -Force
  } elseif ($scenario -eq 'real6') {
    Copy-Item "$world\real6-math.js" "$results\math.js" -Force
    Copy-Item "$world\real6-test.js" "$results\test.js" -Force
    Copy-Item "$world\real6-run-tests.ps1" "$results\run-tests.ps1" -Force
  }
}

function Run-Cell($runId, $profile, $scenario, $taskText, $arm) {
  Reset-World $scenario
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  $env:EXP_SCENARIO = $scenario; $env:EXP_RUN = $runId.Split('-')[1]; $env:EXP_ARM = $arm; $env:EXP_MODE = 'live'
  Log "START $runId profile=$profile"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $job = Start-Job -ScriptBlock {
    param($taskText, $resultsDir, $profile)
    Set-Location $resultsDir
    dsh --profile $profile $taskText *>&1
    "RUNEXIT:$LASTEXITCODE"
  } -ArgumentList $taskText, $results, $profile
  $finished = Wait-Job $job -Timeout 1500
  if ($finished) {
    $out = Receive-Job $job
    $exitLine = $out | Select-String -Pattern '^RUNEXIT:' | Select-Object -Last 1
    $exitCode = if ($exitLine) { $exitLine.Line.Split(':')[1] } else { 'unknown' }
    $out | Out-File "$results\$runId.stdout.txt" -Encoding utf8
    Log "END   $runId exit=$exitCode elapsed=$([int]$sw.Elapsed.TotalSeconds)s"
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Log "TIMEOUT $runId (25min limit)"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  # Preserve cell artifacts under the run id.
  foreach ($artifact in @('world.json','metrics.json','events.jsonl','projection.json','policy.json')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
  foreach ($artifact in @('config.json','runtime-state.txt','verify-result.txt','reload-marker.txt','build.log','test-result.txt','result.txt')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
}

function Read-Task($name) {
  return (Get-Content -Raw "$harness\$name").Trim()
}

# ---------------- real3: success-but-not-effective ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "real3-$run" 'pp-f' 'real3' (Read-Task 'task-real3.txt') 'baseline'
}
foreach ($run in @('a1','a2')) {
  Run-Cell "real3-$run" 'pp-g' 'real3' (Read-Task 'task-real3.txt') 'aware'
}

# ---------------- real6: normal-task negative control ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "real6-$run" 'pp-f' 'real6' (Read-Task 'task-real6.txt') 'baseline'
}
foreach ($run in @('a1','a2')) {
  Run-Cell "real6-$run" 'pp-g' 'real6' (Read-Task 'task-real6.txt') 'aware'
}

Log "ALL DONE"
