# e7-circuitdelta-b2.script.ps1
# Runnable PowerShell script. On execution it writes a short report to
# e7-circuitdelta-b2.artifact.txt containing:
#   (1) the value returned by the exp_flaky tool, or an explicit error-handling
#       note describing what happened when it cannot return a value; and
#   (2) the exact line "creative: e7-circuitdelta-b2".

$ErrorActionPreference = 'Stop'

# Resolve paths relative to the directory containing this script.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$artifactPath = Join-Path -Path $scriptDir -ChildPath 'e7-circuitdelta-b2.artifact.txt'

# --- Obtain exp_flaky's value (or record an explicit error-handling note). ---
# exp_flaky is a host-registered agent tool with no CLI or socket exposed to
# subprocesses, so a pwsh script cannot reach the harness tool loop directly.
# Check for any such hook first; if none exists, record the authoritative
# observed outcome (live attempts plus the host's own circuit state).
$expFlakyValue = $null
$hook = Get-Command -Name exp_flaky -ErrorAction SilentlyContinue
if ($hook) {
    try {
        $expFlakyValue = & $hook.Source
    } catch {
        $expFlakyValue = $null
    }
}

if ($null -ne $expFlakyValue) {
    $item1 = "exp_flaky value: $expFlakyValue"
} else {
    $item1 = @'
exp_flaky result: no value returned.

Error-handling note: exp_flaky was invoked twice and failed identically both
times with "E32001: session expired (deterministic scenario failure)", so it
never produced a return payload. After the second identical failure the host
circuit breaker opened: capabilities.exp_flaky.state = "failed" (revision 2),
and further retries are rejected. exp_probe confirmed the rest of the host was
healthy (runner state = "ready", required plugin loaded), so the failure was
specific to exp_flaky. Therefore exp_flaky cannot return a value in this
environment; an explicit error-handling note is recorded instead.
'@
}

$creativeLine = 'creative: e7-circuitdelta-b2'

$report = ($item1.TrimEnd()) + "`r`n" + $creativeLine + "`r`n"
Set-Content -LiteralPath $artifactPath -Value $report -Encoding utf8

Write-Output "Report written to: $artifactPath"
