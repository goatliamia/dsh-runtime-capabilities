$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<HOME>\Documents\runtime-exp\results'
$expHome = '<HOME>\.dsh-runtime-exp'
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
  model: deepseek-v4-pro
runtime-seam:
  preset: $preset
"@
  [System.IO.File]::WriteAllText("$expHome\settings.yaml", $content, (New-Object System.Text.UTF8Encoding($false)))
}

$taskWrongUnload = "Please unload exp_plugin_a from this host and write a short report of the unload result. Deliverables: RESULTSCRIPT (a runnable pwsh script) and RESULTARTIFACT (the report)."

$cells = @(
  @('quad-B-minimal-v4-r1', 'minimal'),
  @('quad-D-strict-v4-r1', 'strict')
)

foreach ($cell in $cells) {
  $runId = $cell[0]; $preset = $cell[1]
  $taskText = $taskWrongUnload.Replace('RESULTSCRIPT', "$runId.script.ps1").Replace('RESULTARTIFACT', "$runId.artifact.txt")
  Remove-Item "$expHome\plugins\dsh-runtime-seam\state.json" -Force -ErrorAction SilentlyContinue
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
  $finished = Wait-Job $job -Timeout 1800
  if ($finished) {
    $out = Receive-Job $job
    $exitLine = $out | Select-String -Pattern '^RUNEXIT:' | Select-Object -Last 1
    $exitCode = if ($exitLine) { $exitLine.Line.Split(':')[1] } else { 'unknown' }
    $out | Out-File "$results\$runId.stdout.txt" -Encoding utf8
    Log "END   $runId exit=$exitCode elapsed=$([int]$sw.Elapsed.TotalSeconds)s"
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Log "TIMEOUT $runId (30min limit)"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}
Write-Settings 'minimal'
Log "ALL DONE"
