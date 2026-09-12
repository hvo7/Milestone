<#
  Installs a published Milestone release straight from GitHub.

  scripts/install.ps1 installs whatever is in release/ - which is only correct on
  a machine that just ran `npm run package`. On any other machine that folder is
  whatever OneDrive happened to replicate, and installing it silently downgrades
  you. This one ignores release/ entirely and fetches the real release.

  It also fixes the reason a laptop can "see" an update and never apply it: the
  in-app updater installs into path.dirname(app.getPath('exe')), so an app
  launched from a OneDrive-synced folder tries to overwrite files OneDrive holds
  open, fails five times, and starts the old build as if nothing happened. Being
  installed under %LOCALAPPDATA% is what makes the updater work at all.

    powershell -ExecutionPolicy Bypass -File scripts\install-release.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install-release.ps1 -Version 3.1.2

  Your data is NOT touched. It lives in %APPDATA%\Milestone; this only replaces
  the program in %LOCALAPPDATA%\Milestone.

  Deliberately ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI unless the
  file has a BOM, so a UTF-8 em-dash arrives as three bytes ending in 0x94 - a
  smart quote, which PowerShell honours as a string delimiter. A stray one in a
  double-quoted string ends it early and the file no longer parses.
#>
param(
  [string]$Version = "",
  [string]$Repo    = "hvo7/Milestone"
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Say($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
Write-Host ""

# ---- Which version ---------------------------------------------------------
if (-not $Version) {
  Say "Asking GitHub for the latest release..." 'Cyan'
  $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'milestone-installer' }
  $Version = $rel.tag_name -replace '^v', ''
}
$zipName = "Milestone-win32-x64-$Version.zip"
$url     = "https://github.com/$Repo/releases/download/v$Version/$zipName"
Say "Installing Milestone $Version" 'Cyan'

$installTo = Join-Path $env:LOCALAPPDATA "Milestone"
$exePath   = Join-Path $installTo "Milestone.exe"

# Already there? Nothing to do - this would re-download 113 MB otherwise.
if (Test-Path $exePath) {
  $have = (Get-Item $exePath).VersionInfo.ProductVersion
  if ($have -eq $Version) {
    Say "$installTo is already $Version - nothing to download." 'Green'
    Say "If the app still starts on an older build, you are launching a different copy." 'Yellow'
    Say "Check the shortcut target, and use: $exePath" 'Yellow'
    Write-Host ""
    exit 0
  }
  Say "Replacing the installed $have" 'DarkGray'
}

# ---- Download --------------------------------------------------------------
$tmp = Join-Path $env:TEMP "milestone-$Version"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp $zipName

Say "Downloading $zipName (about 113 MB)..." 'Cyan'
$pp = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'   # roughly 10x faster
try {
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
} catch {
  Say "Download failed: $($_.Exception.Message)" 'Red'
  Say "Check that v$Version exists at https://github.com/$Repo/releases" 'Yellow'
  exit 1
} finally {
  $ProgressPreference = $pp
}

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
if ($mb -lt 50) {
  Say "Only $mb MB downloaded - that is not the app. Aborting." 'Red'
  exit 1
}
Say "Got $mb MB" 'Green'

Say "Extracting..." 'Cyan'
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
# The zip may or may not carry a top-level folder; find the exe either way.
$found = Get-ChildItem -Path $tmp -Filter "Milestone.exe" -Recurse | Select-Object -First 1
if (-not $found) {
  Say "No Milestone.exe inside the archive. Aborting." 'Red'
  exit 1
}
$src = $found.Directory

# ---- Swap it in ------------------------------------------------------------
$running = Get-Process -Name "Milestone" -ErrorAction SilentlyContinue
if ($running) {
  Say "Closing the running Milestone..." 'Yellow'
  $running | Stop-Process -Force
  Start-Sleep -Seconds 2
}

if (Test-Path $installTo) {
  Remove-Item $installTo -Recurse -Force
  Start-Sleep -Milliseconds 500
}
Copy-Item $src.FullName $installTo -Recurse -Force
Say "Installed to $installTo" 'Green'

# ---- Shortcuts, pointed at the install (never at release\) ------------------
$shell = New-Object -ComObject WScript.Shell
$links = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Milestone.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Milestone.lnk")
)
foreach ($lnk in $links) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath       = $exePath
  $s.IconLocation     = "$exePath,0"
  $s.Description      = "Milestone - Plan your questlines"
  $s.WorkingDirectory = $installTo
  $s.Save()
}
Say "Desktop and Start Menu shortcuts point at the install." 'Green'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

$now = (Get-Item $exePath).VersionInfo.ProductVersion
Write-Host ""
if ($now -eq $Version) {
  Say "Done - Milestone $now is installed." 'Green'
} else {
  Say "Installed, but the exe reports $now rather than $Version." 'Yellow'
}
Say "Launch it from the new shortcut. Do NOT launch" 'Yellow'
Say "release\Milestone-win32-x64\Milestone.exe - that copy cannot self-update," 'Yellow'
Say "which is the bug this script exists to end." 'Yellow'
Write-Host ""
