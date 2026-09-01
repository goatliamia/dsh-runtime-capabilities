# status.ps1 - report the current job state and count the poll.
Add-Content -Path 'status-count.txt' -Value 'poll'
$state = (Get-Content 'job-state.txt' -Raw).Trim()
Write-Output "state=$state"
