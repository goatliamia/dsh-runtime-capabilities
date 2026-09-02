# driver-rc2.ps1 - docs/19 round-1b: official matrix under plugin v2
# (wire filter + discard digest). Re-runs B x2, C x2, control x1.
# A arm (rc-a1/rc-a2) stays valid from driver-rc (plugin absent in rc-a).
# v1 B/C cells are archived under results/v1-variant/ as the
# placeholder-visible vs hidden comparison evidence.
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$world = '<REPO>\experiments\native-pp\rc\world'
$taskRc = '<REPO>\experiments\native-pp\rc\task-rc.txt'
$taskCtrl = "$harness\task-real6.txt"
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver-rc2.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Reset-World($scenario) {
  foreach ($transient in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','stale-bump.ps1','build.ps1','verify.ps1','reload.ps1','result.txt','math.js','test.js','run-tests.ps1','test-result.txt')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  if ($scenario -eq 'rc') {
    Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
    Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
    Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
    Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
  } elseif ($scenario -eq 'rccontrol') {
    Copy-Item "$harness\world\real6-math.js" "$results\math.js" -Force
    Copy-Item "$harness\world\real6-test.js" "$results\test.js" -Force
    Copy-Item "$harness\world\real6-run-tests.ps1" "$results\run-tests.ps1" -Force
  }
}

function Run-Cell($runId, $profile, $scenario, $taskText, $arm, $extraEnv) {
  Reset-World $scenario
  foreach ($stale in @(
      "$results\$runId.metrics.json", "$results\$runId.events.jsonl",
      "$results\$runId.world.json", "$results\$runId.continuation.json",
      "$results\$runId.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  $env:EXP_SCENARIO = $scenario
  $env:EXP_RUN = $runId.Split('-')[1]
  $env:EXP_ARM = $arm
  $env:EXP_MODE = 'live'
  Remove-Item Env:EXP_CONT_INJECT -ErrorAction SilentlyContinue
  if ($arm -eq 'c') {
    Copy-Item "$world\stale-bump.ps1" "$results\stale-bump.ps1" -Force
  }
  foreach ($kv in $extraEnv.GetEnumerator()) { Set-Item -Path "Env:$($kv.Key)" -Value $kv.Value }
  Log "START $runId profile=$profile arm=$arm scenario=$scenario"
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
  foreach ($artifact in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','result.txt','test-result.txt')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
}

function Read-Task($path) {
  return (Get-Content -Raw $path).Trim()
}

# ---- B arm v2 ----
foreach ($run in @('b1','b2')) {
  Run-Cell "rc-$run" 'rc-b' 'rc' (Read-Task $taskRc) 'b' @{}
}

# ---- C arm v2 ----
foreach ($run in @('c1','c2')) {
  Run-Cell "rc-$run" 'rc-c' 'rc' (Read-Task $taskRc) 'c' @{}
}

# ---- normal-task control v2 ----
Run-Cell 'rc-ctrl1' 'rc-b' 'rccontrol' (Read-Task $taskCtrl) 'ctrl' @{}

Log "ALL DONE"
