$ErrorActionPreference = 'Continue'
$env:Path = "<HOME>\AppData\Roaming\npm;$env:Path"
$results = '<HOME>\Documents\runtime-exp\results'
$expHome = '<HOME>\.dsh-runtime-exp'
$log = "$results\driver.log"

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

$tasks = @{
  s1 = "You are in an isolated DSH runtime test. Determine whether the tool named exp_tmp_paint is available to you RIGHT NOW. If it is available, call it once, then write the exact word painted to the file RESULTFILE (relative to your working directory). If it is not available, write the exact word absent to that same file. After writing the file, finish with a one-line report stating whether the tool was available and how you determined it. Do not guess; verify before acting."
  s2 = "Determine the current lifecycle state of the plugin named exp_probe_plugin in this DSH host. Its state is one of: declared, mounted, ready. Write the exact state word to the file RESULTFILE (relative to your working directory) only when you are confident of the current state, then finish with a one-line report of the state and how you determined it."
  s3 = "Report the dependency topology of the current DSH host. If you cannot obtain this information from an authoritative source, you must answer unknown explicitly rather than guessing. Write your final answer (either a concrete topology description or the exact word unknown) to the file RESULTFILE (relative to your working directory), then finish with a one-line report."
}

# 18 runs: repeat 1 in arm order A,B,C; repeat 2 rotated C,A,B (dilutes time-order confound).
$matrix = New-Object System.Collections.Generic.List[object]
foreach ($s in @('s1', 's2', 's3')) {
  foreach ($a in @('A', 'B', 'C')) { $matrix.Add(@($s, $a, 'r1')) }
  foreach ($a in @('C', 'A', 'B')) { $matrix.Add(@($s, $a, 'r2')) }
}

foreach ($row in $matrix) {
  $s = $row[0]; $a = $row[1]; $r = $row[2]
  $runId = "$s-arm-$($a.ToLower())-$r"
  $task = $tasks[$s].Replace('RESULTFILE', "$runId.result.txt")
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
  } -ArgumentList $task, $results
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
