// What Claude made, one group per chat (16 Nov): each turn's files, links, drafts and commands are added to that
// chat's group with the time they came in, so the newest sit on top and older turns stay below a divider. The
// deliverables tray (a Claude Code mod, if you use it) sends them as each turn ends. One JSON per chat in ~/.cockpit/outputs; cleared ones are kept,
// hidden.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { newId, validId } from './shown.js'
import { drawingTitle, saveDrawing } from './drawings.js'

const KINDS = new Set(['file', 'link', 'draft', 'command', 'prompt'])
const MAX_ITEMS = 60
const KEEP_ITEMS = 200

export const outputsDir = () => path.join(DATA_DIR, 'outputs')

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const fileOf = id => path.join(outputsDir(), `${id}.json`)
const keyOf = g => g.key || `${g.cwd || ''}|${g.from || ''}`
const sig = i => `${i.kind}|${(i.target || i.text || '').toLowerCase()}`

function save(g) {
  writeFileAtomic(fileOf(g.id), JSON.stringify(g, null, 2) + '\n')
  return g
}

function readAll() {
  let names = []
  try {
    names = fs.readdirSync(outputsDir()).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const n of names) {
    try {
      const g = JSON.parse(fs.readFileSync(path.join(outputsDir(), n), 'utf8'))
      if (validId(g.id)) out.push(g)
    } catch {
      // half-written
    }
  }
  return out
}

export function addOutputs(req, now = new Date()) {
  const at = now.toISOString()
  const items = (Array.isArray(req?.items) ? req.items : [])
    // a drawing from the chat comes as its code: kept as a page (drawings.js), it's listed as that file
    .map(i => {
      if (i?.kind !== 'drawing' || typeof i.text !== 'string' || !i.text.trim()) return i
      try {
        const file = saveDrawing(i.label, i.text.slice(0, 2_000_000), now)
        return { kind: 'file', label: drawingTitle(i.label), text: file, target: file, detail: 'Drawing from the chat' }
      } catch {
        return null
      }
    })
    .filter(i => i && KINDS.has(i.kind))
    .slice(0, MAX_ITEMS)
    .map(i => ({
      kind: i.kind,
      label: str(i.label, 300) || str(i.target, 300) || str(i.text, 80),
      target: str(i.target, 2000),
      text: str(i.text, 200_000),
      detail: str(i.detail, 200),
      at,
      // a row keeps its id while newer turns push it down the list
      id: Math.random().toString(36).slice(2, 10),
    }))
  if (!items.length) throw new UserError('Nothing in that output')
  const from = str(req.from, 160) || 'Claude'
  const cwd = str(req.cwd, 400)
  const key = str(req.session, 80) || `${cwd}|${from}`

  // the chat already has a group: this turn goes on top of it, and anything made again moves up with it
  const existing = readAll()
    .filter(g => !g.hidden && keyOf(g) === key)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0]
  if (existing) {
    const fresh = new Set(items.map(sig))
    const older = existing.items.map(i => ({ ...i, at: i.at || existing.createdAt })).filter(i => !fresh.has(sig(i)))
    return save({ ...existing, key, from, cwd: cwd || existing.cwd, updatedAt: at, seen: false, items: [...items, ...older].slice(0, KEEP_ITEMS) })
  }
  return save({ id: newId(now.getTime()), key, createdAt: at, updatedAt: at, from, project: str(req.project, 120), cwd, seen: false, seenAt: null, items })
}

export function listOutputs(limit = 80) {
  return readAll()
    .filter(g => !g.hidden)
    .map(g => ({ ...g, updatedAt: g.updatedAt || g.createdAt, items: g.items.map((i, n) => ({ ...i, at: i.at || g.createdAt, id: i.id || String(n) })) }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
}

export function getOutputs(id) {
  if (!validId(id)) throw new UserError('Not an output', 404)
  try {
    return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'))
  } catch {
    throw new UserError('That output is gone', 404)
  }
}

export function updateOutputs(id, patch) {
  const g = getOutputs(id)
  if (patch.seen === true && !g.seen) g.seenAt = new Date().toISOString()
  for (const k of ['seen', 'hidden']) if (typeof patch[k] === 'boolean') g[k] = patch[k]
  return save(g)
}

/** Clear every group from the panel (kept on disk, hidden). */
export function clearOutputs() {
  let n = 0
  for (const g of readAll()) {
    if (g.hidden) continue
    save({ ...g, hidden: true })
    n++
  }
  return { cleared: n }
}

/** The file or link an output row points at, for "open in its own program". Only paths an output listed. */
export function outputItem(id, ref) {
  const items = getOutputs(id).items
  // rows from before 16 Nov have no id: their place in the list is their id (those groups never grow)
  return items.find(i => i.id && i.id === String(ref)) || (/^\d+$/.test(String(ref)) && !items[Number(ref)]?.id ? items[Number(ref)] : undefined)
}

export function outputTarget(id, index) {
  const item = outputItem(id, index)
  if (!item || !item.target) throw new UserError('Nothing to open there', 404)
  return item
}
