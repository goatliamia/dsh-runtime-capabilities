$ErrorActionPreference = 'Continue'
$results = '<HOME>\Documents\ctx-place-exp\results'
$expHome = '<HOME>\.dsh-place-exp'
$log = Join-Path $results 'driver.log'
New-Item -ItemType Directory -Force -Path $results | Out-Null

function Log($msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

$task = "Read the file tags.txt in your working directory to learn the project build tag. Write the build tag into a new file BUILD_TAG.txt in your working directory. Then report the value you wrote in one line like: wrote vX.Y.Z"

$arms = @('baseline', 'section', 'context', 'prestep', 'prestep-once')
$reps = 3

foreach ($arm in $arms) {
  for ($rep = 1; $rep -le $reps; $rep++) {
    $runId = "place-$arm-r$rep"
    $runDir = Join-Path $results $runId
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    Set-Content -Path (Join-Path $runDir 'tags.txt') -Value 'v2.1.0' -Encoding ASCII

    $env:EXP_ARM = $arm
    $env:DSH_HOME = $expHome
    $start = Get-Date

    Push-Location $runDir
    try {
      & dsh --profile place $task *> (Join-Path $runDir 'stdout.txt')
      $code = $LASTEXITCODE
    } catch {
      $code = 'exception'
    } finally {
      Pop-Location
    }

    $tagFile = Join-Path $runDir 'BUILD_TAG.txt'
    $tag = ''
    if (Test-Path $tagFile) {
      $tag = (Get-Content $tagFile -Raw).Trim()
      Copy-Item $tagFile (Join-Path $runDir 'build-tag.txt')
    }

    # one session transcript per run: newest .jsonl under the home written
    # after this run started
    $session = Get-ChildItem (Join-Path $expHome 'sessions') -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -eq '.jsonl' -and $_.LastWriteTime -ge $start } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($session) {
      Copy-Item $session.FullName (Join-Path $runDir 'transcript.jsonl')
    } else {
      Log "$runId NO-SESSION-FILE"
    }

    $elapsed = [int]((Get-Date) - $start).TotalSeconds
    Log "$runId exit=$code tag=[$tag] seconds=$elapsed"
  }
}
Log "ALL DONE"
