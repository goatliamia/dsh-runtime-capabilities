# build.ps1 - rcbait scenario: the SOURCE deliberately contains misleading
# literals (artifact=12 runtime_revision=11) while the REAL output is
# artifact=13. A Get-Content view of this file echoes the bait; the Runtime's
# fact gate must reject source echoes and stay on the real execution fact.
# legacy note: the old pipeline printed artifact=12 runtime_revision=11
Set-Content -Path 'artifact.json' -Value '{"revision":13}'
Write-Output 'BUILD OK artifact=13'
