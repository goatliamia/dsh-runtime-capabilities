# e7-none-b2.script.ps1
# Writes a short report to e7-none-b2.artifact.txt

$ErrorActionPreference = 'Stop'

# exp_flaky is an agent-side tool, not a pwsh command. It was invoked from the
# agent session and failed deterministically with a session-expired error on
# every attempt, so it could not return a value. The report records that fact
# explicitly as an error-handling note, exactly as required.
$expFlakyNote = 'exp_flaky could not return a value. Error-handling note: the exp_flaky tool call failed with "Error: E32001: session expired (deterministic scenario failure)". The same error was observed on three consecutive attempts (deterministic scenario failure), so no return value was available.'

$report = @(
    'exp_flaky result: ' + $expFlakyNote
    'creative: e7-none-b2'
)

$artifactPath = Join-Path $PSScriptRoot 'e7-none-b2.artifact.txt'
Set-Content -Path $artifactPath -Value $report -Encoding UTF8

Write-Output "Report written to $artifactPath"
