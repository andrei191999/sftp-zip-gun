. "$PSScriptRoot\Common.ps1"

Test-DockerAvailable

$state = Get-ContainerState
if ($state -ne 'running') {
  throw "Docker QA fixture is not running. Start it first with 'npm run qa:docker:start'."
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:SFTP_ZIP_GUN_QA_ROOT = Get-QARoot
$env:SFTP_ZIP_GUN_SMOKE_MODE = 'dev'
$env:SFTP_ZIP_GUN_TEST_MODE = '1'

& npm run compile
if ($LASTEXITCODE -ne 0) {
  throw 'Compile failed before running smoke tests.'
}

& node (Join-Path $PSScriptRoot 'run-vscode-smoke.js') --extensionPath $repoRoot --qaRoot (Get-QARoot) --mode dev
if ($LASTEXITCODE -ne 0) {
  throw 'Development smoke tests failed.'
}
