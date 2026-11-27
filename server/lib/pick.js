// "Choose files…" in the + box: the system's own Open dialog, so a file chosen keeps its real path (a browser's file
// picker only ever hands over the file's contents). The server is on the same machine, so it opens the dialog through
// PowerShell on Windows or AppleScript on macOS and returns the paths picked. One dialog at a time.
import { execFile } from 'node:child_process'

const SCRIPT = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.Application]::EnableVisualStyles()
# an owner kept on top, so the dialog comes up over Cockpit's window rather than behind it
$owner = New-Object Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; Width = 1; Height = 1; StartPosition = 'CenterScreen' }
$owner.Show()
$owner.Activate()
$d = New-Object Windows.Forms.OpenFileDialog -Property @{ Multiselect = $true; Title = 'Put on the board'; Filter = 'All files (*.*)|*.*' }
$picked = @()
if ($d.ShowDialog($owner) -eq [Windows.Forms.DialogResult]::OK) { $picked = $d.FileNames }
$owner.Close()
ConvertTo-Json -Compress -InputObject @($picked)
`

// activate brings the dialog in front of Cockpit's window; the paths are split by NUL, the one character a file name can't hold
const MAC_SCRIPT = [
  'activate',
  'set picked to choose file with prompt "Put on the board" with multiple selections allowed',
  'set out to {}',
  'repeat with f in picked',
  '  set end of out to POSIX path of f',
  'end repeat',
  "set AppleScript's text item delimiters to (character id 0)",
  'return out as text',
].join('\n')

const EXEC_OPTS = { maxBuffer: 4 * 1024 * 1024, timeout: 30 * 60_000 }

/** Splits osascript's NUL-separated paths, dropping only the line break osascript adds at the end. */
export function parseMacPaths(stdout) {
  return String(stdout || '').replace(/\n$/, '').split('\0').filter(Boolean)
}

/** AppleScript raises error -128 when the user presses Cancel. */
export function isMacCancel(err, stderr) {
  return /\(-128\)/.test(`${stderr || ''} ${err?.stderr || ''} ${err?.message || ''}`)
}

let busy = false

/** Opens the dialog and waits for it: { paths } (empty when it was cancelled), or { busy } if one is already open. */
export function pickFiles({ platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32' && platform !== 'darwin') {
    return Promise.reject(new Error('Choosing files is not available here; paste a path instead'))
  }
  if (busy) return Promise.resolve({ paths: [], busy: true })
  busy = true
  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      run('/usr/bin/osascript', ['-e', MAC_SCRIPT], EXEC_OPTS, (err, stdout, stderr) => {
        busy = false
        if (err) {
          if (isMacCancel(err, stderr)) return resolve({ paths: [] })
          return reject(new Error("Couldn't open the file picker"))
        }
        resolve({ paths: parseMacPaths(stdout) })
      })
      return
    }
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, ...EXEC_OPTS }, (err, stdout) => {
      busy = false
      if (err) return reject(new Error("Couldn't open the file picker"))
      try {
        const out = JSON.parse(String(stdout).trim() || '[]')
        resolve({ paths: (Array.isArray(out) ? out : [out]).filter(p => typeof p === 'string' && p) })
      } catch {
        reject(new Error("Couldn't read what was picked"))
      }
    })
  })
}
