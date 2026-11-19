# For working on Cockpit from a clone (`npm run setup`, after `npm install`): runs this copy the way an installed
# one runs, with the Node on your PATH.
#   - "Cockpit" in the Start menu, the server at login, Ctrl+Alt+K (the Cockpit helper)
#   - optionally connects Claude Code to this copy's MCP server
# Undo with: scripts\install-startup.ps1 -Remove; scripts\install-hotkey.ps1 -Remove; and remove Cockpit.lnk from
# the Start menu.
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
}
Write-Host ''
Write-Host 'Done. Open Cockpit from the Start menu or with Ctrl+Alt+K. After changing web/, run npm run build.'
