. "$PSScriptRoot\Common.ps1"

Test-DockerAvailable
Remove-ContainerIfPresent

$root = Get-QARoot
if (Test-Path -LiteralPath $root) {
  $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
  if (-not $resolvedRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to purge unexpected QA root: $resolvedRoot"
  }
  Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}

Write-Host 'Docker QA fixture and persistent QA data were removed.'
