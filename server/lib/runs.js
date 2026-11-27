// Running a command Claude wrote, from its Outputs row: in the background with its output shown in a card, or in
// a Windows Terminal tab (Terminal on a Mac) for anything interactive. Only commands an output listed can be run
// (looked up by output id and row), never text sent by the page.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { HOME, UserError } from './config.js'
import { getOutputs, outputItem } from './outputs.js'

const MAX_OUT = 1024 * 1024
const KEEP_MS = 30 * 60 * 1000
const runs = new Map()

const win = process.platform === 'win32'
const mac = process.platform === 'darwin'
// Windows: PowerShell always, Git Bash when it's there. Elsewhere: the user's own shell, as a login shell (so what
// .zprofile or .bash_profile sets, Homebrew's PATH for one, is there even when Cockpit started at login), and
// PowerShell only when it's installed.
const loginShell = () => (/\/(zsh|bash)$/.test(process.env.SHELL || '') ? process.env.SHELL : mac ? '/bin/zsh' : '/bin/bash')
const PWSH = win
  ? ['C:/Program Files/PowerShell/7/pwsh.exe'].find(p => fs.existsSync(p)) || 'powershell.exe'
  : ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh', '/usr/bin/pwsh'].find(p => fs.existsSync(p))
const BASH = win ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(p => fs.existsSync(p)) : loginShell()

