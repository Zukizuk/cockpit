// Getting the user's attention when Claude waits on them (an Allow) while Cockpit's window is minimised or behind
// others: its taskbar button flashes until the window is brought up, as Windows does for a program that needs you.
// Windows only; elsewhere, and on any failure, nothing happens.
import { spawn } from 'node:child_process'

// FlashWindowEx on every top-level window titled "… Cockpit" (the app's window; the page sets its title to say what's
// waiting). FLASHW_ALL | FLASHW_TIMERNOFG: caption and taskbar button, until the window comes to the front.
const SCRIPT = `
Add-Type -Namespace CockpitAttention -Name Win -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public uint cbSize; public System.IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
[DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO f);
'@
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'Cockpit$' } | ForEach-Object {
  $f = New-Object CockpitAttention.Win+FLASHWINFO
  $f.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($f)
  $f.hwnd = $_.MainWindowHandle
  $f.dwFlags = 15
  [void][CockpitAttention.Win]::FlashWindowEx([ref]$f)
}
`

let last = 0

/** Flashes Cockpit's taskbar button (at most once every few seconds). */
export function flashWindow(now = Date.now()) {
  if (process.platform !== 'win32' || now - last < 5000) return false
  last = now
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true, stdio: 'ignore' })
    p.on('error', () => {})
    p.unref()
    return true
  } catch {
    return false
  }
}
