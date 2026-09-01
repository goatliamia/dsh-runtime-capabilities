# driver-pp5.ps1 - real2 (non-atomic deploy) + real4 (async polling) cells.
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$harness = '<REPO>\experiments\native-pp\harness'
$world = "$harness\world"
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver5.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Reset-World($scenario) {
  foreach ($transient in @('config.json','runtime-state.txt','verify-result.txt','reload-marker.txt','build.log','test-result.txt','result.txt','count.txt','attempts.txt','math.js','test.js','run-tests.ps1','apply-config.ps1','verify.ps1','reload.ps1','deploy.ps1','deploy-count.txt','job-state.txt','status-count.txt','job-start.ps1','job-worker.ps1','status.ps1')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  if ($scenario -eq 'real2') {
    Copy-Item "$world\real2-deploy.ps1" "$results\deploy.ps1" -Force
  } elseif ($scenario -eq 'real4') {
    Copy-Item "$world\real4-job-start.ps1" "$results\job-start.ps1" -Force
    Copy-Item "$world\real4-job-worker.ps1" "$results\job-worker.ps1" -Force
    Copy-Item "$world\real4-status.ps1" "$results\status.ps1" -Force
  }
}

function Run-Cell($runId, $profile, $scenario, $taskText, $arm) {
  Reset-World $scenario
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  $env:EXP_SCENARIO = $scenario; $env:EXP_RUN = $runId.Split('-')[1]; $env:EXP_ARM = $arm; $env:EXP_MODE = 'live'
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
  foreach ($artifact in @('config.json','runtime-state.txt','verify-result.txt','reload-marker.txt','build.log','test-result.txt','result.txt','deploy-count.txt','job-state.txt','status-count.txt')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
}

function Read-Task($name) {
  return (Get-Content -Raw "$harness\$name").Trim()
}

foreach ($run in @('b1','b2')) {
  Run-Cell "real2-$run" 'pp-f' 'real2' (Read-Task 'task-real2.txt') 'baseline'
}
foreach ($run in @('a1','a2')) {
  Run-Cell "real2-$run" 'pp-g' 'real2' (Read-Task 'task-real2.txt') 'aware'
}
foreach ($run in @('b1','b2')) {
  Run-Cell "real4-$run" 'pp-f' 'real4' (Read-Task 'task-real4.txt') 'baseline'
}
foreach ($run in @('a1','a2')) {
  Run-Cell "real4-$run" 'pp-g' 'real4' (Read-Task 'task-real4.txt') 'aware'
}

Log "ALL DONE"
