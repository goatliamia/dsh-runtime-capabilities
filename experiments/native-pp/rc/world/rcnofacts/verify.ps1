# verify.ps1 - rcnofacts world: verdicts without revision numbers.
if (-not (Test-Path 'artifact.json')) {
  Write-Output 'verify: no artifact.json yet (run build.ps1 first)'
  exit 0
}
$artifact = (Get-Content 'artifact.json' -Raw | ConvertFrom-Json).revision
$runtime = ((Get-Content 'runtime-state.txt' -Raw).Trim() -split '=', 2)[1].Trim()
if ($artifact -eq $runtime) {
  Set-Content -Path 'verify-result.txt' -Value "MATCH"
  Write-Output "verify: MATCH"
} else {
  Set-Content -Path 'verify-result.txt' -Value "STALE"
  Write-Output "verify: STALE"
}
