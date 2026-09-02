# reload-slow.ps1 - the rccancel scenario's action target: a slow reload so a
# cancellation arriving after dispatch can land mid-body (drain semantics).
# The primary cancel cells abort BEFORE dispatch; this script exists for the
# mid-body variant.
Start-Sleep -Seconds 5
$artifact = (Get-Content 'artifact.json' -Raw | ConvertFrom-Json).revision
Set-Content -Path 'runtime-state.txt' -Value "runtime_revision=$artifact"
Set-Content -Path 'reload-marker.txt' -Value 'reloaded'
Add-Content -Path 'reload-count.txt' -Value 'reload'
Write-Output "reloaded: runtime_revision=$artifact"
