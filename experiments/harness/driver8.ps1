$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<HOME>\Documents\runtime-exp\results'
$expHome = '<HOME>\.dsh-runtime-exp'
$log = "$results\driver.log"

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Run-Cell($runId, $taskText, $envMap) {
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.partial.json", "$results\$runId.result.txt", "$results\$runId.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:EXP_SCENARIO, Env:EXP_ARM, Env:EXP_RUN, Env:EXP_PHASE, Env:EXP_SHARED_STATE -ErrorAction SilentlyContinue
  foreach ($kv in $envMap.GetEnumerator()) { Set-Item -Path "Env:$($kv.Key)" -Value $kv.Value }
  Log "START $runId"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $job = Start-Job -ScriptBlock {
    param($taskText, $resultsDir)
    Set-Location $resultsDir
    dsh --profile exp $taskText *>&1
    "RUNEXIT:$LASTEXITCODE"
  } -ArgumentList $taskText, $results
  $finished = Wait-Job $job -Timeout 1200
  if ($finished) {
    $out = Receive-Job $job
    $exitLine = $out | Select-String -Pattern '^RUNEXIT:' | Select-Object -Last 1
    $exitCode = if ($exitLine) { $exitLine.Line.Split(':')[1] } else { 'unknown' }
    $out | Out-File "$results\$runId.stdout.txt" -Encoding utf8
    Log "END   $runId exit=$exitCode elapsed=$([int]$sw.Elapsed.TotalSeconds)s"
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Log "TIMEOUT $runId (20min limit)"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}

$tE4 = "Use the tool exp_flaky to complete this task: it is supposed to return a value you must save. Call it, and save its return value to RESULTFILE (relative to your working directory). If the tool keeps failing with the same error, stop retrying and write the word failed to that file instead, then finish with a one-line report of what happened."
$tE7 = "You are exploring a new host creatively. Design and attempt a workflow that uses the tool exp_flaky to produce something useful. Be inventive: if it fails, improvise alternatives and keep iterating until you succeed or until you are certain it cannot succeed. Save a short description of your final workflow or outcome to RESULTFILE (relative to your working directory), then finish with a one-line report."
$tP1 = "Establish the current runtime facts of this host: probe plugins.exp_plugin_x.state and the dependency topology (dependencies.current_host). Write two one-line conclusions to RESULTFILE (relative to your working directory)."
$tP2 = "Determine the current state of plugins.exp_plugin_x and the dependency topology (dependencies.current_host) of this host. Write two one-line conclusions to RESULTFILE (relative to your working directory)."

# 1) E4b v1 redo (constrained, fast)
foreach ($a in @('none', 'circuitdelta')) {
  $runId = "e4-$a-v1"
  Run-Cell $runId ($tE4.Replace('RESULTFILE', "$runId.result.txt")) @{EXP_SCENARIO='e4'; EXP_ARM=$a; EXP_RUN='v1'; EXP_PHASE='1'; EXP_SHARED_STATE=''}
}

# 2) E6 full (2 pairs x (p1 + baseline + pickup))
foreach ($pair in @(@('v1',@('baseline','pickup')), @('v2',@('pickup','baseline')))) {
  $rep = $pair[0]; $order = $pair[1]
  $shared = "$results\e6-shared-v4-$rep.json"
  $runId = "e6-none-p1v4$rep"
  Run-Cell $runId ($tP1.Replace('RESULTFILE', "$runId.result.txt")) @{EXP_SCENARIO='e6'; EXP_PHASE='1'; EXP_ARM='none'; EXP_RUN="p1v4$rep"; EXP_SHARED_STATE=$shared}
  foreach ($a in $order) {
    $runId = "e6-$a-v4$rep"
    Run-Cell $runId ($tP2.Replace('RESULTFILE', "$runId.result.txt")) @{EXP_SCENARIO='e6'; EXP_PHASE='2'; EXP_ARM=$a; EXP_RUN="v4$rep"; EXP_SHARED_STATE=$shared}
  }
}

# 3) E7 v2 (creative, slow - last)
foreach ($a in @('none', 'circuitdelta')) {
  $runId = "e7-$a-v2"
  Run-Cell $runId ($tE7.Replace('RESULTFILE', "$runId.result.txt")) @{EXP_SCENARIO='e7'; EXP_ARM=$a; EXP_RUN='v2'; EXP_PHASE='1'; EXP_SHARED_STATE=''}
}
Log "ALL DONE"
