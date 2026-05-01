. "$PSScriptRoot\Common.ps1"

Test-DockerAvailable

$state = Get-ContainerState
if ($state -ne 'running') {
  throw "Docker QA fixture is not running. Start it first with 'npm run qa:docker:start'."
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tempRoot = Join-Path $env:TEMP ('sftp-zip-gun-vsix-smoke-' + [guid]::NewGuid().ToString('N'))
$userDataDir = Join-Path $tempRoot 'user-data'
$extensionsDir = Join-Path $tempRoot 'extensions'
$unpackDir = Join-Path $tempRoot 'unpacked'

New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
New-Item -ItemType Directory -Path $extensionsDir -Force | Out-Null
New-Item -ItemType Directory -Path $unpackDir -Force | Out-Null

Push-Location $repoRoot
try {
  & npm run package
  if ($LASTEXITCODE -ne 0) {
    throw 'VSIX packaging failed.'
  }

  $vsix = Get-ChildItem -LiteralPath $repoRoot -Filter 'sftp-zip-gun-*.vsix' |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if (-not $vsix) {
    throw 'No VSIX file was produced by npm run package.'
  }

  $codeCli = Get-CodeCliPath
  & $codeCli --user-data-dir $userDataDir --extensions-dir $extensionsDir --install-extension $vsix.FullName --force
  if ($LASTEXITCODE -ne 0) {
    throw 'VSIX installation into the isolated smoke profile failed.'
  }

  Expand-Archive -LiteralPath $vsix.FullName -DestinationPath $unpackDir -Force
  $extensionPath = Join-Path $unpackDir 'extension'
  if (-not (Test-Path -LiteralPath $extensionPath)) {
    throw 'Expanded VSIX did not contain the expected extension/ directory.'
  }

  $env:SFTP_ZIP_GUN_QA_ROOT = Get-QARoot
  $env:SFTP_ZIP_GUN_SMOKE_MODE = 'vsix'
  $env:SFTP_ZIP_GUN_TEST_MODE = '1'

  & node (Join-Path $PSScriptRoot 'run-vscode-smoke.js') `
    --extensionPath $extensionPath `
    --userDataDir $userDataDir `
    --extensionsDir $extensionsDir `
    --qaRoot (Get-QARoot) `
    --mode vsix
  if ($LASTEXITCODE -ne 0) {
    throw 'Packaged smoke tests failed.'
  }
}
finally {
  Pop-Location
}
