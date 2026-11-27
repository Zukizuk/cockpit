# Installs Cockpit from this folder (an unzipped release) for the current Windows user. No admin rights needed.
#
#   - copies the app and its own Node to %LOCALAPPDATA%\Programs\Cockpit (or -InstallDir)
#   - adds "Cockpit" to the Start menu and to Explorer's Send to, and starts the server at login (-NoStartMenu,
#     -NoSendTo and -NoStartup skip them)
#   - builds and starts the Cockpit helper: Ctrl+Alt+K brings Cockpit up and keeps its server running (-NoHotkey to skip)
#   - offers to connect Cockpit to Claude Code, if Claude Code is installed (-Claude yes|no to answer up front):
#     the show and snippet tools, and the Outputs list (a hook that lists what each turn made)
#   - opens Cockpit (-NoOpen to skip)
#
# Running it again updates an installed copy. -Update is how Cockpit updates itself (Settings > Updates): no
# questions, the choices made at install kept, nothing opened. Your notes and board are never touched: they live in
# Documents\Cockpit and %USERPROFILE%\.cockpit. Uninstall.cmd takes the app away.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Cockpit'),
  [switch]$NoStartup,
  [switch]$NoStartMenu,
  [switch]$NoHotkey,
  [switch]$NoOpen,
  [switch]$NoSendTo,
  [ValidateSet('ask', 'yes', 'no')][string]$Claude = 'ask',
  [switch]$Update
)
$ErrorActionPreference = 'Stop'
$from = $PSScriptRoot
$startupDir = [Environment]::GetFolderPath('Startup')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit.lnk'
$sendTo = Join-Path ([Environment]::GetFolderPath('SendTo')) 'Cockpit.lnk'
if ($Update) {
  # keep what was chosen at install: the login start, the helper, the Start menu and Send to only if they're there now
  # and point at this copy (not another install, or a clone's); Claude as it is
  $NoOpen = $true
  $Claude = 'no'
  $sh0 = New-Object -ComObject WScript.Shell
  $pointsHere = { param($l) (Test-Path $l) -and ("$($sh0.CreateShortcut($l).TargetPath) $($sh0.CreateShortcut($l).Arguments)".Contains($InstallDir)) }
  if (-not (& $pointsHere (Join-Path $startupDir 'Cockpit server.lnk'))) { $NoStartup = $true }
  if (-not (& $pointsHere (Join-Path $startupDir 'Cockpit hotkey.lnk'))) { $NoHotkey = $true }
  if (-not (& $pointsHere $menu)) { $NoStartMenu = $true }
  if (-not (& $pointsHere $sendTo)) { $NoSendTo = $true }
}
if (-not (Test-Path (Join-Path $from 'app\server\index.js'))) { throw "Run this from the unzipped Cockpit folder (app\ and runtime\ should be beside it)." }

function Step($text) { Write-Host "  $text" }
Write-Host ''
Write-Host "Installing Cockpit to $InstallDir"

# an update: stop what's running from the old copy first, so its files can be replaced
# only this copy's helper (a clone set up with npm run setup has its own)
Get-Process CockpitHotkey -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
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

# Explorer's Send to > Cockpit: the files and folders sent come onto the board (-NoSendTo to skip)
if (-not $NoSendTo) {
  $l = $sh.CreateShortcut($sendTo)
  $l.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $l.Arguments = "`"$(Join-Path $scripts 'send-to.vbs')`""
  $l.WorkingDirectory = $app
  $l.IconLocation = Join-Path $app 'cockpit.ico'
  $l.Description = 'Put it on your Cockpit board'
  $l.Save()
  Step 'Added Cockpit to Send to (right-click a file in Explorer)'
}

if (-not $NoStartup) {
  & (Join-Path $scripts 'install-startup.ps1') | Out-Null
  Step 'The server starts at login'
}

$hotkey = $false
if (-not $NoHotkey) {
  try {
    & (Join-Path $scripts 'install-hotkey.ps1') *> $null
    $hotkey = [bool](Get-Process CockpitHotkey -ErrorAction SilentlyContinue)
  } catch {}
  if ($hotkey) { Step 'Ctrl+Alt+K brings Cockpit up from anywhere' }
  else { Write-Warning "Ctrl+Alt+K couldn't be set up on this PC (Windows' C# compiler is missing or blocked). Everything else works; open Cockpit from the Start menu." }
}
if (-not $hotkey) {
  # the helper isn't there to start the server: start it now
  Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') "`"$(Join-Path $scripts 'start-hidden.vbs')`""
}

# Claude Code: the show and snippet tools put files and notes on your board, and a hook lists what each turn made
# under Outputs. Asked only when someone is there to answer (an update keeps what's set).
$claudeExe = Get-Command claude -ErrorAction SilentlyContinue
if ($claudeExe -and $Claude -ne 'no') {
  $yes = $Claude -eq 'yes'
  if (-not $yes) {
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      $answer = Read-Host '  Connect Cockpit to Claude Code, so what Claude makes shows up on your board? [Y/n]'
      $yes = $answer -eq '' -or $answer -match '^[yY]'
    }
  }
  if ($yes) {
    # through cmd: Windows PowerShell 5.1 would stop on anything a program writes to stderr
    $mcp = Join-Path $app 'server\mcp.js'
    cmd /d /c "claude mcp remove --scope user cockpit >nul 2>&1"
    cmd /d /c "claude mcp add --scope user cockpit -- `"$node`" `"$mcp`" >nul 2>&1"
    $tools = -not $LASTEXITCODE
    cmd /d /c "`"$node`" `"$(Join-Path $scripts 'claude-setup.mjs')`" add-hook --node `"$node`" >nul 2>&1"
    $hook = -not $LASTEXITCODE
    if ($tools -and $hook) { Step 'Connected to Claude Code: its files, drafts and links show up under Outputs' }
    else { Write-Warning 'Claude Code could not be connected completely; see "With Claude Code" in the README to finish by hand.' }
  }
}

Write-Host ''
if ($Update) {
  # the one-off task Cockpit started this update with (server/lib/updates.js)
  cmd /d /c 'schtasks /Delete /TN "Cockpit update" /F >nul 2>&1'
  # installed with Setup.exe: Settings > Apps shows the new version too
  $entry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{F123EE23-6B69-452D-8502-CC346A602483}_is1'
  if (Test-Path $entry) {
    $version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
    Set-ItemProperty $entry DisplayVersion $version
  }
  Write-Host 'Cockpit is updated.'
}
elseif ($hotkey) { Write-Host 'Cockpit is installed. Open it from the Start menu, or press Ctrl+Alt+K.' }
else { Write-Host 'Cockpit is installed. Open it from the Start menu.' }
if (-not $NoOpen) { Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') "`"$(Join-Path $scripts 'open.vbs')`"" }

# robocopy says 1 for "files copied": a successful install ends with 0
exit 0
