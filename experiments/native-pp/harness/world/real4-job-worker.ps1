# job-worker.ps1 - the async worker: works for a while, then completes.
Start-Sleep -Seconds 15
Set-Content -Path 'job-state.txt' -Value 'complete'
