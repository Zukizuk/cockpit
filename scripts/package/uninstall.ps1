# Takes Cockpit away: its Start menu and login entries, the Cockpit helper, the Claude Code connection, and the
# installed app. Your notes (Documents\Cockpit) and board (%USERPROFILE%\.cockpit) are kept; delete them yourself
# if you want them gone.
param([string]$InstallDir = $PSScriptRoot)
$ErrorActionPreference = 'Continue'
if (-not (Test-Path (Join-Path $InstallDir 'app\server\index.js'))) { throw "No installed Cockpit in $InstallDir" }

Get-Process CockpitHotkey -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($InstallDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# the shortcuts, only where they point at this copy (a clone set up with `npm run setup` keeps its own)
$sh = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup')
foreach ($link in (Join-Path $startup 'Cockpit server.lnk'), (Join-Path $startup 'Cockpit hotkey.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit.lnk')) {
  if (-not (Test-Path $link)) { continue }
  $s = $sh.CreateShortcut($link)
  if ("$($s.TargetPath) $($s.Arguments)".Contains($InstallDir)) { Remove-Item $link }
}

# the Claude Code connection, only if it points at this copy
if (Get-Command claude -ErrorAction SilentlyContinue) {
  $info = & claude mcp get cockpit 2>$null | Out-String
  if ($info.Contains($InstallDir)) { & claude mcp remove --scope user cockpit *> $null }
}

# this script runs from inside the folder it removes, so the last step is left to a separate process
Start-Process cmd.exe "/d /c timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`"" -WindowStyle Hidden
Write-Host 'Cockpit is uninstalled. Your notes and board are still in Documents\Cockpit and .cockpit in your user folder.'
