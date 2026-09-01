# driver-pp2.ps1 - Progress consumer experiment driver (Circuit / Retry Policy).
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
# Cells (runId = <scenario>-<arm-run>):
#   loop-b1 loop-b2 nonatomic-b1 nonatomic-b2        -> baseline (pp-b, no policy)
#   loop-a1 loop-a2 nonatomic-a1 nonatomic-a2        -> aware (pp-c, policy consumer)
#   noop-b1 noop-a1                                  -> success+stalled record-only
#   ok-ctrl1                                         -> success+progressed control (aware)
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver2.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Run-Cell($runId, $profile, $taskText, $envMap) {
  foreach ($stale in @(
      "$results\$runId.metrics.json", "$results\$runId.events.jsonl",
      "$results\$runId.world.json", "$results\$runId.projection.json",
      "$results\$runId.policy.json", "$results\$runId.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  Remove-Item "$results\result.txt", "$results\attempts.txt", "$results\count.txt" -Force -ErrorAction SilentlyContinue
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  foreach ($kv in $envMap.GetEnumerator()) { Set-Item -Path "Env:$($kv.Key)" -Value $kv.Value }
  Log "START $runId profile=$profile"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $job = Start-Job -ScriptBlock {
    param($taskText, $resultsDir, $profile)
    Set-Location $resultsDir
    if ($taskText) {
      dsh --profile $profile $taskText *>&1
    } else {
      dsh --profile $profile *>&1
    }
    "RUNEXIT:$LASTEXITCODE"
  } -ArgumentList $taskText, $results, $profile
  $finished = Wait-Job $job -Timeout 1500
  $stdoutFile = "$results\$runId.stdout.txt"
  if ($finished) {
    $out = Receive-Job $job
    $exitLine = $out | Select-String -Pattern '^RUNEXIT:' | Select-Object -Last 1
    $exitCode = if ($exitLine) { $exitLine.Line.Split(':')[1] } else { 'unknown' }
    $out | Out-File $stdoutFile -Encoding utf8
    Log "END   $runId exit=$exitCode elapsed=$([int]$sw.Elapsed.TotalSeconds)s"
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Log "TIMEOUT $runId (25min limit)"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}

function Read-Task($name) {
  return (Get-Content -Raw "$harness\$name").Trim()
}

# ---------------- core cells: loop (failure+stalled) ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "loop-$run" 'pp-b' (Read-Task 'task-loop.txt') @{
    EXP_SCENARIO = 'loop'; EXP_RUN = $run; EXP_ARM = 'baseline'; EXP_MODE = 'live'
  }
}
foreach ($run in @('a1','a2')) {
  Run-Cell "loop-$run" 'pp-c' (Read-Task 'task-loop.txt') @{
    EXP_SCENARIO = 'loop'; EXP_RUN = $run; EXP_ARM = 'aware'; EXP_MODE = 'live'
  }
}

# ---------------- core cells: nonatomic (failure+progressed) ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "nonatomic-$run" 'pp-b' (Read-Task 'task-nonatomic.txt') @{
    EXP_SCENARIO = 'nonatomic'; EXP_RUN = $run; EXP_ARM = 'baseline'; EXP_MODE = 'live'
  }
}
foreach ($run in @('a1','a2')) {
  Run-Cell "nonatomic-$run" 'pp-c' (Read-Task 'task-nonatomic.txt') @{
    EXP_SCENARIO = 'nonatomic'; EXP_RUN = $run; EXP_ARM = 'aware'; EXP_MODE = 'live'
  }
}

# ---------------- success+stalled (record-only) ----------------
Run-Cell 'noop-b1' 'pp-b' (Read-Task 'task-noop.txt') @{
  EXP_SCENARIO = 'noop'; EXP_RUN = 'b1'; EXP_ARM = 'baseline'; EXP_MODE = 'live'
}
Run-Cell 'noop-a1' 'pp-c' (Read-Task 'task-noop.txt') @{
  EXP_SCENARIO = 'noop'; EXP_RUN = 'a1'; EXP_ARM = 'aware'; EXP_MODE = 'live'
}

# ---------------- success+progressed control (aware) ----------------
Run-Cell 'ok-ctrl1' 'pp-c' (Read-Task 'task-ok.txt') @{
  EXP_SCENARIO = 'ok'; EXP_RUN = 'ctrl1'; EXP_ARM = 'aware'; EXP_MODE = 'live'
}

Log "ALL DONE"
