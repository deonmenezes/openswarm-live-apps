#Requires -Version 5.1
<#
.SYNOPSIS
  Start a Cursor "My Machines" worker on win2025-vm.

.DESCRIPTION
  This is a Cursor self-hosted worker, not OpenSwarm. The agent loop runs in
  Cursor's cloud; terminal commands and file edits execute here. The worker
  dials out over HTTPS, so no inbound port is needed.

  Three things that bite if you skip them:

  - A worker is scoped to ONE repo, resolved from the git remote in
    -WorkerDir. Started in an empty directory it matches no repo and every
    worker= request is rejected, so this clones -Repo before starting.
  - The process is the worker. Closing the session kills it. Run it under a
    scheduled task or as a service if you want it to survive logout.
  - t3.small is 2 GiB total for Server 2025 plus Node plus whatever the agent
    compiles. Expect to size up before running real builds.

  Requires a PERSONAL Cursor credential. Service account keys only start pool
  workers and team Admin keys cannot start workers at all.

.PARAMETER InstallerSha256
  Optional. When set, the downloaded installer is verified against this hash
  before it runs. Unset means trusting whatever cursor.com returns right now,
  which is the vendor's documented path but is still remote code execution.
#>
param(
    [string]$WorkerName = "win2025-vm",
    [string]$WorkerDir = "C:\openswarm\workspace",
    [string]$Repo = "https://github.com/deonmenezes/openswarm-live-apps.git",
    [string]$InstallerSha256
)

$ErrorActionPreference = "Stop"

if (-not $env:CURSOR_API_KEY) {
    throw "Set CURSOR_API_KEY (personal user key) in the environment first."
}

New-Item -ItemType Directory -Force -Path $WorkerDir | Out-Null

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required: the worker's repo is read from the git remote in $WorkerDir."
}

if (-not (Test-Path (Join-Path $WorkerDir ".git"))) {
    git clone $Repo $WorkerDir
}

if (-not (Get-Command agent -ErrorAction SilentlyContinue)) {
    $installer = Join-Path $env:TEMP "cursor-install.ps1"
    Invoke-WebRequest -Uri "https://cursor.com/install?win32=true" -OutFile $installer -UseBasicParsing
    if ($InstallerSha256) {
        $actual = (Get-FileHash -Path $installer -Algorithm SHA256).Hash
        if ($actual -ne $InstallerSha256) {
            throw "installer hash mismatch: expected $InstallerSha256, got $actual"
        }
    } else {
        Write-Warning "Installer not pinned. Pass -InstallerSha256 to verify it."
    }
    & powershell -NoProfile -File $installer
}

if (-not (Get-Command agent -ErrorAction SilentlyContinue)) {
    throw "agent CLI is not on PATH. Open a new shell and re-run."
}

Set-Location $WorkerDir
# The key stays in the environment. Passing --api-key would publish it to the
# process table and PowerShell history.
Write-Host "Starting worker '$WorkerName' for $Repo in $WorkerDir"
& agent worker start --name $WorkerName --worker-dir $WorkerDir
