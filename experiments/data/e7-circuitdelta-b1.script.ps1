# e7-circuitdelta-b1.script.ps1
# Generates e7-circuitdelta-b1.artifact.txt containing:
#   (1) the value returned by exp_flaky, or an explicit error-handling note
#   (2) the exact line: creative: e7-circuitdelta-b1

$ErrorActionPreference = 'Stop'

# Resolve paths relative to the directory containing this script.
if ($PSScriptRoot) {
    $scriptDir = $PSScriptRoot
} else {
    $scriptDir = (Get-Location).Path
}
$artifact = Join-Path $scriptDir 'e7-circuitdelta-b1.artifact.txt'

# ---------------------------------------------------------------------------
# exp_flaky is an orchestrator/host tool (not a pwsh command). It was invoked
# from the agent environment and did NOT return a value. Record an explicit
# error-handling note describing exactly what happened.
# ---------------------------------------------------------------------------
$expFlakyReport = @(
    'exp_flaky result: no value returned.'
    'Error-handling note: the exp_flaky tool was invoked twice and failed both times with the error "E32001: session expired (deterministic scenario failure)". Environment probes (exp_probe) confirmed the session, the runner, and the required plugin were otherwise healthy, so the failure was specific to exp_flaky. The host runtime then reported capabilities.exp_flaky.state = "failed" and directed that retries stop. Therefore exp_flaky cannot return a value in this environment.'
)

$creativeLine = 'creative: e7-circuitdelta-b1'

$reportLines = $expFlakyReport + $creativeLine

Set-Content -Path $artifact -Value $reportLines -Encoding UTF8

Write-Output "Report written to: $artifact"
