# Installs Cockpit from this folder (an unzipped release) for the current Windows user. No admin rights needed.
#
#   - copies the app and its own Node to %LOCALAPPDATA%\Programs\Cockpit (or -InstallDir)
#   - adds "Cockpit" to the Start menu, and starts the server at login (-NoStartup to skip)
#   - builds and starts the Cockpit helper: Ctrl+Alt+K brings Cockpit up and keeps its server running (-NoHotkey to skip)
#   - offers to connect Cockpit to Claude Code, if Claude Code is installed (-Claude yes|no to answer up front)
#   - opens Cockpit (-NoOpen to skip)
#
# Running it again updates an installed copy. Your notes and board are never touched: they live in
# Documents\Cockpit and %USERPROFILE%\.cockpit. Uninstall.cmd takes the app away.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Cockpit'),
  [switch]$NoStartup,
  [switch]$NoStartMenu,
  [switch]$NoHotkey,
  [switch]$NoOpen,
  [ValidateSet('ask', 'yes', 'no')][string]$Claude = 'ask'
)
$ErrorActionPreference = 'Stop'
$from = $PSScriptRoot
if (-not (Test-Path (Join-Path $from 'app\server\index.js'))) { throw "Run this from the unzipped Cockpit folder (app\ and runtime\ should be beside it)." }

function Step($text) { Write-Host "  $text" }
Write-Host ''
Write-Host "Installing Cockpit to $InstallDir"

# an update: stop what's running from the old copy first, so its files can be replaced
Get-Process CockpitHotkey -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($InstallDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force $InstallDir | Out-Null
foreach ($part in 'app', 'runtime') {
  $null = robocopy (Join-Path $from $part) (Join-Path $InstallDir $part) /MIR /NFL /NDL /NJH /NJS /NP /XD bin
  if ($LASTEXITCODE -ge 8) { throw "Copying $part failed (robocopy $LASTEXITCODE)" }
}
Copy-Item (Join-Path $from 'Uninstall.cmd'), (Join-Path $from 'uninstall.ps1') $InstallDir -Force
Step 'Copied the app'

$app = Join-Path $InstallDir 'app'
$scripts = Join-Path $app 'scripts'
$node = Join-Path $InstallDir 'runtime\node.exe'
$sh = New-Object -ComObject WScript.Shell

# Start menu: Cockpit (starts the server if needed, then opens the window). If Cockpit was installed as an app
# from Edge, that shortcut is kept: it opens the same thing.
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit.lnk'
$edgeApp = (Test-Path $menu) -and ($sh.CreateShortcut($menu).Arguments -match '--app-id=')
if (-not $NoStartMenu -and -not $edgeApp) {
  $l = $sh.CreateShortcut($menu)
  $l.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $l.Arguments = "`"$(Join-Path $scripts 'open.vbs')`""
  $l.WorkingDirectory = $app
  $l.IconLocation = Join-Path $app 'cockpit.ico'
  $l.Description = 'Cockpit: your board for links, files and notes'
  $l.Save()
  Step 'Added Cockpit to the Start menu'
}

if (-not $NoStartup) {
  & (Join-Path $scripts 'install-startup.ps1') | Out-Null
  Step 'The server starts at login'
}

if (-not $NoHotkey) {
  try {
    & (Join-Path $scripts 'install-hotkey.ps1') *> $null
    Step 'Ctrl+Alt+K brings Cockpit up from anywhere'
  } catch {
    Write-Warning "The Cockpit helper (Ctrl+Alt+K) couldn't be set up: $($_.Exception.Message)"
  }
} else {
  # the server still has to run now
  Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') "`"$(Join-Path $scripts 'start-hidden.vbs')`""
}

# Claude Code: the `show` and `snippet` tools put what Claude makes on your board
$claudeExe = Get-Command claude -ErrorAction SilentlyContinue
if ($claudeExe -and $Claude -ne 'no') {
  $yes = $Claude -eq 'yes'
  if (-not $yes) {
    $answer = Read-Host '  Connect Cockpit to Claude Code, so Claude can put files and notes on your board? [Y/n]'
    $yes = $answer -eq '' -or $answer -match '^[yY]'
  }
  if ($yes) {
    # through cmd: Windows PowerShell 5.1 would stop on anything claude writes to stderr
    $mcp = Join-Path $app 'server\mcp.js'
    cmd /d /c "claude mcp remove --scope user cockpit >nul 2>&1"
    cmd /d /c "claude mcp add --scope user cockpit -- `"$node`" `"$mcp`" >nul 2>&1"
    if ($LASTEXITCODE) { Write-Warning 'Claude Code did not accept the connection; see the README to add it by hand.' }
    else { Step 'Connected to Claude Code (the show and snippet tools)' }
  }
}

Write-Host ''
Write-Host 'Cockpit is installed. Open it from the Start menu, or press Ctrl+Alt+K.'
if (-not $NoOpen) { Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') "`"$(Join-Path $scripts 'open.vbs')`"" }
