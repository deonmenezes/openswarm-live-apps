#Requires -Version 5.1
<#
.SYNOPSIS
  Install and start an OpenSwarm / Cursor My Machines worker on win2025-vm.

.DESCRIPTION
  Tool calls run on this Windows box. The agent loop stays in Cursor cloud.
  No inbound ports are opened. Requires a personal CURSOR_API_KEY — team
  Admin keys cannot start My Machines workers.

  Does not change the RDP security group. Lock win2025-rdp-sg to the
  operator IP before exposing this host further.
#>
param(
    [string]$WorkerName = "win2025-vm",
    [string]$WorkerDir = "C:\openswarm\workspace",
    [string]$ApiKey = $env:CURSOR_API_KEY
)

$ErrorActionPreference = "Stop"

if (-not $ApiKey) {
    throw "CURSOR_API_KEY is required (personal user key, not a team Admin key)"
}

New-Item -ItemType Directory -Force -Path $WorkerDir | Out-Null
Set-Location $WorkerDir

if (-not (Get-Command agent -ErrorAction SilentlyContinue)) {
    irm "https://cursor.com/install?win32=true" | iex
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Warning "git is not on PATH. Clone the target repo into $WorkerDir before starting the worker."
}

$agent = Get-Command agent -ErrorAction SilentlyContinue
if (-not $agent) {
    throw "Cursor agent CLI did not install onto PATH. Open a new shell and re-run."
}

Write-Host "Starting My Machines worker '$WorkerName' in $WorkerDir"
& agent worker start --name $WorkerName --worker-dir $WorkerDir --api-key $ApiKey
