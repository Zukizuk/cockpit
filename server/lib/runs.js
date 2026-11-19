// Running a command Claude wrote, from its Outputs row: in the background with its output shown in a card, or in
// a Windows Terminal tab for anything interactive. Only commands an output listed can be run (looked up by output
// id and row), never text sent by the page.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { HOME, UserError } from './config.js'
import { getOutputs, outputItem } from './outputs.js'

const MAX_OUT = 1024 * 1024
const KEEP_MS = 30 * 60 * 1000
const runs = new Map()

const PWSH = ['C:/Program Files/PowerShell/7/pwsh.exe'].find(p => fs.existsSync(p)) || 'powershell.exe'
const BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(p => fs.existsSync(p))

/** PowerShell for commands that look like PowerShell, Bash for the rest when Git Bash is there. */
export function guessShell(cmd) {
  if (!BASH) return 'pwsh'
  return /\$env:|\bGet-[A-Z]|\bSet-[A-Z]|\bNew-[A-Z]|\bInvoke-[A-Z]|-ErrorAction\b|\bWrite-Host\b|^\s*&\s*['"]|\| *(Select|Where|ForEach)-Object/m.test(cmd) ? 'pwsh' : 'bash'
}

export const shells = () => ({ pwsh: true, bash: Boolean(BASH) })

function argv(shell, cmd) {
  if (shell === 'bash') {
    if (!BASH) throw new UserError('Git Bash is not installed')
    return [BASH, ['-lc', cmd]]
  }
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
  const child = spawn(exe, args, { cwd: dir, windowsHide: true, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', GIT_TERMINAL_PROMPT: '0' } })
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
    spawn('taskkill', ['/PID', String(run.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => run.child?.kill())
  }
  return view(run, run.out.length)
}

/** Opens the command in a Windows Terminal tab in its folder, ready to run and to answer prompts. */
export function openInTerminal({ groupId, index, shell, cwd }) {
  const { command, cwd: dir } = commandFor(groupId, index, cwd)
  const sh = shell === 'bash' || shell === 'pwsh' ? shell : guessShell(command)
  const wt = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')
  const inner = sh === 'bash' ? [BASH, '-lc', `${command}; exec bash`] : [PWSH, '-NoLogo', '-NoExit', '-Command', command]
  // Windows Terminal splits its own command line at ';': escape them so the command arrives whole
  const [exe, args] = fs.existsSync(wt) ? [wt, ['-w', '0', 'new-tab', '-d', dir, '--title', 'Cockpit', ...inner.map(a => a.replace(/;/g, '\\;'))]] : [inner[0], inner.slice(1)]
  const child = spawn(exe, args, { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => {})
  child.unref()
  return { ok: true, shell: sh }
}
