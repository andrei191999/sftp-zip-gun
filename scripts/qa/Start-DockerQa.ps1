. "$PSScriptRoot\Common.ps1"

Test-DockerAvailable
Ensure-QARootLayout
Write-QAUsersConfig
Ensure-QAKeyPair

$containerState = Get-ContainerState
if ($containerState -eq 'running') {
  Write-Host "QA container '$([string](Get-QAContainerName))' is already running on 127.0.0.1:$([string](Get-QAHostPort))."
} else {
  if ($containerState) {
    Remove-ContainerIfPresent
  }

  $dockerArgs = @(
    'run',
    '-d',
    '--name', (Get-QAContainerName),
    '-p', ('{0}:22' -f (Get-QAHostPort)),
    '-v', ('{0}:/etc/sftp/users.conf:ro' -f (Get-QAUsersConfigPath)),
    '-v', ('{0}:/home/keyuser/.ssh/keys/qa_ed25519.pub:ro' -f (Get-QAPublicKeyPath))
  )

  foreach ($user in Get-QAUsers) {
    foreach ($dir in $user.Directories) {
      $dockerArgs += @('-v', ('{0}:/home/{1}/{2}' -f (Get-QADataPath -User $user.Name -Directory $dir), $user.Name, $dir))
    }
  }

  $dockerArgs += 'atmoz/sftp'

  & docker @dockerArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to start the Docker QA fixture.'
  }

  Write-Host 'Docker QA fixture started.'
  Write-Host ("Container: {0}" -f (Get-QAContainerName))
  Write-Host ("Host: 127.0.0.1:{0}" -f (Get-QAHostPort))
  Write-Host ("Root: {0}" -f (Get-QARoot))
  Write-Host ("Key: {0}" -f (Get-QAPrivateKeyPath))
  Write-Host ''
  Write-Host 'Folders:'
  Write-Host '  /store  - files persist (normal SFTP)'
  Write-Host '  /drop   - files deleted ~1 s after upload (pickup/delivery simulation)'
}

# (Re)start the host-side drop watcher — reliable on Windows unlike docker exec -d.
$watcherPid = Start-QADropWatcher -ScriptRoot $PSScriptRoot
Write-Host ("Drop watcher started (PID {0})." -f $watcherPid)
