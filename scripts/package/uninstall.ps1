# Takes Cockpit away: its Start menu, Send to and login entries, the Cockpit helper, the Claude Code connection, and the
# installed app. Your notes (Documents\Cockpit) and board (%USERPROFILE%\.cockpit) are kept; delete them yourself
# if you want them gone.
param([string]$InstallDir = $PSScriptRoot)
$ErrorActionPreference = 'Continue'
if (-not (Test-Path (Join-Path $InstallDir 'app\server\index.js'))) { throw "No installed Cockpit in $InstallDir" }

# only this copy's helper (a clone set up with npm run setup has its own)
Get-Process CockpitHotkey -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($InstallDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# the shortcuts, only where they point at this copy (a clone set up with `npm run setup` keeps its own)
$sh = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup')
foreach ($link in (Join-Path $startup 'Cockpit server.lnk'), (Join-Path $startup 'Cockpit hotkey.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit.lnk'), (Join-Path ([Environment]::GetFolderPath('SendTo')) 'Cockpit.lnk')) {
  if (-not (Test-Path $link)) { continue }
  $s = $sh.CreateShortcut($link)
  if ("$($s.TargetPath) $($s.Arguments)".Contains($InstallDir)) { Remove-Item $link }
}

# the Claude Code connection (the tools and the Outputs hook), only where it points at this copy
$node = Join-Path $InstallDir 'runtime\node.exe'
cmd /d /c "`"$node`" `"$(Join-Path $InstallDir 'app\scripts\claude-setup.mjs')`" remove-hook --only `"$InstallDir`" >nul 2>&1"
if (Get-Command claude -ErrorAction SilentlyContinue) {
  $info = cmd /d /c "claude mcp get cockpit 2>nul" | Out-String
  if ($info.Contains($InstallDir)) { cmd /d /c "claude mcp remove --scope user cockpit >nul 2>&1" }
}

# this script runs from inside the folder it removes, so the last step is left to a separate process
Start-Process cmd.exe "/d /c timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`"" -WindowStyle Hidden
Write-Host 'Cockpit is uninstalled. Your notes and board are still in Documents\Cockpit and .cockpit in your user folder.'
$sh2 = New-Object -ComObject WScript.Shell
$app = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cockpit.lnk'
if ((Test-Path $app) -and ($sh2.CreateShortcut($app).Arguments -match '--app-id=')) {
  Write-Host 'Cockpit was also installed as an app from Edge: remove it from Edge (edge://apps) or Settings > Apps.'
}
