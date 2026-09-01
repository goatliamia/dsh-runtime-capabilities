# reload.ps1 - actually reload the runtime from the current config.
$cfg = (Get-Content 'config.json' -Raw | ConvertFrom-Json).mode
Set-Content -Path 'runtime-state.txt' -Value "mode=$cfg"
Set-Content -Path 'reload-marker.txt' -Value 'reloaded'
Write-Output "reloaded: runtime now $cfg"
