# job-start.ps1 - start the async job. The completion transition is driven by
# the experiment host (platform event substrate), not by a child process.
Set-Content -Path 'job-state.txt' -Value 'running'
Write-Output 'job started (state=running)'
