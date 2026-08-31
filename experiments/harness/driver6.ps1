$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<HOME>\Documents\runtime-exp\results'
$expHome = '<HOME>\.dsh-runtime-exp'
$log = "$results\driver.log"

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

$taskP1 = "Establish the current runtime facts of this host: probe plugins.exp_plugin_x.state and the dependency topology (dependencies.current_host). Write two one-line conclusions to RESULTFILE (relative to your working directory)."
$taskP2 = "Determine the current state of plugins.exp_plugin_x and the dependency topology (dependencies.current_host) of this host. Write two one-line conclusions to RESULTFILE (relative to your working directory)."

# 3 pairs x (phase1 + baseline + none + pickup), arm order rotated per pair.
$pairs = @(
  @('r1', @('baseline', 'none', 'pickup')),
  @('r2', @('pickup', 'baseline', 'none')),
  @('r3', @('none', 'pickup', 'baseline'))
)

foreach ($pair in $pairs) {
  $repeat = $pair[0]
  $order = $pair[1]
  $shared = "$results\e6-shared-$repeat.json"

  # phase 1: convergence session
  $runId = "e6-p1-$repeat"
  $taskText = $taskP1.Replace('RESULTFILE', "$runId.result.txt")
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.partial.json", "$results\$runId.result.txt", "$results\$runId.stdout.txt", $shared)) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_SCENARIO = 'e6'
  $env:EXP_PHASE = '1'
  $env:EXP_ARM = 'none'
  $env:EXP_RUN = "p1$repeat"
  $env:EXP_RESULTS_DIR = $results
  $env:EXP_SHARED_STATE = $shared
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  Log "START $runId"
  $job = Start-Job -ScriptBlock {
    param($taskText, $resultsDir)
    Set-Location $resultsDir
    dsh --profile exp $taskText *>&1
    "RUNEXIT:$LASTEXITCODE"
  } -ArgumentList $taskText, $results
  $finished = Wait-Job $job -Timeout 900
  if ($finished) {
    $out = Receive-Job $job
    $out | Out-File "$results\$runId.stdout.txt" -Encoding utf8
    Log "END   $runId"
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Log "TIMEOUT $runId"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue

  # phase 2: cold-start sessions
  foreach ($a in $order) {
    $runId = "e6-$a-$repeat"
    $taskText = $taskP2.Replace('RESULTFILE', "$runId.result.txt")
    foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.partial.json", "$results\$runId.result.txt", "$results\$runId.stdout.txt")) {
      Remove-Item $stale -Force -ErrorAction SilentlyContinue
    }
    $env:DSH_HOME = $expHome
    $env:EXP_SCENARIO = 'e6'
    $env:EXP_PHASE = '2'
    $env:EXP_ARM = $a
    $env:EXP_RUN = "p2$repeat"
    $env:EXP_RESULTS_DIR = $results
    $env:EXP_SHARED_STATE = $shared
    $env:DSH_PERMISSION_MODE = 'danger-full-access'
    Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
    Log "START $runId"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $job = Start-Job -ScriptBlock {
      param($taskText, $resultsDir)
      Set-Location $resultsDir
      dsh --profile exp $taskText *>&1
      "RUNEXIT:$LASTEXITCODE"
    } -ArgumentList $taskText, $results
    $finished = Wait-Job $job -Timeout 900
    if ($finished) {
      $out = Receive-Job $job
      $exitLine = $out | Select-String -Pattern '^RUNEXIT:' | Select-Object -Last 1
      $exitCode = if ($exitLine) { $exitLine.Line.Split(':')[1] } else { 'unknown' }
      $out | Out-File "$results\$runId.stdout.txt" -Encoding utf8
      Log "END   $runId exit=$exitCode elapsed=$([int]$sw.Elapsed.TotalSeconds)s"
    } else {
      Stop-Job $job -ErrorAction SilentlyContinue
      Log "TIMEOUT $runId (15min limit)"
    }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  }
}
Log "ALL DONE"
