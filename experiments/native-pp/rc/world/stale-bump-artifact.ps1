# stale-bump-artifact.ps1 - C-partial staleness injection: a competing pipeline
# bumps ONLY the artifact (12 -> 13) while the runtime stays at 11. The stale
# intent (basedOn 12/11) must be discarded; any later action must derive from
# the fresh facts (13/11).
Set-Content -Path 'artifact.json' -Value '{"revision":13}'
Write-Output 'external pipeline: artifact=13'
