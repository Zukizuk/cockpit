# Adds (or with -Remove, removes) a shortcut in the Windows Startup folder that starts Cockpit's server hidden at login.
param([switch]$Remove)
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Cockpit server.lnk'
if ($Remove) {
  if (Test-Path $link) { Remove-Item $link; 'Removed the Cockpit login start.' } else { 'No Cockpit login start to remove.' }
  return
}
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($link)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = "`"$vbs`""
$s.WorkingDirectory = Split-Path $PSScriptRoot
$s.Description = "Starts Cockpit's local server (127.0.0.1:4790)"
$s.Save()
"Added $link"
