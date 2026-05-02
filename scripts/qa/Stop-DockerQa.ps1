. "$PSScriptRoot\Common.ps1"

Test-DockerAvailable

Stop-QADropWatcher

$state = Get-ContainerState
if (-not $state) {
  Write-Host 'Docker QA fixture is not running.'
  exit 0
}

Remove-ContainerIfPresent

Write-Host 'Docker QA fixture removed. Persistent QA data was kept.'
Write-Host ("Root: {0}" -f (Get-QARoot))
