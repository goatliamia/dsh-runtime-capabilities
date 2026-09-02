# driver-rc4.ps1 - round 2 boundary matrix (docs/19 follow-up, v5 plugin).
# Axis A (Runtime boundary): stale-full x1, stale-partial x2, cancel x2,
#   cancel-mid x1, guard x2, multi-choice x2, unique regression x1.
# Axis B (Fact boundary): misleading-text bait x2, missing-fact-formats x2.
# Control x1. Chain (rchain) runs separately after the boundaries pass.
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$world = '<REPO>\experiments\native-pp\rc\world'
$taskRc = '<REPO>\experiments\native-pp\rc\task-rc.txt'
$taskCtrl = "$harness\task-real6.txt"
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver-rc4.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Reset-World($scenario, $arm) {
  foreach ($transient in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','rollback-count.txt','health-check.txt','stale-bump.ps1','stale-bump-artifact.ps1','build.ps1','verify.ps1','reload.ps1','reload-slow.ps1','rollback.ps1','healthcheck.ps1','result.txt','math.js','test.js','run-tests.ps1','test-result.txt')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  switch ($scenario) {
    'rc' {
      Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
      Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
      if ($arm -eq 'c') { Copy-Item "$world\stale-bump.ps1" "$results\stale-bump.ps1" -Force }
      if ($arm -eq 'cpartial') { Copy-Item "$world\stale-bump-artifact.ps1" "$results\stale-bump-artifact.ps1" -Force }
    }
    'rccancel' {
      Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\reload-slow.ps1" "$results\reload-slow.ps1" -Force
      Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
    }
    'rcguard' {
      Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
      Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
    }
    'rcmulti' {
      Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
      Copy-Item "$world\rollback.ps1" "$results\rollback.ps1" -Force
      Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
    }
    'rcbait' {
      Copy-Item "$world\rcbait\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\rcbait\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\rcbait\runtime-state.txt" "$results\runtime-state.txt" -Force
    }
    'rcnofacts' {
      Copy-Item "$world\rcnofacts\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\rcnofacts\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\rcnofacts\reload.ps1" "$results\reload.ps1" -Force
      Copy-Item "$world\rcnofacts\runtime-state.txt" "$results\runtime-state.txt" -Force
    }
    'rchain' {
      Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
      Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
      Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
      Copy-Item "$world\healthcheck.ps1" "$results\healthcheck.ps1" -Force
      Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
    }
    'rccontrol' {
      Copy-Item "$harness\world\real6-math.js" "$results\math.js" -Force
      Copy-Item "$harness\world\real6-test.js" "$results\test.js" -Force
      Copy-Item "$harness\world\real6-run-tests.ps1" "$results\run-tests.ps1" -Force
    }
  }
}

function Run-Cell($runId, $profile, $scenario, $taskText, $arm) {
  Reset-World $scenario $arm
  foreach ($stale in @(
      "$results\$runId.metrics.json", "$results\$runId.events.jsonl",
      "$results\$runId.world.json", "$results\$runId.continuation.json",
      "$results\$runId.stdout.txt", "$results\$runId.verify-continuation.json")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  $env:EXP_SCENARIO = $scenario
  $env:EXP_RUN = ($runId -split '-', 2)[1]
  $env:EXP_ARM = $arm
  $env:EXP_MODE = 'live'
  Remove-Item Env:EXP_CONT_INJECT -ErrorAction SilentlyContinue
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
  foreach ($artifact in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','rollback-count.txt','health-check.txt','result.txt','test-result.txt')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
}

$taskText = (Get-Content -Raw $taskRc).Trim()

# ---- Axis A: stale-full (v5 regression) ----
Run-Cell 'rc-c1f' 'rc-c' 'rc' $taskText 'c'

# ---- Axis A: stale-partial (artifact-only bump) ----
foreach ($run in @('cp1','cp2')) {
  Run-Cell "rc-$run" 'rc-c' 'rc' $taskText 'cpartial'
}

# ---- Axis A: cancel (before-dispatch abort) ----
foreach ($run in @('x1','x2')) {
  Run-Cell "rccancel-$run" 'rc-c' 'rccancel' $taskText 'cancel'
}

# ---- Axis A: cancel-mid (mid-body abort, drain semantics) ----
Run-Cell 'rccancel-xm1' 'rc-c' 'rccancel' $taskText 'cancelmid'

# ---- Axis A: guard (reload disabled for everyone) ----
foreach ($run in @('g1','g2')) {
  Run-Cell "rcguard-$run" 'rc-c' 'rcguard' $taskText 'b'
}

# ---- Axis A: multi-choice (ambiguous, no takeover) ----
foreach ($run in @('m1','m2')) {
  Run-Cell "rcmulti-$run" 'rc-c' 'rcmulti' $taskText 'b'
}

# ---- Axis A: unique regression (v5 dispatch) ----
Run-Cell 'rc-b3' 'rc-b' 'rc' $taskText 'b'

# ---- Axis B: misleading text bait ----
foreach ($run in @('t1','t2')) {
  Run-Cell "rcbait-$run" 'rc-c' 'rcbait' $taskText 'b'
}

# ---- Axis B: missing fact formats ----
foreach ($run in @('n1','n2')) {
  Run-Cell "rcnofacts-$run" 'rc-c' 'rcnofacts' $taskText 'b'
}

# ---- control regression ----
Run-Cell 'rccontrol-ctrl2' 'rc-c' 'rccontrol' (Get-Content -Raw $taskCtrl).Trim() 'ctrl'

Log "ALL DONE"
