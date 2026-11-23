// Connects Cockpit to Claude Code, or takes it away again, for the installer, the uninstaller and `npm run setup`:
//
//   node claude-setup.mjs add-hook --node <node.exe> [--settings <file>]     Outputs: a Stop hook in settings.json
//   node claude-setup.mjs remove-hook [--only <folder>] [--settings <file>]  takes Cockpit's hook out (only one
//                                                                            that runs from <folder>, with --only)
//   node claude-setup.mjs has-hook [--settings <file>]                       prints yes or no
//
// Only Cockpit's own hook is ever touched (it's found by its script, server/claude/outputs-hook.js); the rest of
// settings.json stays as it was, and the old file is kept beside it as settings.json.cockpit-backup.
// The MCP server (the show and snippet tools) is added with Claude Code's own `claude mcp add` instead.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(here, '..', 'server', 'claude', 'outputs-hook.js')
const ours = cmd => /outputs-hook\.js/i.test(String(cmd || '')) && /cockpit/i.test(String(cmd || ''))
const fwd = p => p.replace(/\\/g, '/')

export function readSettings(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    return s && typeof s === 'object' ? s : {}
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw new Error(`${file} isn't valid JSON, so it was left alone (${e.message})`)
  }
}

export function write(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.cockpit-backup')
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

/** The settings without Cockpit's hook (other Stop hooks, and everything else, kept). */
export function withoutHook(settings, only = '') {
  const mine = cmd => ours(cmd) && (!only || fwd(String(cmd)).toLowerCase().includes(fwd(only).toLowerCase()))
  const s = structuredClone(settings)
  const stop = s.hooks?.Stop
  if (!Array.isArray(stop)) return s
  const kept = stop
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !mine(h.command)) }))
    .filter(g => g.hooks.length)
  if (kept.length) s.hooks.Stop = kept
  else delete s.hooks.Stop
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks
  return s
}

/** The settings with Cockpit's hook, once (an older one is replaced, e.g. after Cockpit moved). */
export function withHook(settings, node) {
  const s = withoutHook(settings)
  s.hooks ||= {}
  s.hooks.Stop ||= []
  s.hooks.Stop.push({ hooks: [{ type: 'command', command: `"${fwd(node)}" "${fwd(HOOK)}"`, timeout: 20 }] })
  return s
}

export const hasHook = settings => (settings.hooks?.Stop || []).some(g => (g.hooks || []).some(h => ours(h.command)))

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const [, , action, ...rest] = process.argv
  const arg = name => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const file = arg('--settings') || path.join(os.homedir(), '.claude', 'settings.json')
  try {
    const settings = readSettings(file)
    if (action === 'add-hook') {
      const node = arg('--node') || process.execPath
      write(file, withHook(settings, node))
      console.log('added')
    } else if (action === 'remove-hook') {
      const after = withoutHook(settings, arg('--only') || '')
      if (JSON.stringify(after) !== JSON.stringify(settings)) write(file, after)
      console.log('removed')
    } else if (action === 'has-hook') {
      console.log(hasHook(settings) ? 'yes' : 'no')
    } else {
      console.error('usage: claude-setup.mjs add-hook --node <node.exe> | remove-hook | has-hook [--settings <file>]')
      process.exit(2)
    }
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
