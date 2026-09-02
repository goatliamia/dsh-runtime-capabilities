# driver-rc7.ps1 - round 3: instruction continuity (prompt control variable).
# Scenario rccont. P1 (please reload) x2 and P2 (MUST reload) x2 run on the
# ALIGNED world (12/12 from the start): the facts-guard discards the model's
# reload with a teaching reason. P3 (do NOT reload) x2 runs on the MISMATCH
# world (12/11): the continuation fires against the prompt's prohibition.
# Baseline x1 (aligned, no named action).
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$world = '<REPO>\experiments\native-pp\rc\world'
$taskP1 = '<REPO>\experiments\native-pp\rc\task-cont-p1.txt'
$taskP2 = '<REPO>\experiments\native-pp\rc\task-cont-p2.txt'
$taskP3 = '<REPO>\experiments\native-pp\rc\task-cont-p3.txt'
$taskRc = '<REPO>\experiments\native-pp\rc\task-rc.txt'
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver-rc7.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Reset-World($aligned) {
  foreach ($transient in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','build.ps1','verify.ps1','reload.ps1','result.txt')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
  Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
  Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
  if ($aligned) {
    Copy-Item "$world\rccont-aligned\runtime-state.txt" "$results\runtime-state.txt" -Force
    Copy-Item "$world\rccont-aligned\artifact.json" "$results\artifact.json" -Force
  } else {
    Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
  }
}

function Run-Cell($runId, $profile, $taskText, $aligned) {
  Reset-World $aligned
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.world.json", "$results\$runId.continuation.json", "$results\$runId.stdout.txt", "$results\$runId.verify-continuation.json")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  $env:EXP_SCENARIO = 'rccont'
  $env:EXP_RUN = ($runId -split '-', 2)[1]
  $env:EXP_ARM = 'b'
  $env:EXP_MODE = 'live'
  Remove-Item Env:EXP_CONT_INJECT -ErrorAction SilentlyContinue
  Log "START $runId profile=$profile aligned=$aligned"
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
  foreach ($artifact in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','result.txt')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
}

# P1: please reload (aligned world, facts-guard discards)
foreach ($run in @('p1a1','p1a2')) { Run-Cell "rccont-$run" 'rc-c' (Get-Content -Raw $taskP1).Trim() $true }
# P2: MUST reload (aligned world, facts-guard discards)
foreach ($run in @('p2b1','p2b2')) { Run-Cell "rccont-$run" 'rc-c' (Get-Content -Raw $taskP2).Trim() $true }
# P3: do NOT reload (mismatch world, continuation fires against the prohibition)
foreach ($run in @('p3c1','p3c2')) { Run-Cell "rccont-$run" 'rc-c' (Get-Content -Raw $taskP3).Trim() $false }
# baseline: aligned world, no named action
Run-Cell 'rccont-base1' 'rc-c' (Get-Content -Raw $taskRc).Trim() $true

Log "ALL DONE"
