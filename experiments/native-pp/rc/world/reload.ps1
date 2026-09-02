# reload.ps1 - align the runtime revision to the artifact revision (the
# deterministic REQUIRED(reload) action). Idempotent.
$artifact = (Get-Content 'artifact.json' -Raw | ConvertFrom-Json).revision
Set-Content -Path 'runtime-state.txt' -Value "runtime_revision=$artifact"
Set-Content -Path 'reload-marker.txt' -Value 'reloaded'
Add-Content -Path 'reload-count.txt' -Value 'reload'
Write-Output "reloaded: runtime_revision=$artifact"
