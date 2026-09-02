# driver-rc8.ps1 - round 4: Intent / Event / Runtime / Model ownership boundary.
# Scenario rcc4 (Pre continuation + Post facts-guard merged, one projection).
# Part 1: intent x world cells (A intent / B action / C forced / D wrong premise).
# Part 3: clean chain re-run. Part 4: chainstale x2 (mid-chain invalidation).
# ALL ASCII (PS 5.1 encoding discipline, docs/bugs/004).
$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<REPO>\experiments\native-pp\results'
$world = '<REPO>\experiments\native-pp\rc\world'
$taskA = '<REPO>\experiments\native-pp\rc\task-c4-a.txt'
$taskB = '<REPO>\experiments\native-pp\rc\task-c4-b.txt'
$taskC = '<REPO>\experiments\native-pp\rc\task-c4-c.txt'
$taskD = '<REPO>\experiments\native-pp\rc\task-c4-d.txt'
$taskChain = '<REPO>\experiments\native-pp\rc\task-rchain.txt'
$expHome = '<HOME>\.dsh-native-pp-exp'
$log = "$results\driver-rc8.log"

New-Item -ItemType Directory -Force $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Reset-World($aligned, $withHealthcheck) {
  foreach ($transient in @('artifact.json','runtime-state.txt','verify-result.txt','reload-marker.txt','reload-count.txt','health-check.txt','build.ps1','verify.ps1','reload.ps1','healthcheck.ps1','result.txt')) {
    Remove-Item "$results\$transient" -Force -ErrorAction SilentlyContinue
  }
  Copy-Item "$world\build.ps1" "$results\build.ps1" -Force
  Copy-Item "$world\verify.ps1" "$results\verify.ps1" -Force
  Copy-Item "$world\reload.ps1" "$results\reload.ps1" -Force
  if ($withHealthcheck) { Copy-Item "$world\healthcheck.ps1" "$results\healthcheck.ps1" -Force }
  if ($aligned) {
    Copy-Item "$world\rccont-aligned\runtime-state.txt" "$results\runtime-state.txt" -Force
    Copy-Item "$world\rccont-aligned\artifact.json" "$results\artifact.json" -Force
  } else {
    Copy-Item "$world\runtime-state.txt" "$results\runtime-state.txt" -Force
  }
}

function Run-Cell($runId, $profile, $taskText, $aligned, $arm, $withHealthcheck) {
  Reset-World $aligned $withHealthcheck
  foreach ($stale in @("$results\$runId.metrics.json", "$results\$runId.events.jsonl", "$results\$runId.world.json", "$results\$runId.continuation.json", "$results\$runId.stdout.txt", "$results\$runId.verify-continuation.json")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  $env:DSH_HOME = $expHome
  $env:EXP_RESULTS_DIR = $results
  $env:DSH_PERMISSION_MODE = 'danger-full-access'
  Remove-Item Env:DSH_TOOLS_MODE -ErrorAction SilentlyContinue
  $env:EXP_SCENARIO = 'rcc4'
  $env:EXP_RUN = ($runId -split '-', 2)[1]
  $env:EXP_ARM = $arm
  $env:EXP_MODE = 'live'
  Remove-Item Env:EXP_CONT_INJECT -ErrorAction SilentlyContinue
  Log "START $runId profile=$profile arm=$arm aligned=$aligned"
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

$tA = (Get-Content -Raw $taskA).Trim()
$tB = (Get-Content -Raw $taskB).Trim()
$tC = (Get-Content -Raw $taskC).Trim()
$tD = (Get-Content -Raw $taskD).Trim()
$tChain = (Get-Content -Raw $taskChain).Trim()

# Part 1: intent x world
foreach ($run in @('aa1','aa2')) { Run-Cell "rcc4-$run" 'rc-c' $tA $true 'b' $false }
foreach ($run in @('am1','am2')) { Run-Cell "rcc4-$run" 'rc-c' $tA $false 'b' $false }
foreach ($run in @('ba1','ba2')) { Run-Cell "rcc4-$run" 'rc-c' $tB $true 'b' $false }
foreach ($run in @('bm1','bm2')) { Run-Cell "rcc4-$run" 'rc-c' $tB $false 'b' $false }
foreach ($run in @('ca1','ca2')) { Run-Cell "rcc4-$run" 'rc-c' $tC $true 'b' $false }
foreach ($run in @('cm1','cm2')) { Run-Cell "rcc4-$run" 'rc-c' $tC $false 'b' $false }
Run-Cell 'rcc4-da1' 'rc-c' $tD $true 'b' $false

# Part 3: clean chain re-run (arm chain adds the post-reload hop)
Run-Cell 'rcc4-chain1' 'rc-c' $tChain $false 'chain' $true

# Part 4: mid-chain staleness (competing actor completes B's premise)
foreach ($run in @('stale1','stale2')) { Run-Cell "rcc4-$run" 'rc-c' $tChain $false 'chainstale' $true }

Log "ALL DONE"
