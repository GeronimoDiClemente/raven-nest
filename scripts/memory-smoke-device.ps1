# scripts/memory-smoke-device.ps1
#
# Launches one Nest dev instance as an isolated "device" for the two-machine memory sync
# smoke (spec §13's round-trip test), without touching the Nest you actually use.
#
# Two things have to be separated for a second instance to exist at all, and they are
# separated by two DIFFERENT levers:
#
#   1. RAVEN_HOME     — redirects .raven-nest, so the device gets its own memory.db,
#                       connection.json and credential.bin. electron/raven-home.ts:33.
#                       userHome() deliberately ignores it, so terminals still open in the
#                       real home.
#   2. --user-data-dir — redirects Electron's userData, which is what the single-instance
#                       lock is keyed on (electron/main.ts:81, unconditional, no isPackaged
#                       guard). Without it the second instance calls app.quit() and dies
#                       with exit 0 and no window — a silent failure that looks like a
#                       crash. Setting APPDATA instead does NOT work; only the switch does.
#
# The switch needs a DOUBLE `--`: the first is npm passing args to the script, the second
# is electron-vite's passthrough to the electron spawn. With one `--`, electron-vite's arg
# parser rejects the flag and aborts before launching anything.
#
# Usage:
#   .\scripts\memory-smoke-device.ps1 -Device a -SyncBaseUrl http://127.0.0.1:8787
#   .\scripts\memory-smoke-device.ps1 -Device b -SyncBaseUrl http://127.0.0.1:8787
#
# Run each in its own terminal. Then paste the stub's token into Settings -> Account on
# both, and they are two machines syncing through the same service.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Device,
  [string]$SyncBaseUrl = 'http://127.0.0.1:8787',
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'nest-memory-smoke')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Deliberately under LOCALAPPDATA and not under the real ~/.raven-nest: that directory is a
# junction into OneDrive, so test databases placed inside it would sync to the other
# machine and pollute real memory.
$deviceHome = Join-Path $Root "device-$Device"
$userData = Join-Path $Root "udata-$Device"
$memoryDir = Join-Path $deviceHome '.raven-nest\memory'

New-Item -ItemType Directory -Force -Path $memoryDir | Out-Null
New-Item -ItemType Directory -Force -Path $userData | Out-Null

# Seed connection.json so the daemon knows where to sync. The token is NOT written here on
# purpose: it lives in credential.bin, encrypted with Electron's safeStorage, which cannot
# be produced from outside the app. Paste it in Settings -> Account instead — that is the
# flow C7 built, and exercising it is part of the point.
$connectionPath = Join-Path $memoryDir 'connection.json'
if (-not (Test-Path $connectionPath)) {
  $state = @{
    connected    = $false
    localEnabled = $true
    deviceId     = [guid]::NewGuid().ToString()
    deviceName   = "smoke-$Device"
    connectedAt  = $null
    syncBaseUrl  = $SyncBaseUrl
  }
  $state | ConvertTo-Json | Out-File -FilePath $connectionPath -Encoding utf8
  Write-Host "connection.json creada para device-$Device -> $SyncBaseUrl"
} else {
  # Keep whatever is there (device id, and the connected flag once the token is pasted),
  # but make sure the base URL points where this run says it should.
  $state = Get-Content $connectionPath -Raw | ConvertFrom-Json
  $state.syncBaseUrl = $SyncBaseUrl
  $state | ConvertTo-Json | Out-File -FilePath $connectionPath -Encoding utf8
  Write-Host "connection.json existente actualizada -> $SyncBaseUrl"
}

Write-Host ""
Write-Host "device      : $Device"
Write-Host "RAVEN_HOME  : $deviceHome"
Write-Host "userData    : $userData"
Write-Host "syncBaseUrl : $SyncBaseUrl"
Write-Host ""
Write-Host "Al arrancar: Settings -> Account -> pegar el token del stub y apretar Connect."
Write-Host ""

$env:RAVEN_HOME = $deviceHome
Set-Location $repoRoot
npm run dev -- -- --user-data-dir="$userData"
