. "$PSScriptRoot\Common.ps1"

Test-DockerAvailable

$state = Get-ContainerState
if (-not $state) {
  $state = 'not-created'
}

Write-Host ("Container:    {0}" -f (Get-QAContainerName))
Write-Host ("State:        {0}" -f $state)
Write-Host ("Host:         127.0.0.1:{0}" -f (Get-QAHostPort))
Write-Host ("Drop watcher: {0}" -f (Get-QADropWatcherState))
Write-Host ("Root:         {0}" -f (Get-QARoot))
Write-Host ("Key:          {0}" -f (Get-QAPrivateKeyPath))
Write-Host ''
Write-Host 'Presets:'
foreach ($user in Get-QAUsers) {
  Write-Host ("  [{0}] {1}@127.0.0.1:{2}" -f $user.AuthType, $user.Name, (Get-QAHostPort))
  Write-Host ("    /store  - files persist")
  Write-Host ("    /drop   - files deleted ~1 s after upload")
}
