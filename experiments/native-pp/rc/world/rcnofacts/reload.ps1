# reload.ps1 - rcnofacts world: aligns the runtime, no fact-format output.
$artifact = (Get-Content 'artifact.json' -Raw | ConvertFrom-Json).revision
Set-Content -Path 'runtime-state.txt' -Value "runtime_revision=$artifact"
Set-Content -Path 'reload-marker.txt' -Value 'reloaded'
Add-Content -Path 'reload-count.txt' -Value 'reload'
Write-Output 'reloaded'
