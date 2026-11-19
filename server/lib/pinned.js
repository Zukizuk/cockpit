// Pinned: what the user opens again and again (a daily Excel file, a folder, a site, a note), one click from anywhere in
// Cockpit. Unlike Later there is nothing to read or finish: a pin stays until it is unpinned. Optional groups keep
// them sorted ("Work", "Personal"); within a group the most opened come first.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { detect, openOutside, openUrl } from './files.js'

const FILE = () => path.join(DATA_DIR, 'pinned.json')
const MAX = 200

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    return { items: Array.isArray(d.items) ? d.items : [] }
  } catch {
    return { items: [] }
  }
}

function write(d) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  writeFileAtomic(FILE(), JSON.stringify(d, null, 2) + '\n')
}

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function linkTitle(url) {
  try {
    const u = new URL(url)
    const tail = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop()
    return `${u.hostname.replace(/^www\./, '')}${tail ? ` · ${decodeURIComponent(tail)}` : ''}`
  } catch {
    return url
  }
}

/** As the panel shows it: whether it's still there, and whether Cockpit can show it itself ("Read in Cockpit"). */
function view(p) {
  if (p.kind === 'folder') return { ...p, missing: !fs.existsSync(p.target), viewable: false }
  if (p.kind === 'file') {
    const missing = !fs.existsSync(p.target)
    return { ...p, missing, viewable: !missing && detect(p.target).format !== 'binary' }
  }
  return { ...p, viewable: true }
}

/** Pins, in groups as they were named, most opened first within each. */
export function listPinned() {
  const items = read().items.map(view)
  items.sort((a, b) => (b.opens || 0) - (a.opens || 0) || a.addedAt - b.addedAt)
  const groups = [...new Set(items.map(p => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return { items, groups }
}

/** Pins a file or folder ({path}), a web link ({url}) or a note ({note}: its path in the notes folder). */
export function addPin({ path: file, url, note, title, group } = {}) {
  let kind
  let target
  if (url) {
    if (!/^https?:\/\//i.test(String(url).trim())) throw new UserError('Only web links (http or https) can be pinned')
    kind = 'link'
    target = String(url).trim()
  } else if (note) {
    kind = 'note'
    target = String(note).replace(/\\/g, '/').trim()
  } else if (file) {
    target = path.resolve(String(file).trim().replace(/^"(.*)"$/, '$1'))
    if (!fs.existsSync(target)) throw new UserError('That file or folder is not there', 404)
    kind = fs.statSync(target).isDirectory() ? 'folder' : 'file'
  } else throw new UserError('Pin a file, a folder, a link or a note')

  const d = read()
  const same = d.items.find(p => p.kind === kind && (kind === 'link' ? p.target === target : p.target.toLowerCase() === target.toLowerCase()))
  if (same) return { ...view(same), already: true }
  if (d.items.length >= MAX) throw new UserError(`Pinned holds ${MAX} things; unpin some first`)
  const p = {
    id: newId(),
    kind,
    target,
    title: clean(title, 120) || (kind === 'link' ? linkTitle(target) : kind === 'note' ? path.basename(target).replace(/\.(md|markdown|txt)$/i, '') : path.basename(target) || target),
    group: clean(group, 40),
    opens: 0,
    addedAt: Date.now(),
  }
  d.items.push(p)
  write(d)
  return view(p)
}

export function updatePin(id, patch = {}) {
  const d = read()
  const p = d.items.find(x => x.id === id)
  if (!p) throw new UserError('That pin is gone', 404)
  if (patch.title !== undefined) p.title = clean(patch.title, 120) || p.title
  if (patch.group !== undefined) p.group = clean(patch.group, 40)
  write(d)
  return view(p)
}

export function removePin(id) {
  const d = read()
  const n = d.items.length
  d.items = d.items.filter(x => x.id !== id)
  if (d.items.length === n) throw new UserError('That pin is gone', 404)
  write(d)
  return { removed: id }
}

/**
 * Opens a pin and counts it: a file in its own program (or shown in Explorer with how=reveal), a folder in Explorer,
 * a link in the browser. A note can't be opened outside: its path is returned for Cockpit to open it.
 */
export function openPin(id, how = 'default', { openFile = openOutside, openLink = openUrl } = {}) {
  const d = read()
  const p = d.items.find(x => x.id === id)
  if (!p) throw new UserError('That pin is gone', 404)
  if (p.kind === 'link') openLink(p.target)
  else if (p.kind === 'file' || p.kind === 'folder') {
    try {
      openFile(p.target, how === 'reveal' ? 'reveal' : 'default')
    } catch (e) {
      throw new UserError(e.status === 404 ? `${p.title} is no longer at ${p.target}` : e.message, e.status || 500)
    }
  }
  p.opens = (p.opens || 0) + 1
  p.lastOpened = Date.now()
  write(d)
  return { ...view(p), note: p.kind === 'note' ? p.target : undefined }
}
