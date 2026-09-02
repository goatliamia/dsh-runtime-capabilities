# stale-bump.ps1 - C-arm staleness injection: a competing pipeline bumps the
# artifact AND the runtime while the continuation is still deciding. Runs only
# in EXP_ARM=c cells; materialized by the driver only for those cells.
Set-Content -Path 'artifact.json' -Value '{"revision":13}'
Set-Content -Path 'runtime-state.txt' -Value 'runtime_revision=13'
Write-Output 'external pipeline: artifact=13 runtime_revision=13'
