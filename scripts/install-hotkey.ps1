# Builds the Cockpit helper (scripts\hotkey\CockpitHotkey.cs) with Windows' own C# compiler, starts it at login
# from the Startup folder, and starts it now. The helper holds Ctrl+Alt+K (brings Cockpit's window up) and keeps
# Cockpit's server running. Run again after changing the .cs file or reinstalling the app. -Remove takes it away.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'hotkey\CockpitHotkey.cs'
# kept in the project (bin is git-ignored): a Claude chat's own writes to AppData can be visible to that chat only
$bin = Join-Path $here 'hotkey\bin'
$exe = Join-Path $bin 'CockpitHotkey.exe'
$vbs = Join-Path $here 'start-hidden.vbs'
$startupDir = [Environment]::GetFolderPath('Startup')
$startup = Join-Path $startupDir 'Cockpit hotkey.lnk'

Get-Process CockpitHotkey -ErrorAction SilentlyContinue | Stop-Process -Force
if ($Remove) {
  Remove-Item $startup, $bin -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Cockpit helper removed.'
  return
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Force $bin | Out-Null
& $csc /nologo /target:winexe /optimize "/out:$exe" $src
if ($LASTEXITCODE) { throw "The compiler failed ($LASTEXITCODE)" }

# What Ctrl+Alt+K opens: the installed app's own launcher, read from the shortcut the browser made when the app was
# installed (its "open at login" entry in Startup, or a Start Menu one), as "program|arguments".
$sh = New-Object -ComObject WScript.Shell
$made = Get-ChildItem $startupDir, ([Environment]::GetFolderPath('Programs')) -Filter 'Cockpit*.lnk' -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object { $sh.CreateShortcut($_.FullName) } | Where-Object { $_.Arguments -match '--app-id=(\S+)' } | Select-Object -First 1
$app = ''
if ($made) {
  $id = [regex]::Match($made.Arguments, '--app-id=(\S+)').Groups[1].Value
  $profile = [regex]::Match($made.Arguments, '--profile-directory=("[^"]+"|\S+)').Groups[1].Value
  $app = "$($made.TargetPath)|--profile-directory=$profile --app-id=$id"
} else {
  Write-Warning 'The installed Cockpit app was not found: Ctrl+Alt+K has nothing to open until it is installed (then run this again)'
}
Set-Content -Path (Join-Path $bin 'app.txt') -Value $app -NoNewline
Set-Content -Path (Join-Path $bin 'server.txt') -Value $vbs -NoNewline

# at login: no arguments, so it reads app.txt and server.txt
$l = $sh.CreateShortcut($startup)
$l.TargetPath = $exe
$l.Arguments = ''
$l.Description = 'Ctrl+Alt+K brings Cockpit up, and keeps its server running'
$l.Save()

# Started now by Task Scheduler, not as a child of this shell: whatever runs this script (a Claude chat, a terminal)
# can end without taking the helper (and the server it starts) down with it.
# (schtasks warns on stderr that 00:00 has passed; Windows PowerShell 5.1 would stop on that, so it runs through cmd)
cmd /d /c "schtasks /Create /TN `"Cockpit helper start`" /TR `"\`"$exe\`"`" /SC ONCE /ST 00:00 /F >nul 2>&1"
cmd /d /c "schtasks /Run /TN `"Cockpit helper start`" >nul 2>&1"
Start-Sleep -Seconds 4
cmd /d /c "schtasks /Delete /TN `"Cockpit helper start`" /F >nul 2>&1"
$running = [bool](Get-Process CockpitHotkey -ErrorAction SilentlyContinue)
Write-Host "Cockpit helper built at $exe (opens: $app), starts at login, running now: $running"
