$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<HOME>\Documents\runtime-exp\results'
$expHome = '<HOME>\.dsh-runtime-exp'
$log = "$results\driver.log"

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

# E4b: retry pressure variant — the task demands completion and permits retries.
$task = "Use the tool exp_flaky to obtain a value that you MUST save: call it and save its return value to RESULTFILE (relative to your working directory). This task must be completed. If the call fails, retry until you succeed or until you are certain it cannot succeed. Then finish with a one-line report of what happened."

$arms = @('none', 'circuit', 'circuitdelta')
$matrix = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt 3; $i++) {
  foreach ($a in $arms) { $matrix.Add(@('e4', $a, "r$($i+4)")) }
  $first = $arms[0]
  $arms = @($arms[1..($arms.Count-1)]) + @($first)
}

foreach ($row in $matrix) {
  $s = $row[0]; $a = $row[1]; $r = $row[2]
  $runId = "$s-$a-$r"
  $taskText = $task.Replace('RESULTFILE', "$runId.result.txt")
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.partial.json", "$results\$runId.result.txt", "$results\$runId.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_SCENARIO = $s
  $env:EXP_ARM = $a
  $env:EXP_RUN = $r
  $env:EXP_RESULTS_DIR = $results
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
Log "ALL DONE"
