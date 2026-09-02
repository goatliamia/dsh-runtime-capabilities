# verify.ps1 - report the artifact vs runtime revision gap (fact carrier for
# the runtime_revision pattern). Robust when the build has not run yet.
if (-not (Test-Path 'artifact.json')) {
  Write-Output 'verify: no artifact.json yet (run build.ps1 first)'
  exit 0
}
$artifact = (Get-Content 'artifact.json' -Raw | ConvertFrom-Json).revision
$runtime = ((Get-Content 'runtime-state.txt' -Raw).Trim() -split '=', 2)[1].Trim()
if ($artifact -eq $runtime) {
  Set-Content -Path 'verify-result.txt' -Value "MATCH (artifact=$artifact runtime=$runtime)"
  Write-Output "verify: artifact=$artifact runtime_revision=$runtime => MATCH"
} else {
  Set-Content -Path 'verify-result.txt' -Value "STALE (artifact=$artifact runtime=$runtime)"
  Write-Output "verify: artifact=$artifact runtime_revision=$runtime => STALE"
}
