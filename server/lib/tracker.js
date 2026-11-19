// Every tracker the tracker mod for Claude Code knows, if you use it (the hub's, those in its config, and extra paths
// in Cockpit's settings), read-only: open items, and which of them need the user.
import fs from 'node:fs'
import path from 'node:path'
import { HOME } from './config.js'

function resolveTrackerFile(p) {
  if (/\.json$/i.test(p)) return path.resolve(p)
  const a = path.join(p, 'tracker.json')
  const b = path.join(p, '.claude', 'tracker.json')
  return path.resolve(fs.existsSync(a) || !fs.existsSync(b) ? a : b)
}

// New trackers turn up by themselves: a light look for tracker.json under the usual work folders, at most every
// ten minutes, skipping build and dependency folders and stopping after a few thousand folders.
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', 'archive', '.next', 'target'])
let found = { at: 0, files: [] }

function scanFor(roots, maxDepth = 5, budget = 6000) {
  const out = []
  const walk = (dir, depth) => {
    if (budget-- <= 0) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) if (e.isFile() && e.name === 'tracker.json') out.push(path.join(dir, e.name))
    if (depth >= maxDepth) return
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.claude')) continue
      walk(path.join(dir, e.name), depth + 1)
    }
  }
  for (const r of roots) walk(r, 0)
  return out
}

export function discoveredTrackers(home, now = Date.now()) {
  if (now - found.at < 10 * 60 * 1000) return found.files
  let roots = ['projects', 'Desktop'].map(d => path.join(home, d))
  try {
    // OneDrive / SharePoint sync folders, e.g. "Contoso gGmbH" or "OneDrive - …"
    roots = roots.concat(fs.readdirSync(home, { withFileTypes: true }).filter(d => d.isDirectory() && /gGmbH|OneDrive|SharePoint/i.test(d.name)).map(d => path.join(home, d.name)))
  } catch {
    // no home listing: the usual folders only
  }
  const files = scanFor(roots.filter(r => fs.existsSync(r))).filter(f => {
    try {
      const head = fs.readFileSync(f, 'utf8').slice(0, 4000)
      return head.includes('"items"')
    } catch {
      return false
    }
  })
  found = { at: now, files }
  return files
}

export function trackerFiles(cfg, home) {
  const out = []
  const seen = new Set()
  const add = (p, nameHint) => {
    if (typeof p !== 'string' || !p.trim()) return
    const file = resolveTrackerFile(p.trim())
    const key = file.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ file, nameHint })
  }
  add(path.join(cfg.hubDir, 'tracker.json'))
  try {
    const conf = JSON.parse(fs.readFileSync(cfg.trackerConfig, 'utf8'))
    for (const t of conf.trackers ?? []) add(t?.path, t?.name)
  } catch {
    // no tracker mod config
  }
  for (const t of cfg.trackers) add(t)
  if (home) for (const f of discoveredTrackers(home)) add(f)
  return out
}

const pick = i => ({
  id: i.id, type: i.type, title: i.title, date: i.date, you: Boolean(i.you), blocker: i.blocker || '',
  who: i.who || '', note: i.note || '', tags: Array.isArray(i.tags) ? i.tags : [], about: i.about || '', where: i.where || '',
})

export function readTracker(file, nameHint) {
  const fallbackName = nameHint || path.basename(path.dirname(file)).replace(/^\.claude$/, path.basename(path.dirname(path.dirname(file))))
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'))
    const items = (Array.isArray(t.items) ? t.items : []).filter(i => i && typeof i === 'object' && !i.archived)
    const open = items.filter(i => i.status === 'open').map(pick)
    const order = { todo: 0, waiting: 1, check: 2, decided: 3 }
    open.sort((a, b) => Number(b.you) - Number(a.you) || (order[a.type] ?? 9) - (order[b.type] ?? 9) || String(b.date).localeCompare(String(a.date)))
    return {
      name: t.name || fallbackName,
      file,
      ok: true,
      open,
      counts: {
        yours: open.filter(i => i.type === 'todo' && i.you).length,
        todo: open.filter(i => i.type === 'todo').length,
        waiting: open.filter(i => i.type === 'waiting').length,
        check: open.filter(i => i.type === 'check').length,
        suggested: items.filter(i => i.status === 'suggested').length,
      },
    }
  } catch (e) {
    return { name: fallbackName, file, ok: false, error: e?.code === 'ENOENT' ? 'not found' : 'could not be read', open: [], counts: { yours: 0, todo: 0, waiting: 0, check: 0, suggested: 0 } }
  }
}

export function readTrackers(cfg) {
  return trackerFiles(cfg, HOME).map(({ file, nameHint }) => readTracker(file, nameHint))
}
