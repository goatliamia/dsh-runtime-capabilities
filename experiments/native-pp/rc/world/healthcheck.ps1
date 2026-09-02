# healthcheck.ps1 - the rchain scenario's second deterministic hop: after the
# reload, a health check is the unique next action. Runtime A (reload) ->
# Runtime B (healthcheck) -> Model digests, with no model call in between.
Set-Content -Path 'health-check.txt' -Value 'ok'
Write-Output 'health=ok'
