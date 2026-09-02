# driver-rc5.ps1 - round 2 chain phase: Runtime reload -> Runtime healthcheck
# -> Model digests (rchain scenario, 2 cells). Runs after the boundary matrix.
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$world = '<REPO>\experiments\native-pp\rc\world'
$taskChain = '<REPO>\experiments\native-pp\rc\task-rchain.txt'
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver-rc5.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Run-Cell($runId, $profile, $scenario, $taskText, $arm) {
  foreach ($transient in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','health-check.txt','build.ps1','verify.ps1','reload.ps1','healthcheck.ps1','result.txt')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
  Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
  Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
  Copy-Item "$world\healthcheck.ps1" "$results\healthcheck.ps1" -Force
  Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.world.json", "$results\$runId.continuation.json", "$results\$runId.stdout.txt", "$results\$runId.verify-continuation.json")) {
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
  foreach ($artifact in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','health-check.txt','result.txt')) {
    if (Test-Path "$results\$artifact") { Copy-Item "$results\$artifact" "$results\$runId.$artifact" -Force }
  }
}

$taskText = (Get-Content -Raw $taskChain).Trim()
foreach ($run in @('h1','h2')) {
  Run-Cell "rchain-$run" 'rc-c' 'rchain' $taskText 'b'
}
Log "ALL DONE"
