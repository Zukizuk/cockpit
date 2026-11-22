// "Choose files…" in the + box: Windows' own Open dialog, so a file chosen keeps its real path (a browser's file
// picker only ever hands over the file's contents). The server is on the same PC, so it opens the dialog through
// Windows PowerShell and returns the paths picked. One dialog at a time.
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

let busy = false

/** Opens the dialog and waits for it: { paths } (empty when it was cancelled), or { busy } if one is already open. */
export function pickFiles() {
  if (process.platform !== 'win32') return Promise.reject(new Error('Choosing files works on Windows only; paste a path instead'))
  if (busy) return Promise.resolve({ paths: [], busy: true })
  busy = true
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30 * 60_000 }, (err, stdout) => {
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
