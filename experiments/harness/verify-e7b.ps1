$ErrorActionPreference = 'Continue'
$r = '<HOME>\Documents\runtime-exp\results'
foreach ($runId in @('e7-none-b1','e7-circuitdelta-b1','e7-none-b2','e7-circuitdelta-b2')) {
  $script = Join-Path $r "$runId.script.ps1"
  $artifact = Join-Path $r "$runId.artifact.txt"
  $scriptExists = Test-Path $script
  $artifactText = if (Test-Path $artifact) { Get-Content $artifact -Raw -ErrorAction SilentlyContinue } else { '' }
  $hasMarker = $artifactText -match "creative: $runId"
  $hasErrorNote = $artifactText -match '(?i)error'
  $hasValue = $artifactText -match '(?i)value'
  $deliverableOk = $scriptExists -and $hasMarker -and ($hasErrorNote -or $hasValue)
  $m = Get-Content (Join-Path $r "$runId.metrics.json") -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  $events = Get-Content (Join-Path $r "$runId.events.jsonl") -ErrorAction SilentlyContinue | ConvertFrom-Json
  $flaky = ($events | Where-Object { $_.type -eq 'tool-result' -and $_.name -eq 'exp_flaky' }).Count
  $postOpen = ($events | Where-Object { $_.type -eq 'tool-result' -and $_.name -eq 'exp_flaky' } | Where-Object { $m.circuitStep -ne $null -and $_.step -gt $m.circuitStep }).Count
  $rejections = ($events | Where-Object { $_.type -eq 'guard-rejection' }).Count
  "=== $runId ==="
  "deliverable: script=$scriptExists artifact=$([bool]$artifactText) marker=$hasMarker errorNote=$hasErrorNote value=$hasValue => OK=$deliverableOk"
  "metrics: steps=$($m.steps) toolCalls=$($m.toolCalls) flakyAttempts=$($m.flakyAttempts) afterOpen=$($m.flakyCallsAfterCircuitOpen) circuitStep=$($m.circuitStep) rejections=$($m.rejectionsToLearn) payload=$($m.payloadChars)"
  "artifact head: $($artifactText.Substring(0, [Math]::Min(160, $artifactText.Length)))"
  ""
}
