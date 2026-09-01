# driver-pp6.ps1 - structure-upgrade acceptance: replay the four quadrants on
# the NEW core packages (runtime-progress/circuit/reconcile/investigate).
# Acceptance line (numbers must match the accepted rounds):
#   loop:      aware realExec=2 (baseline 6)          -> -67%
#   nonatomic: aware dupSideEffects=1 (baseline 4)    -> -75%
#   pretend:   aware silentError=false, applied=true  (baseline silentError=true)
#   ok:        aware interventions = 0
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver6.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Run-Cell($runId, $profile, $taskText, $envMap) {
  foreach ($stale in @(
      "$results\$runId.metrics.json", "$results\$runId.events.jsonl",
      "$results\$runId.world.json", "$results\$runId.projection.json",
      "$results\$runId.policy.json", "$results\$runId.policy.circuit.json",
      "$results\$runId.policy.reconcile.json", "$results\$runId.policy.investigate.json",
      "$results\$runId.stdout.txt")) {
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
}

function Read-Task($name) {
  return (Get-Content -Raw "$harness\$name").Trim()
}

# ---------------- loop (failure+stalled) ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "loop-$run" 't-b' (Read-Task 'task-loop.txt') @{ EXP_SCENARIO='loop'; EXP_RUN=$run; EXP_ARM='baseline'; EXP_MODE='live' }
}
foreach ($run in @('a1','a2')) {
  Run-Cell "loop-$run" 't-a' (Read-Task 'task-loop.txt') @{ EXP_SCENARIO='loop'; EXP_RUN=$run; EXP_ARM='aware'; EXP_MODE='live'; EXP_CONTRACTS='1' }
}

# ---------------- nonatomic (failure+progressed) ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "nonatomic-$run" 't-b' (Read-Task 'task-nonatomic.txt') @{ EXP_SCENARIO='nonatomic'; EXP_RUN=$run; EXP_ARM='baseline'; EXP_MODE='live' }
}
foreach ($run in @('a1','a2')) {
  Run-Cell "nonatomic-$run" 't-a' (Read-Task 'task-nonatomic.txt') @{ EXP_SCENARIO='nonatomic'; EXP_RUN=$run; EXP_ARM='aware'; EXP_MODE='live'; EXP_CONTRACTS='1' }
}

# ---------------- pretend (success+stalled) ----------------
foreach ($run in @('b1','b2')) {
  Run-Cell "pretend-$run" 't-b' (Read-Task 'task-pretend.txt') @{ EXP_SCENARIO='pretend'; EXP_RUN=$run; EXP_ARM='baseline'; EXP_MODE='live' }
}
foreach ($run in @('a1','a2')) {
  Run-Cell "pretend-$run" 't-a' (Read-Task 'task-pretend.txt') @{ EXP_SCENARIO='pretend'; EXP_RUN=$run; EXP_ARM='aware'; EXP_MODE='live'; EXP_CONTRACTS='1' }
}

# ---------------- ok control (success+progressed, no intervention) ----------------
Run-Cell 'ok-acc1' 't-a' (Read-Task 'task-ok.txt') @{ EXP_SCENARIO='ok'; EXP_RUN='acc1'; EXP_ARM='aware'; EXP_MODE='live'; EXP_CONTRACTS='1' }

Log "ALL DONE"
