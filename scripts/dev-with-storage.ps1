# scripts/dev-with-storage.ps1
#
# Run electron-vite dev with RAVEN_HOME pointing to an existing persistent
# storage location. Use this when developing Nest from INSIDE a host Nest:
# without it, the dev instance inherits the host's redirected HOME and ends
# up creating a recursively-nested .raven-nest/ inside the host's accountDir.
#
# Path resolution order:
#   1. -StoragePath parameter
#   2. .raven-storage.local file in the repo root (one line: the path)
#   3. $env:RAVEN_HOME (if already set in the current shell)
#   4. Error — you must provide one of the above
#
# Example:
#   .\scripts\dev-with-storage.ps1 -StoragePath "C:\Users\me\.raven-nest\accounts\claude\Personal"
#   # or, more convenient:
#   "C:\Users\me\.raven-nest\accounts\claude\Personal" | Set-Content .raven-storage.local
#   npm run dev:storage

[CmdletBinding()]
param([string]$StoragePath)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $StoragePath) {
  $localFile = Join-Path $repoRoot '.raven-storage.local'
  if (Test-Path $localFile) {
    $StoragePath = (Get-Content $localFile -Raw).Trim()
  } elseif ($env:RAVEN_HOME) {
    $StoragePath = $env:RAVEN_HOME
  } else {
    throw "No storage path. Pass -StoragePath, set RAVEN_HOME, or write the path into $repoRoot\.raven-storage.local"
  }
}

if (-not (Test-Path $StoragePath)) {
  throw "Storage path does not exist: $StoragePath"
}

$env:RAVEN_HOME = $StoragePath
Write-Host "RAVEN_HOME = $StoragePath" -ForegroundColor Cyan

Push-Location $repoRoot
try {
  npm run dev
} finally {
  Pop-Location
}