/** PowerShell for commands that look like PowerShell, Bash for the rest when Git Bash is there. */
export function guessShell(cmd) {
  if (!BASH) return 'pwsh'
  if (!PWSH) return 'bash'
  return /\$env:|\bGet-[A-Z]|\bSet-[A-Z]|\bNew-[A-Z]|\bInvoke-[A-Z]|-ErrorAction\b|\bWrite-Host\b|^\s*&\s*['"]|\| *(Select|Where|ForEach)-Object/m.test(cmd) ? 'pwsh' : 'bash'
}

export const shells = () => ({ pwsh: Boolean(PWSH), bash: Boolean(BASH) })

function argv(shell, cmd) {
  if (shell === 'bash') {
    if (!BASH) throw new UserError('Git Bash is not installed')
    return [BASH, ['-lc', cmd]]
  }
  if (!PWSH) throw new UserError('PowerShell is not installed')
  return [PWSH, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', cmd]]
}

/** The command an output row holds, and the folder it should run in (the chat's, unless one is given). */
export function commandFor(groupId, index, cwd) {
  const group = getOutputs(groupId)
  const item = outputItem(groupId, index)
  if (!item || item.kind !== 'command' || !item.text.trim()) throw new UserError('That row is not a command')
  const dir = String(cwd || group.cwd || HOME).trim().replace(/^"(.*)"$/, '$1')
  if (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`No folder at ${dir}`)
  return { command: item.text, cwd: dir }
}

const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '')

export function startRun({ groupId, index, shell, cwd }) {
  const { command, cwd: dir } = commandFor(groupId, index, cwd)
  const sh = shell === 'bash' || shell === 'pwsh' ? shell : guessShell(command)
  const [exe, args] = argv(sh, command)
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const run = { id, groupId, index: Number(index), shell: sh, cwd: dir, command, out: '', truncated: false, status: 'running', code: null, startedAt: Date.now(), endedAt: 0, child: null }
  const add = chunk => {
    if (run.out.length >= MAX_OUT) {
      run.truncated = true
      return
    }
    run.out += stripAnsi(chunk.toString('utf8'))
  }
  // off Windows in a process group of its own, so Stop can end everything it started
  const child = spawn(exe, args, { cwd: dir, windowsHide: true, detached: !win, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', GIT_TERMINAL_PROMPT: '0' } })
  run.child = child
  child.stdout.on('data', add)
  child.stderr.on('data', add)
  child.stdin.end() // nothing to type into: a command that waits for input ends instead of hanging
  child.on('error', e => {
    add(Buffer.from(`\n${e.message}\n`))
    run.status = 'failed'
    run.endedAt = Date.now()
  })
  child.on('close', code => {
    run.code = code
    if (run.status === 'running') run.status = code === 0 ? 'done' : 'failed'
    run.endedAt = Date.now()
    run.child = null
    setTimeout(() => runs.delete(id), KEEP_MS).unref()
  })
  runs.set(id, run)
  return view(run, 0)
}

function view(run, from) {
  const start = Math.max(0, Math.min(Number(from) || 0, run.out.length))
  return {
    id: run.id, shell: run.shell, cwd: run.cwd, command: run.command, status: run.status, code: run.code,
    startedAt: run.startedAt, endedAt: run.endedAt, truncated: run.truncated, out: run.out.slice(start), offset: run.out.length,
  }
}

export function getRun(id, from) {
  const run = runs.get(String(id))
  if (!run) throw new UserError('That run is gone (runs are kept for 30 minutes)', 404)
  return view(run, from)
}

export function stopRun(id) {
  const run = runs.get(String(id))
  if (!run) throw new UserError('That run is gone', 404)
  if (run.child) {
    run.status = 'stopped'
    // the whole tree: a shell's children would otherwise keep running
    if (win) spawn('taskkill', ['/PID', String(run.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => run.child?.kill())
    else killGroup(run.child.pid)
  }
  return view(run, run.out.length)
}

/** The run's process group: asked to end, then made to if it's still there a moment later. */
const signalGroup = (pid, sig) => {
  try {
    process.kill(-pid, sig)
  } catch {}
}
function killGroup(pid) {
  signalGroup(pid, 'SIGTERM')
  setTimeout(() => signalGroup(pid, 'SIGKILL'), 2000).unref()
}

// a run is in a group of its own off Windows, so it would outlive Cockpit: ended when Cockpit ends
if (!win) {
  const endAll = () => {
    for (const run of runs.values()) if (run.child) signalGroup(run.child.pid, 'SIGTERM')
  }
  process.on('exit', endAll)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.once(sig, () => {
      endAll()
      process.kill(process.pid, sig) // and on as it would have gone without this
    })
}

const quote = s => `'${String(s).replace(/'/g, "'\\''")}'`

/**
 * macOS: a .command script (Terminal runs those) that goes to the folder and runs the command in one interactive
 * shell that then stays open, as on Windows: what the command changes (a folder, a variable, an activated venv)
 * is there afterwards, and so is what .zshrc sets. A file rather than AppleScript, so nothing is quoted twice; it
 * removes itself as it starts.
 */
function openInMacTerminal(sh, command, dir, launch) {
  if (sh === 'bash' && !BASH) throw new UserError('Git Bash is not installed')
  if (sh === 'pwsh' && !PWSH) throw new UserError('PowerShell is not installed')
  const inner = sh === 'bash' ? [BASH, '-lic', `${command}; exec ${quote(BASH)} -l`] : [PWSH, '-NoLogo', '-NoExit', '-Command', command]
  const file = path.join(os.tmpdir(), `cockpit-${crypto.randomBytes(6).toString('hex')}.command`)
  const lines = ['#!/bin/sh', 'rm -f -- "$0"', `cd ${quote(dir)} || exit 1`, `exec ${inner.map(quote).join(' ')}`, '']
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o700, flag: 'wx' })
  launch('/usr/bin/open', ['-a', 'Terminal', file], () => fs.rmSync(file, { force: true }))
}

const detachedLaunch = (exe, args, onError) => {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => onError?.())
  child.on('exit', code => code && onError?.())
  child.unref()
}

/** Opens the command in a Windows Terminal tab (Terminal on a Mac) in its folder, ready to run and to answer prompts. */
export function openInTerminal({ groupId, index, shell, cwd }, { launch = detachedLaunch } = {}) {
  const { command, cwd: dir } = commandFor(groupId, index, cwd)
  const sh = shell === 'bash' || shell === 'pwsh' ? shell : guessShell(command)
  if (mac) {
    openInMacTerminal(sh, command, dir, launch)
    return { ok: true, shell: sh }
  }
  if (!win) throw new UserError('Opening a terminal works on Windows and macOS; use Run instead')
  const wt = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')
  const inner = sh === 'bash' ? [BASH, '-lc', `${command}; exec bash`] : [PWSH, '-NoLogo', '-NoExit', '-Command', command]
  // Windows Terminal splits its own command line at ';': escape them so the command arrives whole
  const [exe, args] = fs.existsSync(wt) ? [wt, ['-w', '0', 'new-tab', '-d', dir, '--title', 'Cockpit', ...inner.map(a => a.replace(/;/g, '\\;'))]] : [inner[0], inner.slice(1)]
  const child = spawn(exe, args, { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => {})
  child.unref()
  return { ok: true, shell: sh }
}
