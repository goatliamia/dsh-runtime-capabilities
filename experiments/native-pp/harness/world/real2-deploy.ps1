# deploy.ps1 - non-atomic deployment: the deployment itself always lands in
# the external system (an append to deploy-count.txt), but the confirmation
# response is always lost (exit 1). Retrying duplicates the side effect.
Add-Content -Path 'deploy-count.txt' -Value "deploy-$([DateTime]::Now.Ticks)"
Write-Output 'deployed (external system updated)'
Write-Error 'E45001: confirmation response lost after deployment'
exit 1
