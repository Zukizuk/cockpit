// What agents (or I) put on Cockpit to look at. One small JSON file per entry in ~/.cockpit/shown; content written
// with the show tool is kept beside it in shown/content, so it stays readable after the chat ends. The MCP server
// writes here directly, so showing works even while the app is closed.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, UserError, within, writeFileAtomic } from './config.js'
import { CONTENT_EXT, TEXT_FORMATS, detect, looksLikeText } from './files.js'
import { readArticle } from './reader.js'

export const FORMATS = ['markdown', 'html', 'code', 'text', 'diff', 'json', 'csv', 'mermaid']

/** A short plain-text preview for library cards. */
export function excerptOf(text, max = 220) {
  return String(text || '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|[\]()!-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function fileExcerpt(file, format) {
  if (!['markdown', 'text', 'code', 'csv', 'json'].includes(format) || !looksLikeText(file)) return ''
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(4096)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      return excerptOf(buf.subarray(0, n).toString('utf8'))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function save(entry) {
  writeFileAtomic(path.join(shownDir(), `${entry.id}.json`), JSON.stringify(entry, null, 2) + '\n')
  return entry
}

/** A web link, kept as a readable article. If the page can't be read, the link is kept with the reason. */
export async function addLink({ url, title, note, from, tags }, fetchImpl) {
  const id = newId()
  const base = { id, createdAt: new Date().toISOString(), seen: false, ...(from ? { from } : {}), ...(note ? { note: note.slice(0, 300) } : {}), tags: cleanTags(tags) }
  try {
    const a = await readArticle(url, fetchImpl)
    const file = path.join(contentDir(), `${id}.html`)
    writeFileAtomic(file, a.html)
    return save({ ...base, kind: 'link', format: 'article', path: file, url: a.url, title: title?.trim() || a.title, siteName: a.siteName, byline: a.byline, excerpt: a.excerpt || '', image: a.image, words: a.words })
  } catch (e) {
    if (e?.status === 400) throw e // not a link at all
    let host = ''
    try {
      host = new URL(url).host
    } catch {
      // checked above
    }
    return save({ ...base, kind: 'link', format: 'link', path: '', url: String(url).trim(), title: title?.trim() || host, siteName: host.replace(/^www\./, ''), excerpt: '', readError: e?.message || 'Could not read it' })
  }
}

// ---- Later: links and notes kept to check when there's time ------------------------------------------------

export const LATER_STATES = ['todo', 'reading', 'done']
const sameUrl = (a, b) => String(a || '').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\/+$/, '').toLowerCase()

/**
 * Keeps a link (or a short note) on the Later list. A link is saved at once with its address as the title and
 * read in the background, so the article is ready to read in Cockpit by the time there's a moment for it.
 * Saving a link that is already kept brings it back to "to check" instead of making a second copy.
 */
export function saveForLater({ url, path: file, text, title } = {}, fetchImpl) {
  const now = new Date().toISOString()
  // a file (one Claude made, say): the same kept item as when it's shown, now also on the list
  if (typeof file === 'string' && file.trim()) {
    const e = addShown({ path: file, from: 'you' })
    return save({ ...e, seen: true, later: e.later === 'reading' ? 'reading' : 'todo', laterAt: now, doneAt: undefined, ...(title?.trim() ? { title: title.trim().slice(0, 200) } : {}) })
  }
  const words = String(text || '').trim()
  const link = String(url || '').trim() || (/https?:\/\/[^\s<>"]+/i.exec(words)?.[0] ?? '')
  if (!link && !words) throw new UserError('Give a link or some text')
  if (!link) {
    const first = words.split('\n')[0].trim()
    const e = addShown({ content: words, format: 'markdown', title: title?.trim() || (first.length > 80 ? `${first.slice(0, 77)}…` : first), from: 'you' })
    return save({ ...e, seen: true, later: 'todo', laterAt: now })
  }
  let u
  try {
    u = new URL(link)
  } catch {
    throw new UserError('That is not a link')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UserError('Only web links can be kept for later')
  // matched on the address it was saved with too: a page that redirects is kept under where it ended up
  const again = listShown({ includeHidden: true }).find(e => e.kind === 'link' && (sameUrl(e.url, u.href) || sameUrl(e.savedUrl, u.href)))
  if (again) {
    const { doneAt, ...rest } = again
    return save({ ...rest, hidden: false, later: again.later === 'reading' ? 'reading' : 'todo', laterAt: now })
  }
  const shared = title?.trim() && !/^https?:\/\//i.test(title.trim()) ? title.trim().slice(0, 200) : ''
  const entry = save({
    id: newId(), kind: 'link', format: 'link', path: '', url: u.href, savedUrl: u.href, title: shared || u.host.replace(/^www\./, ''),
    ...(shared ? {} : { autoTitle: true }), siteName: u.host.replace(/^www\./, ''), excerpt: '', createdAt: now, seen: true,
    tags: [], from: 'you', later: 'todo', laterAt: now, readingAt: now,
  })
  readInBackground(entry.id, fetchImpl)
  return entry
}

async function readInBackground(id, fetchImpl) {
  try {
    await refreshLink(id, fetchImpl)
  } catch (e) {
    try {
      const { readingAt, ...entry } = getShown(id)
      save({ ...entry, readError: e?.message || 'Could not read it' })
    } catch {
      // removed meanwhile
    }
  }
}

/** Two files side by side, the first as "before". */
export function addCompare({ left, right, title, note, from }) {
  const files = [left, right].map(p => {
    const file = path.resolve(String(p || '').trim().replace(/^"(.*)"$/, '$1'))
    if (!p || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new UserError(`No file at ${file}`)
    if (!looksLikeText(file)) throw new UserError(`${path.basename(file)} isn't text, so it can't be compared line by line`)
    return file
  })
  const id = newId()
  return save({
    id, kind: 'compare', format: 'compare', path: files[0], path2: files[1],
    title: title?.trim() || `${path.basename(files[0])} → ${path.basename(files[1])}`,
    createdAt: new Date().toISOString(), seen: false, tags: [],
    ...(note ? { note: note.slice(0, 300) } : {}), ...(from ? { from } : {}),
  })
}

export function cleanTags(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(t => String(t).trim().toLowerCase().replace(/^#/, '')).filter(t => /^[\p{L}\p{N}_-]{1,30}$/u.test(t)))].slice(0, 12)
}
const ID_RE = /^[a-z0-9]{6,12}-[0-9a-f]{16}$/
const MAX_CONTENT = 5 * 1024 * 1024
const MAX_TEXT_READ = 8 * 1024 * 1024

export function shownDir() {
  return path.join(DATA_DIR, 'shown')
}

export function contentDir() {
  return path.join(shownDir(), 'content')
}

export function newId(now = Date.now()) {
  return `${now.toString(36)}-${crypto.randomBytes(8).toString('hex')}`
}

function firstHeading(text) {
  const m = /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/m.exec(text.slice(0, 4000))
  return m ? m[1].trim() : ''
}

/**
 * Adds an entry: either a file by absolute path, or content to keep.
 * @param {{path?: string, content?: string, format?: string, language?: string, title?: string, note?: string, from?: string}} input
 */
export function addShown(input) {
  const hasPath = typeof input.path === 'string' && input.path.trim() !== ''
  const hasContent = typeof input.content === 'string' && input.content !== ''
  if (hasPath === hasContent) throw new UserError('Give either a path or content, not both and not neither')
  const id = newId()
  const createdAt = new Date().toISOString()
  /** @type {any} */
  let entry
  if (hasPath) {
    const file = path.resolve(input.path.trim().replace(/^"(.*)"$/, '$1'))
    // The same file shown again is the same item (brought back if it was removed), not a second copy.
    const again = listShown({ includeHidden: true }).find(e => e.kind === 'file' && e.path.toLowerCase() === file.toLowerCase())
    if (again && fs.existsSync(file)) {
      const kind = detect(file)
      return save({ ...again, format: kind.format, language: again.language || kind.language, hidden: false, seen: false, shownAt: createdAt, ...(input.from ? { from: input.from.trim().slice(0, 120) } : {}), ...(input.note?.trim() ? { note: input.note.trim().slice(0, 300) } : {}) })
    }
    let st
    try {
      st = fs.statSync(file)
    } catch {
      throw new UserError(`No file at ${file}`)
    }
    if (!st.isFile()) throw new UserError(`${file} is a folder, not a file`)
    const kind = detect(file)
    entry = { id, kind: 'file', path: file, format: kind.format, language: input.language || kind.language, title: input.title?.trim() || path.basename(file), excerpt: fileExcerpt(file, kind.format) }
  } else {
    if (Buffer.byteLength(input.content) > MAX_CONTENT) throw new UserError('Content is over 5 MB; write it to a file and show the path')
    const format = input.format && FORMATS.includes(input.format) ? input.format : 'markdown'
    const file = path.join(contentDir(), `${id}.${CONTENT_EXT[format] || 'txt'}`)
    writeFileAtomic(file, input.content)
    const title = input.title?.trim() || (format === 'markdown' ? firstHeading(input.content) : '') || 'Untitled'
    entry = { id, kind: 'content', path: file, format, language: input.language, title, excerpt: excerptOf(input.content) }
  }
  if (input.note?.trim()) entry.note = input.note.trim().slice(0, 300)
  if (input.from?.trim()) entry.from = input.from.trim().slice(0, 120)
  entry.createdAt = createdAt
  entry.shownAt = createdAt
  entry.seen = false
  entry.tags = cleanTags(input.tags)
  return save(entry)
}

export function validId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

export function getShown(id) {
  if (!validId(id)) throw new UserError('Not a shown item', 404)
  try {
    return JSON.parse(fs.readFileSync(path.join(shownDir(), `${id}.json`), 'utf8'))
  } catch {
    throw new UserError('That item is gone', 404)
  }
}

export function listShown({ includeHidden = false } = {}) {
  let names = []
  try {
    names = fs.readdirSync(shownDir()).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const n of names) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(shownDir(), n), 'utf8'))
      if (!validId(e.id) || (e.hidden && !includeHidden)) continue
      out.push(e)
    } catch {
      // a half-written or broken entry: skip it
    }
  }
  out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

export function updateShown(id, patch) {
  const entry = getShown(id)
  for (const k of ['seen', 'pinned', 'hidden']) if (typeof patch[k] === 'boolean') entry[k] = patch[k]
  if (typeof patch.title === 'string' && patch.title.trim()) {
    entry.title = patch.title.trim().slice(0, 200)
    delete entry.autoTitle // named by hand: reading the page later keeps this name
  }
  if (Array.isArray(patch.tags)) entry.tags = cleanTags(patch.tags)
  // a note kept on Later is edited in place: its first line is its name
  if (typeof patch.text === 'string') {
    if (entry.kind !== 'content' || !entry.later) throw new UserError('Only notes kept on Later can be edited here')
    const text = patch.text.trim()
    if (!text) throw new UserError('A note needs some words; take it off the list instead')
    if (Buffer.byteLength(text) > MAX_CONTENT) throw new UserError('That note is over 5 MB')
    writeFileAtomic(entry.path, text)
    const first = text.split('\n')[0].trim()
    entry.title = first.length > 80 ? `${first.slice(0, 77)}…` : first
    entry.excerpt = excerptOf(text)
  }
  if (patch.later === null) {
    delete entry.later
    delete entry.doneAt
  } else if (LATER_STATES.includes(patch.later)) {
    if (!entry.later) entry.laterAt = new Date().toISOString()
    entry.later = patch.later
    if (patch.later === 'done') entry.doneAt = new Date().toISOString()
    else delete entry.doneAt
  }
  return save(entry)
}

/** Reads a link again (it failed before, or the page changed). */
export async function refreshLink(id, fetchImpl) {
  const entry = getShown(id)
  if (entry.kind !== 'link') throw new UserError('Only links can be read again')
  const a = await readArticle(entry.url, fetchImpl)
  const file = path.join(contentDir(), `${id}.html`)
  writeFileAtomic(file, a.html)
  // read again from disk: the entry may have changed (moved to Done, renamed) while the page was loading
  const { readError, readingAt, autoTitle, ...rest } = getShown(id)
  const title = autoTitle ? a.title || rest.title : rest.title || a.title
  return save({ ...rest, format: 'article', path: file, url: a.url, title, siteName: a.siteName, byline: a.byline, excerpt: a.excerpt, image: a.image, words: a.words })
}

export function fileState(file) {
  try {
    const st = fs.statSync(file)
    return { exists: true, size: st.size, mtime: st.mtimeMs }
  } catch {
    return { exists: false, size: 0, mtime: 0 }
  }
}

/** The entry with its text, for the formats the viewer renders from text. */
function readText(file, size) {
  const fd = fs.openSync(file, 'r')
  try {
    const len = Math.min(size, MAX_TEXT_READ)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, 0)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

export function readShown(id) {
  const entry = getShown(id)
  if (entry.format === 'link') return { entry, exists: true, size: 0, mtime: 0 }
  const state = fileState(entry.path)
  const out = { entry, ...state }
  if (state.exists && TEXT_FORMATS.has(entry.format)) {
    out.text = readText(entry.path, state.size)
    out.truncated = state.size > MAX_TEXT_READ
  }
  if (entry.kind === 'compare') {
    const right = fileState(entry.path2)
    out.exists = state.exists && right.exists
    out.mtime = Math.max(state.mtime, right.mtime)
    if (right.exists) out.text2 = readText(entry.path2, right.size)
  }
  return out
}

/** mtime for live refresh: the newer of a comparison's two files. */
export function entryState(entry) {
  if (entry.format === 'link') return { exists: true, size: 0, mtime: 0 }
  const a = fileState(entry.path)
  if (entry.kind !== 'compare') return a
  const b = fileState(entry.path2)
  return { exists: a.exists && b.exists, size: a.size + b.size, mtime: Math.max(a.mtime, b.mtime) }
}

/**
 * The file a request under /api/shown/<id>/files/<rel> means: the entry's own file when rel is empty or its
 * name, else a file next to it (for images in markdown, scripts and styles of an HTML report). Never outside
 * the entry's folder.
 */
export function resolveShownFile(entry, rel) {
  if (!entry.path) throw new UserError('This item has no file', 404)
  const clean = decodeURIComponent(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean === path.basename(entry.path)) return entry.path
  const dir = path.dirname(entry.path)
  const target = path.resolve(dir, clean)
  if (!within(dir, target) || target === dir) throw new UserError('Outside the shown file\'s folder', 403)
  return target
}
