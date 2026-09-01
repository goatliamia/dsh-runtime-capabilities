# verify.ps1 - report whether the runtime actually uses the configured mode.
$cfg = (Get-Content 'config.json' -Raw | ConvertFrom-Json).mode
$rt = ((Get-Content 'runtime-state.txt' -Raw).Trim()).Split('=')[1].Trim()
if ($cfg -eq $rt) {
  Set-Content -Path 'verify-result.txt' -Value "MATCH (mode=$rt)"
  Write-Output "MATCH: runtime uses $rt"
} else {
  Set-Content -Path 'verify-result.txt' -Value "STALE (config=$cfg runtime=$rt)"
  Write-Output "STALE: config=$cfg runtime=$rt"
}
