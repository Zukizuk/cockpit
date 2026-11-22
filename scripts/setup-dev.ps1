# For working on Cockpit from a clone (`npm run setup`, after `npm install`): runs this copy the way an installed
# one runs, with the Node on your PATH.
#   - "Cockpit" in the Start menu and in Explorer's Send to, the server at login, Ctrl+Alt+K (the Cockpit helper)
#   - optionally connects Claude Code to this copy's MCP server
# Undo with: scripts\install-startup.ps1 -Remove; scripts\install-hotkey.ps1 -Remove; and remove Cockpit.lnk from
# the Start menu and from Send to (shell:sendto).
param([ValidateSet('ask', 'yes', 'no')][string]$Claude = 'ask')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Split-Path $here

$sh = New-Object -ComObject WScript.Shell
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit.lnk'
# a Cockpit installed as an app from Edge keeps its own shortcut
if ((Test-Path $menu) -and ($sh.CreateShortcut($menu).Arguments -match '--app-id=')) { $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit (dev).lnk' }
$l = $sh.CreateShortcut($menu)
$l.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$l.Arguments = "`"$(Join-Path $here 'open.vbs')`""
$l.WorkingDirectory = $repo
$l.IconLocation = Join-Path $repo 'web\public\icons\cockpit.ico'
$l.Description = 'Cockpit (from your clone)'
$l.Save()
Write-Host '  Added Cockpit to the Start menu'

# Explorer's Send to > Cockpit (a name of its own if an installed copy has the usual one)
$sendTo = Join-Path ([Environment]::GetFolderPath('SendTo')) 'Cockpit.lnk'
if ((Test-Path $sendTo) -and -not $sh.CreateShortcut($sendTo).Arguments.Contains($repo)) { $sendTo = Join-Path ([Environment]::GetFolderPath('SendTo')) 'Cockpit (dev).lnk' }
$l = $sh.CreateShortcut($sendTo)
$l.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$l.Arguments = "`"$(Join-Path $here 'send-to.vbs')`""
$l.WorkingDirectory = $repo
$l.IconLocation = Join-Path $repo 'web\public\icons\cockpit.ico'
$l.Description = 'Put it on your Cockpit board'
$l.Save()
Write-Host '  Added Cockpit to Send to'

& (Join-Path $here 'install-startup.ps1') | Out-Null
Write-Host '  The server starts at login'
& (Join-Path $here 'install-hotkey.ps1')

if ((Get-Command claude -ErrorAction SilentlyContinue) -and $Claude -ne 'no') {
  $yes = $Claude -eq 'yes'
  if (-not $yes) { $yes = (Read-Host '  Connect Claude Code to this copy (the show and snippet tools)? [Y/n]') -notmatch '^[nN]' }
  if ($yes) {
    # through cmd: Windows PowerShell 5.1 would stop on anything claude writes to stderr
    $mcp = Join-Path $repo 'server\mcp.js'
    cmd /d /c "claude mcp remove --scope user cockpit >nul 2>&1"
    cmd /d /c "claude mcp add --scope user cockpit -- node `"$mcp`""
  }
  # the Outputs list: a hook that lists what each turn made (skip it if a Claude Code mod already feeds Outputs)
  $feed = Test-Path (Join-Path $env:USERPROFILE '.claude\mods\deliverables-tray')
  $ask = if ($feed) { '  A Claude Code mod already feeds Outputs here. Add Cockpit''s Outputs hook too? [y/N]' } else { '  Also list what each Claude turn makes under Outputs? [Y/n]' }
  $answer = Read-Host $ask
  if (($feed -and $answer -match '^[yY]') -or (-not $feed -and $answer -notmatch '^[nN]')) {
    node (Join-Path $here 'claude-setup.mjs') add-hook --node ((Get-Command node).Source)
  }
}
Write-Host ''
Write-Host 'Done. Open Cockpit from the Start menu or with Ctrl+Alt+K. After changing web/, run npm run build.'
