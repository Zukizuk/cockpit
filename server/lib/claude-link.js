// Whether Cockpit is connected to Claude Code, and connecting it from Settings (the installer asks once, but only
// when Claude Code's command is there then and someone says yes; this is the way to do it afterwards).
// Two parts: the Outputs hook (a Stop hook in ~/.claude/settings.json: what each turn made) and the board tools (the
// MCP server, registered for the user in ~/.claude.json by `claude mcp add`).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, HOME } from './config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const MCP = path.resolve(here, '..', 'mcp.js')
const HOOK = path.resolve(here, '..', 'claude', 'outputs-hook.js')
const SETUP = path.resolve(here, '..', '..', 'scripts', 'claude-setup.mjs')
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

/** Claude Code's own command, if it's on this PC (where.exe finds claude.exe or claude.cmd). */
function findClaude() {
  return new Promise(resolve => execFile('where.exe', ['claude'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : String(out).split(/\r?\n/).find(Boolean) || '')))
}

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
  return { hook, tools, lastOutput, claude: !!claude, command: `claude mcp add --scope user cockpit -- "${process.execPath}" "${MCP}"` }
}

const run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 30000, shell: /\.(cmd|bat)$/i.test(file) }, (err, out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split(/\r?\n/)[0])) : resolve(out))),
  )

/** Connects both parts to this copy of Cockpit (each replaces an older one); returns what's connected now. */
export async function connectClaude() {
  const { readSettings, withHook, write } = await import(new URL(`file:///${SETUP.replace(/\\/g, '/')}`).href)
  const problems = []
  try {
    write(settingsFile(), withHook(readSettings(settingsFile()), process.execPath))
  } catch (e) {
    problems.push(`Outputs: ${e.message}`)
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

