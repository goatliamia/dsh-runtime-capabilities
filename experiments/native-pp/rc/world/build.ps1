# build.ps1 - produce a new artifact revision (deterministic world, docs/19).
Set-Content -Path 'artifact.json' -Value '{"revision":12}'
Write-Output 'BUILD OK artifact=12'
