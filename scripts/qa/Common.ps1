Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Get-QAContainerName {
  'sftp-zip-gun-qa'
}

function Get-QAHostPort {
  2222
}

function Get-QARoot {
  Join-Path $env:TEMP 'sftp-zip-gun-qa'
}

function Get-QADataRoot {
  Join-Path (Get-QARoot) 'data'
}

function Get-QAKeyRoot {
  Join-Path (Get-QARoot) 'keys'
}

function Get-QAConfigRoot {
  Join-Path (Get-QARoot) 'config'
}

function Get-QAUsers {
  @(
    [pscustomobject]@{
      Name = 'pwuser'
      Password = 'pwpass'
      AuthType = 'password'
      DefaultRemoteDir = '/store'
      Directories = @('store', 'drop')
    },
    [pscustomobject]@{
      Name = 'keyuser'
      Password = ''
      AuthType = 'key'
      DefaultRemoteDir = '/store'
      Directories = @('store', 'drop')
    }
  )
}

function Ensure-QARootLayout {
  foreach ($path in @((Get-QARoot), (Get-QADataRoot), (Get-QAKeyRoot), (Get-QAConfigRoot))) {
    if (-not (Test-Path -LiteralPath $path)) {
      New-Item -ItemType Directory -Path $path | Out-Null
    }
  }

  foreach ($user in Get-QAUsers) {
    $userRoot = Join-Path (Get-QADataRoot) $user.Name
    if (-not (Test-Path -LiteralPath $userRoot)) {
      New-Item -ItemType Directory -Path $userRoot | Out-Null
    }
    foreach ($dir in $user.Directories) {
      $target = Join-Path $userRoot $dir
      if (-not (Test-Path -LiteralPath $target)) {
        New-Item -ItemType Directory -Path $target | Out-Null
      }
    }
  }
}

function Get-QAUsersConfigPath {
  Join-Path (Get-QAConfigRoot) 'users.conf'
}

function Remove-StaleQATarget {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $existing = Get-Item -LiteralPath $Path -Force
  if ($existing.PSIsContainer) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Write-QAUsersConfig {
  $uid = 1001
  $lines = foreach ($user in Get-QAUsers) {
    $dirs = [string]::Join(',', $user.Directories)
    $line = '{0}:{1}:{2}:100:{3}' -f $user.Name, $user.Password, $uid, $dirs
    $uid += 1
    $line
  }
  $configPath = Get-QAUsersConfigPath
  Remove-StaleQATarget -Path $configPath
  Set-Content -LiteralPath $configPath -Value $lines -Encoding ascii
}

function Get-QAPrivateKeyPath {
  Join-Path (Get-QAKeyRoot) 'qa_ed25519'
}

function Get-QAPublicKeyPath {
  '{0}.pub' -f (Get-QAPrivateKeyPath)
}

function Ensure-QAKeyPair {
  $privateKey = Get-QAPrivateKeyPath
  $publicKey = Get-QAPublicKeyPath
  Remove-StaleQATarget -Path $privateKey
  Remove-StaleQATarget -Path $publicKey

  if ((Test-Path -LiteralPath $privateKey) -and (Test-Path -LiteralPath $publicKey)) {
    $header = Get-Content -LiteralPath $privateKey -TotalCount 1 -ErrorAction SilentlyContinue
    if ($header -eq '-----BEGIN RSA PRIVATE KEY-----') {
      return
    }

    Remove-Item -LiteralPath $privateKey -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $publicKey -Force -ErrorAction SilentlyContinue
  } elseif ((Test-Path -LiteralPath $privateKey) -or (Test-Path -LiteralPath $publicKey)) {
    Remove-Item -LiteralPath $privateKey -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $publicKey -Force -ErrorAction SilentlyContinue
  }

  $sshKeygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
  if (-not $sshKeygen) {
    throw 'ssh-keygen was not found. Install OpenSSH client support before running the QA harness.'
  }

  $process = Start-Process `
    -FilePath $sshKeygen.Source `
    -ArgumentList @('-q', '-t', 'rsa', '-b', '4096', '-m', 'PEM', '-N', '""', '-C', 'sftp-zip-gun-qa', '-f', $privateKey) `
    -NoNewWindow `
    -PassThru `
    -Wait

  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $privateKey) -or -not (Test-Path -LiteralPath $publicKey)) {
    throw 'Failed to generate the QA SSH key pair.'
  }
}

function Test-DockerAvailable {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw 'Docker CLI was not found. Install Docker Desktop and ensure docker.exe is on PATH.'
  }
}

function Get-ContainerState {
  $name = Get-QAContainerName
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $state = & docker inspect --format '{{.State.Status}}' $name 2>$null
    if ($LASTEXITCODE -ne 0) {
      return $null
    }
    $state.Trim()
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Remove-ContainerIfPresent {
  $name = Get-QAContainerName
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker rm -f $name *> $null
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Get-QADataPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$User,
    [Parameter(Mandatory = $true)]
    [string]$Directory
  )

  Join-Path (Join-Path (Get-QADataRoot) $User) $Directory
}

function Get-QAWatcherPidFile {
  Join-Path (Get-QARoot) 'watcher.pid'
}

function Stop-QADropWatcher {
  $pidFile = Get-QAWatcherPidFile
  if (-not (Test-Path -LiteralPath $pidFile)) { return }
  $storedPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue)
  if ($storedPid) {
    Stop-Process -Id $storedPid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

function Start-QADropWatcher {
  param([Parameter(Mandatory = $true)][string]$ScriptRoot)
  Stop-QADropWatcher
  $watcherScript = Join-Path $ScriptRoot 'Start-DropWatcher.ps1'
  $proc = Start-Process pwsh `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watcherScript) `
    -WindowStyle Hidden `
    -PassThru
  [string]$proc.Id | Set-Content -LiteralPath (Get-QAWatcherPidFile) -Encoding ascii
  $proc.Id
}

function Get-QADropWatcherState {
  $pidFile = Get-QAWatcherPidFile
  if (-not (Test-Path -LiteralPath $pidFile)) { return 'stopped' }
  $storedPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue)
  if (-not $storedPid) { return 'stopped' }
  $proc = Get-Process -Id $storedPid -ErrorAction SilentlyContinue
  if ($proc) { 'running (PID {0})' -f $storedPid } else { 'dead (stale PID {0})' -f $storedPid }
}

function Get-CodeCliPath {
  $command = Get-Command code -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fallbacks = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd')
  )

  foreach ($candidate in $fallbacks) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  throw 'VS Code CLI was not found. Install the `code` shell command before running qa:smoke:vsix.'
}
