# rollback.ps1 - the rcmulti scenario's SECOND legal next action: revert the
# artifact to the runtime's revision. With both reload and rollback matching
# the same facts, the action set is ambiguous and the Runtime must NOT take
# over (narrow standard: unique action only).
$runtime = ((Get-Content 'runtime-state.txt' -Raw).Trim() -split '=', 2)[1].Trim()
Set-Content -Path 'artifact.json' -Value "{`"revision`":$runtime}"
Add-Content -Path 'rollback-count.txt' -Value 'rollback'
Write-Output "rollback: artifact=$runtime"
