. "$PSScriptRoot\Common.ps1"

# Collect all drop directories from the configured users.
$drops = foreach ($user in Get-QAUsers) {
  Get-QADataPath -User $user.Name -Directory 'drop'
}

# Poll every 800 ms and delete any files that appear in a drop directory.
# This simulates a pickup server that processes and removes uploaded files.
while ($true) {
  foreach ($dir in $drops) {
    if (Test-Path -LiteralPath $dir) {
      Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 800
}
