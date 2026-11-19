// Optional: the hub's project pages (~/hub/projects/<id>.md, kept current by a daily catch-up job), with each project's
// status from the PROJECTS.md table.
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from './config.js'

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i

function statusIndex(hubDir) {
  const map = {}
  try {
    const text = fs.readFileSync(path.join(hubDir, 'PROJECTS.md'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = /\]\(projects\/([^)]+?)\.md\)/.exec(line)
      if (!m || !line.trim().startsWith('|')) continue
      const cells = line.split('|').map(c => c.trim())
      // | Name | status | date | ... — cells[0] is empty (before the first bar)
      map[m[1]] = { status: cells[2] || '', last: cells[3] || '' }
    }
  } catch {
    // no index: no statuses
  }
  return map
}

export function summarizeProject(text) {
  const title = (/^#\s+(.+?)\s*$/m.exec(text) || [])[1] || ''
  let inShort = ''
  const at = text.search(/^##\s+In short\s*$/m)
  if (at >= 0) {
    const rest = text.slice(at).split(/\r?\n/).slice(1)
    inShort = rest.find(l => l.trim() && !l.startsWith('#'))?.trim() || ''
  }
  const updates = [...text.matchAll(/^Updated (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC/gm)]
  const updated = updates.length ? updates[updates.length - 1][1] : ''
  return { title, inShort, updated }
}

export function listProjects(cfg) {
  const dir = path.join(cfg.hubDir, 'projects')
  const statuses = statusIndex(cfg.hubDir)
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => n.endsWith('.md') && !n.startsWith('_') && !n.startsWith('.'))
  } catch {
    return []
  }
  const out = names.map(n => {
    const id = n.slice(0, -3)
    const file = path.join(dir, n)
    const st = fs.statSync(file)
    const text = fs.readFileSync(file, 'utf8').slice(0, 200_000)
    const s = summarizeProject(text)
    return { id, title: s.title || id, inShort: s.inShort, updated: s.updated, mtime: st.mtimeMs, status: statuses[id]?.status || '' }
  })
  const rank = s => (/active|current|ongoing/i.test(s) ? 0 : s ? 1 : 2)
  out.sort((a, b) => rank(a.status) - rank(b.status) || b.mtime - a.mtime)
  return out
}

export function projectFile(cfg, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new UserError('Not a project', 404)
  return path.join(cfg.hubDir, 'projects', `${id}.md`)
}

export function readProject(cfg, id) {
  const file = projectFile(cfg, id)
  try {
    const st = fs.statSync(file)
    return { id, path: file, text: fs.readFileSync(file, 'utf8'), mtime: st.mtimeMs }
  } catch {
    throw new UserError('No such project page', 404)
  }
}
