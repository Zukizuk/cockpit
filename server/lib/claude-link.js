// Whether Cockpit is connected to Claude Code, and connecting it from Settings (the installer asks once, but only
// when Claude Code's command is there then and someone says yes; this is the way to do it afterwards).
// Two parts: the Outputs hook (a Stop hook in ~/.claude/settings.json: what each turn made) and the board tools (the
// MCP server, registered for the user in ~/.claude.json by `claude mcp add`).
import { appPath } from './app-root.js'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DATA_DIR, HOME, loadConfig, writeFileAtomic } from './config.js'

// these paths are what Claude Code's settings point at: the installed layout keeps them where they are in the source
const MCP = appPath('server', 'mcp.js')
const HOOK = appPath('server', 'claude', 'outputs-hook.js')
const SETUP = appPath('scripts', 'claude-setup.mjs')
const settingsFile = () => path.join(HOME, '.claude', 'settings.json')
const userFile = () => path.join(HOME, '.claude.json')
const same = (a, b) => path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase()
const fwd = p => String(p).replace(/\\/g, '/').toLowerCase()

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch {
    return {}
  }
}

/** Claude Code's own command (where.exe finds claude.exe or claude.cmd on Windows). */
export async function findClaude(env = process.env) {
  if (process.platform !== 'win32') return findUnixClaude(env)
  return new Promise(resolve => execFile('where.exe', ['claude'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : String(out).split(/\r?\n/).find(Boolean) || '')))
}

function findUnixClaude(env) {
  const home = env.HOME || os.homedir()
  const prefix = env.npm_config_prefix || env.NPM_CONFIG_PREFIX
  // A launcher or login job may start Cockpit without the user's shell PATH.
  const dirs = [
    ...(env.PATH || '').split(path.delimiter).filter(Boolean),
    path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'), path.join(home, '.bun', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin',
    ...(prefix ? [path.join(prefix, 'bin')] : []), path.dirname(process.execPath),
  ]
  for (const dir of dirs) {
    const file = path.resolve(dir, 'claude')
    try {
      if (!fs.statSync(file).isFile()) continue
      fs.accessSync(file, fs.constants.X_OK)
      return file
    } catch {}
  }
  return ''
}

const shellQuote = value => `'${value.replace(/'/g, "'\\''")}'`

/**
 * yes: connected to this copy of Cockpit; other: connected to another copy (an older install, or a folder that's
 * gone), so it needs connecting again; no: not connected.
 */
export async function claudeLink() {
  const stops = readJson(settingsFile()).hooks?.Stop || []
  const hooks = stops.flatMap(g => g.hooks || []).map(h => String(h.command || '')).filter(c => /outputs-hook\.js/i.test(c) && /cockpit/i.test(c))
  const hook = hooks.some(c => fwd(c).includes(fwd(HOOK))) ? 'yes' : hooks.length ? 'other' : 'no'
  const server = readJson(userFile()).mcpServers?.cockpit
  const tools = !server ? 'no' : (server.args || []).some(a => same(a, MCP)) ? 'yes' : 'other'
  const claude = await findClaude()
  // when a chat's outputs last came in, by whatever way (another hook or a mod may deliver them too)
  let lastOutput = 0
  try {
    const dir = path.join(DATA_DIR, 'outputs')
    for (const n of fs.readdirSync(dir)) lastOutput = Math.max(lastOutput, fs.statSync(path.join(dir, n)).mtimeMs)
  } catch {}
  const command = process.platform === 'win32'
    ? `claude mcp add --scope user cockpit -- "${process.execPath}" "${MCP}"`
    : `${claude ? shellQuote(claude) : 'claude'} mcp add --scope user cockpit -- ${shellQuote(process.execPath)} ${shellQuote(MCP)}`
  return { hook, tools, fence: fenceState(loadConfig()), lastOutput, claude: !!claude, command }
}

function run(file, args) {
  const options = { windowsHide: true, timeout: 30000, shell: /\.(cmd|bat)$/i.test(file) }
  if (process.platform !== 'win32') {
    // npm's Claude command may need to find Node even when Cockpit was launched by absolute path.
    const PATH = [process.env.PATH, path.dirname(process.execPath)].filter(Boolean).join(path.delimiter)
    options.env = { ...process.env, PATH }
  }
  return new Promise((resolve, reject) =>
    execFile(file, args, options, (err, out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split(/\r?\n/)[0])) : resolve(out))),
  )
}

