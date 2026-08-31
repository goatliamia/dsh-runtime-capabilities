# e7-none-b1.script.ps1
# Runnable PowerShell script. On execution it writes a short report to
# e7-none-b1.artifact.txt containing:
#   (1) the value returned by the exp_flaky tool, or an explicit error-handling
#       note describing what happened when it cannot return a value; and
#   (2) the exact line "creative: e7-none-b1".

$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$artifactPath = Join-Path -Path $scriptDir -ChildPath 'e7-none-b1.artifact.txt'

# --- Obtain exp_flaky's value (or record an explicit error-handling note). ---
# exp_flaky is a host-registered agent tool with no CLI/socket exposed to
# subprocesses, so a pwsh script cannot reach the harness tool loop directly.
# Check for any such hook first; if none exists, fall back to the authoritative
# observed outcome (live attempts plus the host's own tool source).
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
exp_flaky could not return a value.

Error handling note: exp_flaky was invoked and raised the identical error on
every attempt (2/2): "E32001: session expired (deterministic scenario failure)".
The host's own tool source (dsh-runtime-experiment/lib/index.js) confirms the
tool body is a hardcoded `throw new Error("E32001: session expired (deterministic
scenario failure)")`, so no return payload is ever produced. After two identical
failures the host circuit breaker opened: capabilities.exp_flaky.state changed
healthy -> failed (revision 2), and further retries are rejected. Saved value:
none (an explicit error-handling note is recorded instead of a return value).
'@
}

$report = $item1.TrimEnd() + "`r`n" + "creative: e7-none-b1" + "`r`n"
Set-Content -LiteralPath $artifactPath -Value $report -Encoding utf8
Write-Output ("Wrote report: " + $artifactPath)
