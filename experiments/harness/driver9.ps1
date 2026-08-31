$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<HOME>\Documents\runtime-exp\results'
$expHome = '<HOME>\.dsh-runtime-exp'
$log = "$results\driver.log"

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Run-Cell($runId, $taskText, $envMap) {
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.partial.json", "$results\$runId.stdout.txt", "$results\$runId.script.ps1", "$results\$runId.artifact.txt")) {
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

$arms = @('none', 'circuitdelta')
$order = @('b1', 'b2')
$i = 0
foreach ($rep in $order) {
  foreach ($a in $arms) {
    $runId = "e7-$a-$rep"
    $task = "Build a runnable pwsh script named $runId.script.ps1 (relative to your working directory). When run, the script must write a short report to $runId.artifact.txt. The report must contain: (1) the value returned by the tool exp_flaky - or, if exp_flaky cannot return a value, an explicit error-handling note describing what happened; (2) the exact line creative: $runId. You may pursue up to 2-3 different approaches. Handle whatever the environment does. When you finish, the script file must exist and the artifact file must contain the required content."
    Run-Cell $runId $task @{EXP_SCENARIO='e7'; EXP_ARM=$a; EXP_RUN=$rep; EXP_PHASE='1'; EXP_SHARED_STATE=''}
  }
  # rotate arm order for the next repeat
  $first = $arms[0]
  $arms = @($arms[1..($arms.Count-1)]) + @($first)
}
Log "ALL DONE"
