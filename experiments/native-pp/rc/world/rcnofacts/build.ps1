# build.ps1 - rcnofacts scenario: the world works, but NO output carries the
# prepared fact formats (no "artifact=", no "runtime_revision="). The Runtime
# must abstain: without its prepared fact channels there is no evidence, so
# control stays with the Model.
Set-Content -Path 'artifact.json' -Value '{"revision":12}'
Write-Output 'BUILD OK'
