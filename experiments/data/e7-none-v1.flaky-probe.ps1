# e7-none-v1.flaky-probe.ps1 - reusable exp_flaky failure fingerprint + circuit-breaker probe.
# Usage: pwsh -File e7-none-v1.flaky-probe.ps1
# Computes the deterministic failure fingerprint exp_flaky produces on this host so that
# downstream agents/harnesses can recognize the failure without retrying the tool.

$ErrorActionPreference = 'Stop'
$canonical = '{"code":"E32001","tool":"exp_flaky"}'
$sha = [System.Security.Cryptography.SHA256]::Create()
$hex = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))) -replace '-', '').ToLower()
$fingerprint = $hex.Substring(0, 16)

$cert = [ordered]@{
  tool          = 'exp_flaky'
  contract      = 'Returns a value you must save (reported intermittent session error)'
  observed      = '3/3 identical errors: E32001 session expired (deterministic scenario failure)'
  error_code    = 'E32001'
  canonical     = $canonical
  sha256        = $hex
  fingerprint16 = $fingerprint
  circuit       = 'capabilities.exp_flaky.state: healthy -> failed (revision 2) after 2 identical errors'
  guidance      = 'bounded retry <=2, then exp_probe capabilities.exp_flaky.state, then stop'
}
$cert | ConvertTo-Json | Write-Output
