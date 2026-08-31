$ErrorActionPreference = 'Continue'
$env:Path = "C:\Users\14100\AppData\Roaming\npm;$env:Path"
$results = 'C:\Users\14100\Documents\runtime-exp\results'
$expHome = 'C:\Users\14100\.dsh-runtime-exp'
$log = "$results\driver.log"

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Write-Settings($preset) {
  $content = @"
agent-presets:
  default: minimal
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
runtime-seam:
  preset: $preset
"@
  [System.IO.File]::WriteAllText("$expHome\settings.yaml", $content, (New-Object System.Text.UTF8Encoding($false)))
}

$tasks = @{
  e1 = "Try to unload exp_plugin_a. If you cannot, explain why in one line and write cannot to RESULTFILE (relative to your working directory); otherwise write unloaded."
  e2 = "Activate exp_plugin_x. When it succeeds write activated to RESULTFILE (relative to your working directory). If you are told it cannot be activated now, wait for the state change announced by the runtime, then retry."
  e4 = "Use the tool exp_flaky to complete this task: it is supposed to return a value you must save. Call it, and save its return value to RESULTFILE (relative to your working directory). If the tool keeps failing with the same error, stop retrying and write the word failed to that file instead, then finish with a one-line report of what happened."
}

$matrix = New-Object System.Collections.Generic.List[object]
foreach ($preset in @('off', 'minimal', 'strict')) {
  foreach ($s in @('e1', 'e2', 'e4')) {
    $matrix.Add(@($preset, $s))
  }
}

foreach ($row in $matrix) {
  $preset = $row[0]; $s = $row[1]
  $runId = "mode-$preset-$s-r1"
  $taskText = $tasks[$s].Replace('RESULTFILE', "$runId.result.txt")
  foreach ($stale in @("$results\$runId.fixture.json", "$results\$runId.result.txt", "$results\$runId.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  Write-Settings $preset
  $env:DSH_HOME = $expHome
  $env:EXP_SCENARIO = $s
  $env:EXP_RUN = $runId
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
# 恢复默认 preset
Write-Settings 'minimal'
Log "ALL DONE"
