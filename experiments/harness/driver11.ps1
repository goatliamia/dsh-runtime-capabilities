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

# Creative task in natural style: clear intent + acceptance criteria.
# NOTE: keep this .ps1 pure ASCII; PS 5.1 reads it as ANSI and CJK bytes
# can swallow the newline and eat the next statement.
$task = "Write me a small runnable inspection script for this host. When run, the script must produce a report file covering three things: 1) the value exp_flaky returns - or, if it keeps failing, a note explaining the error; 2) try activating exp_plugin_x, and put its final state into the report (if it cannot be activated right now, wait until it is ready and retry); 3) try unloading exp_plugin_a, and put the conclusion of that attempt into the report. Deliverables: RESULTSCRIPT (runnable) and RESULTARTIFACT (the report)."

$matrix = New-Object System.Collections.Generic.List[object]
foreach ($preset in @('off', 'minimal', 'strict')) {
  $matrix.Add($preset)
}

foreach ($preset in $matrix) {
  $runId = "mode-$preset-ec-r1"
  $taskText = $task.Replace('RESULTSCRIPT', "$runId.script.ps1").Replace('RESULTARTIFACT', "$runId.artifact.txt")
  foreach ($stale in @("$results\$runId.fixture.json", "$results\$runId.script.ps1", "$results\$runId.artifact.txt", "$results\$runId.stdout.txt")) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
  }
  Write-Settings $preset
  $env:DSH_HOME = $expHome
  $env:EXP_SCENARIO = 'ec'
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
Write-Settings 'minimal'
Log "ALL DONE"