// ---- the fence: Claude Code asked not to read Cockpit's notes or data folders ----------------------------------
// Deny rules in ~/.claude/settings.json. They stop Claude Code's Read, Edit and Write (and Grep and Glob) there, and
// the shell's cat, head, tail, sed and tee; on Windows commands aren't sandboxed, so a command that reads files
// another way (PowerShell's Get-Content, a script) still could. Agents get what's shared through the board tools.

/** Claude Code's form of an absolute Windows path in a rule: C:\Users\me becomes //c/Users/me. */
export const rulePath = p => {
  const fwdp = path.resolve(p).replace(/\\/g, '/')
  const m = /^([A-Za-z]):\/(.*)$/.exec(fwdp)
  return m ? `//${m[1].toLowerCase()}/${m[2]}` : `/${fwdp}`
}
const FENCE_MARK = /^Read\(\/\/.*\)$/
export function fenceRules(cfg) {
  return [cfg.notesDir, DATA_DIR].map(d => `Read(${rulePath(d).replace(/\/+$/, '')}/**)`)
}

/** Whether the fence is in Claude Code's settings now. */
export function fenceState(cfg) {
  const deny = readJson(settingsFile()).permissions?.deny || []
  return fenceRules(cfg).every(r => deny.includes(r)) ? 'yes' : 'no'
}

/**
 * Puts the fence in (on) or takes it out. Rules for an earlier notes folder are taken out too (those Cockpit wrote:
 * a Read rule on a folder holding Cockpit's files is recognised by the folder's name in rules it remembers).
 */
export function applyFence(cfg, on, { previous = [] } = {}) {
  const file = settingsFile()
  if (!fs.existsSync(path.dirname(file))) return 'no' // Claude Code isn't set up here
  const s = readJson(file)
  const mine = new Set([...fenceRules(cfg), ...previous.filter(r => FENCE_MARK.test(r))])
  const deny = (s.permissions?.deny || []).filter(r => !mine.has(r))
  if (on) deny.push(...fenceRules(cfg))
  s.permissions = { ...(s.permissions || {}), deny }
  if (!deny.length) delete s.permissions.deny
  if (!Object.keys(s.permissions).length) delete s.permissions
  writeFileAtomic(file, JSON.stringify(s, null, 2) + '\n')
  return on ? 'yes' : 'no'
}

/**
 * Once, the first time a version with the fence starts: someone already connected to Claude Code gets it (as Connect
 * now does), unless they turned it off in Settings. After that only Connect and the switch change it.
 */
export function settleFence() {
  const marker = path.join(DATA_DIR, 'fence-settled')
  if (fs.existsSync(marker)) return
  const cfg = loadConfig()
  if (cfg.agentFence && readJson(userFile()).mcpServers?.cockpit) applyFence(cfg, true)
  writeFileAtomic(marker, new Date().toISOString() + '\n')
}

/** Connects both parts to this copy of Cockpit (each replaces an older one); returns what's connected now. */
export async function connectClaude() {
  const { readSettings, withHook, write } = await import(new URL(`file:///${SETUP.replace(/\\/g, '/')}`).href)
  const problems = []
  try {
    write(settingsFile(), withHook(readSettings(settingsFile()), process.execPath))
  } catch (e) {
    problems.push(`Outputs: ${e.message}`)
  }
  try {
    const cfg = loadConfig()
    if (cfg.agentFence) applyFence(cfg, true)
  } catch (e) {
    problems.push(`Fence: ${e.message}`)
  }
  const claude = await findClaude()
  if (!claude) problems.push("Board tools: Claude Code's command (claude) wasn't found on this PC")
  else {
    try {
      await run(claude, ['mcp', 'remove', '--scope', 'user', 'cockpit']).catch(() => {})
      await run(claude, ['mcp', 'add', '--scope', 'user', 'cockpit', '--', process.execPath, MCP])
    } catch (e) {
      problems.push(`Board tools: ${e.message}`)
    }
  }
  return { ...(await claudeLink()), problems }
}

