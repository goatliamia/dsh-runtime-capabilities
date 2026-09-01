# driver-pp.ps1 - native Progress/Effect Projection experiment driver.
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
# Cells (runId matches the fixture's <scenario>-<run> naming):
#   ok-r1 / toolfail-r1 / unobservable-r1       -> pp-b live runs (E1)
#   <live-run>-replay stdout, replay.json       -> pp-r replay cells (E4)
#   ok-e5a-r1 (pp-a) / ok-e5b-r1 (pp-b)         -> A/B cost arms (E5)
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Run-Cell($runId, $profile, $taskText, $envMap) {
  foreach ($stale in @(
      "$results\$runId.metrics.json", "$results\$runId.events.jsonl",
      "$results\$runId.world.json", "$results\$runId.projection.json",
      "$results\$runId.replay.json", "$results\$runId.stdout.txt",
      "$results\$runId.replay.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  # Cross-cell artifact hygiene: the agent writes result.txt into the shared
  # results dir; a leftover file from a previous cell creates spurious
  # "File already exists" errors (observed in the first full run).
  Remove-Item "$results\result.txt" -Force -ErrorAction SilentlyContinue
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

# ---------------- E1 live cells (pp-b) ----------------
$e1Cells = @(
  @{ run = 'ok-r1';           scenario = 'ok';           task = 'task-ok.txt' },
  @{ run = 'toolfail-r1';     scenario = 'toolfail';     task = 'task-toolfail.txt' },
  @{ run = 'unobservable-r1'; scenario = 'unobservable'; task = 'task-unobservable.txt' }
)
foreach ($cell in $e1Cells) {
  Run-Cell $cell.run 'pp-b' (Read-Task $cell.task) @{
    EXP_SCENARIO = $cell.scenario; EXP_RUN = 'r1'; EXP_ARM = 'b'; EXP_MODE = 'live'
  }
}

# ---------------- E4 replay cells (pp-r, zero model calls) ----------------
foreach ($cell in $e1Cells) {
  $metrics = "$results\$($cell.run).metrics.json"
  if (-not (Test-Path $metrics)) { Log "SKIP replay $($cell.run): no metrics.json"; continue }
  $sessionId = (Get-Content $metrics -Raw | ConvertFrom-Json).sessionId
  if (-not $sessionId) { Log "SKIP replay $($cell.run): no sessionId"; continue }
  Remove-Item "$results\$($cell.run).replay.json" -Force -ErrorAction SilentlyContinue
  Remove-Item "$results\$($cell.run).replay.stdout.txt" -Force -ErrorAction SilentlyContinue
  Run-Cell "$($cell.run)-replay" 'pp-r' '' @{
    EXP_SCENARIO = $cell.scenario; EXP_RUN = 'r1'; EXP_ARM = 'b';
    EXP_MODE = 'replay'; EXP_REPLAY_SESSION = $sessionId
  }
}

# ---------------- E5 A/B cost cells ----------------
Run-Cell 'ok-e5a-r1' 'pp-a' (Read-Task 'task-ok.txt') @{
  EXP_SCENARIO = 'ok'; EXP_RUN = 'e5a-r1'; EXP_ARM = 'a'; EXP_MODE = 'live'
}
Run-Cell 'ok-e5b-r1' 'pp-b' (Read-Task 'task-ok.txt') @{
  EXP_SCENARIO = 'ok'; EXP_RUN = 'e5b-r1'; EXP_ARM = 'b'; EXP_MODE = 'live'
}

Log "ALL DONE"
