# Milestone — Install Script
# Copies the packaged app to %LOCALAPPDATA%\Milestone and creates shortcuts.
# Run this after `npm run package` to install/update the app.

$appName   = "Milestone"
$exeName   = "Milestone.exe"
$srcDir    = Join-Path $PSScriptRoot "..\release\Milestone-win32-x64"
$installTo = Join-Path $env:LOCALAPPDATA "Milestone"
$exePath   = Join-Path $installTo $exeName

Write-Host ""
Write-Host "  Installing $appName..." -ForegroundColor Cyan

# ── Copy app files ──────────────────────────────────────────────────────────
if (-not (Test-Path $srcDir)) {
    Write-Host "  ERROR: Built app not found at: $srcDir" -ForegroundColor Red
    Write-Host "  Run 'npm run package' first, then re-run this script." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Stop any running instance (new or old name)
foreach ($procName in @("Milestone", "Quest Atlas")) {
    $running = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "  $procName is running. Closing it now..." -ForegroundColor Yellow
        $running | Stop-Process -Force
        Start-Sleep -Seconds 1
    }
}

if (Test-Path $installTo) {
    Write-Host "  Removing previous version..." -ForegroundColor DarkGray
    Remove-Item $installTo -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Copy-Item $srcDir $installTo -Recurse -Force
Write-Host "  Installed to: $installTo" -ForegroundColor Green

# ── Remove old Quest Atlas install + shortcuts (renamed to Milestone) ────────
$oldInstall = Join-Path $env:LOCALAPPDATA "QuestAtlas"
if (Test-Path $oldInstall) {
    Write-Host "  Removing old Quest Atlas install..." -ForegroundColor DarkGray
    Remove-Item $oldInstall -Recurse -Force -ErrorAction SilentlyContinue
}
$oldDesktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Quest Atlas.lnk"
$oldStartLnk   = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Quest Atlas.lnk"
foreach ($lnk in @($oldDesktopLnk, $oldStartLnk)) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }
}

# ── Desktop shortcut ─────────────────────────────────────────────────────────
$shell      = New-Object -ComObject WScript.Shell
$desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "$appName.lnk"
$sc = $shell.CreateShortcut($desktopLnk)
$sc.TargetPath       = $exePath
$sc.IconLocation     = "$exePath,0"
$sc.Description      = "Milestone - Plan your questlines"
$sc.WorkingDirectory = $installTo
$sc.Save()
Write-Host "  Desktop shortcut created." -ForegroundColor Green

# ── Start Menu shortcut ───────────────────────────────────────────────────────
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$startLnk = Join-Path $startMenuDir "$appName.lnk"
$sm = $shell.CreateShortcut($startLnk)
$sm.TargetPath       = $exePath
$sm.IconLocation     = "$exePath,0"
$sm.Description      = "Milestone - Plan your questlines"
$sm.WorkingDirectory = $installTo
$sm.Save()
Write-Host "  Start Menu shortcut created." -ForegroundColor Green

Write-Host ""
Write-Host "  Done! To pin to the taskbar:" -ForegroundColor Yellow
Write-Host "    Right-click the desktop shortcut -> 'Pin to taskbar'" -ForegroundColor Yellow
Write-Host ""
