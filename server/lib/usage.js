// What the user opens in Cockpit, counted, so the things they keep going back to show up in Quick access by themselves
// ("Often opened"), next to what was pinned by hand. An open is: a card or note read full screen, a file opened in its
// own program or shown in Explorer, a link opened in the browser, a pin clicked. Only the last 30 days are kept.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { detect } from './files.js'

const FILE = () => path.join(DATA_DIR, 'usage.json')
const DAY = 86_400_000
const KEEP = 30 * DAY
export const WINDOW = 14 * DAY
export const MIN_OPENS = 3
const SHOW = 8

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    return { things: d.things && typeof d.things === 'object' ? d.things : {}, hidden: Array.isArray(d.hidden) ? d.hidden : [] }
  } catch {
    return { things: {}, hidden: [] }
  }
}

function write(d) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  writeFileAtomic(FILE(), JSON.stringify(d) + '\n')
}

/** The same thing, however it was reached: a file by its path (any case on Windows), a link by its address, a note by its path. */
export function keyOf(kind, target) {
  const t = String(target || '').trim()
  if (kind === 'link') return `link:${t}`
  if (kind === 'note') return `note:${t.replace(/\\/g, '/')}`
  return `file:${process.platform === 'win32' ? path.resolve(t).toLowerCase() : path.resolve(t)}`
}

/**
 * Counts one open. `where` is 'cockpit' (read inside Cockpit) or 'outside' (its own program, Explorer, the browser),
 * so Often opened opens it the way the user usually does. `shownId` is the kept item it came from, to read it in Cockpit again.
 */
export function recordOpen({ kind, target, title, where = 'outside', shownId }, now = Date.now()) {
  if (!target || !['file', 'folder', 'link', 'note'].includes(kind)) return
  if (kind === 'note') target = String(target).replace(/\\/g, '/')
  const d = read()
  const key = keyOf(kind === 'folder' ? 'file' : kind, target)
  const t = d.things[key] || { kind, target, title: '', opens: [], inCockpit: 0, outside: 0 }
  t.kind = kind
  t.target = target
  if (title) t.title = String(title).slice(0, 120)
  if (shownId) t.shownId = shownId
  t.opens = [...t.opens.filter(x => now - x < KEEP), now].slice(-200)
  if (where === 'cockpit') t.inCockpit = (t.inCockpit || 0) + 1
  else t.outside = (t.outside || 0) + 1
  d.things[key] = t
  // forget what hasn't been opened in 30 days
  for (const [k, v] of Object.entries(d.things)) if (!v.opens.some(x => now - x < KEEP)) delete d.things[k]
  write(d)
}

/** Opened at least 3 times in the last two weeks, not pinned, not hidden, still there: most opened first. */
export function oftenOpened(pinnedKeys = new Set(), now = Date.now()) {
  const d = read()
  const hidden = new Set(d.hidden)
  const out = []
  for (const [key, t] of Object.entries(d.things)) {
    if (pinnedKeys.has(key) || hidden.has(key)) continue
    const recent = t.opens.filter(x => now - x < WINDOW).length
    if (recent < MIN_OPENS) continue
    if ((t.kind === 'file' || t.kind === 'folder') && !fs.existsSync(t.target)) continue
    out.push({
      key,
      kind: t.kind,
      target: t.target,
      title: t.title || (t.kind === 'link' ? t.target.replace(/^https?:\/\/(www\.)?/, '') : path.basename(t.target)),
      opens: recent,
      lastOpened: Math.max(...t.opens),
      inCockpit: (t.inCockpit || 0) > (t.outside || 0),
      shownId: t.shownId,
      viewable: t.kind === 'folder' ? false : t.kind === 'file' ? detect(t.target).format !== 'binary' : true,
    })
  }
  out.sort((a, b) => b.opens - a.opens || b.lastOpened - a.lastOpened)
  return out.slice(0, SHOW)
}

export function thing(key) {
  const t = read().things[key]
  if (!t) throw new UserError('Not opened recently', 404)
  return t
}

/** "Don't show this here": it stays out of Often opened (pinning it still works). */
export function hide(key) {
  const d = read()
  if (!d.hidden.includes(key)) d.hidden.push(key)
  d.hidden = d.hidden.slice(-500)
  write(d)
}
