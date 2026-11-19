// Notes, journal and drafts: plain markdown in one folder (~/notes by default), so agents can read them too.
// journal/ is the journal (synced with Kokoro, see journal-sync.js; thoughts go there too); drafts/ holds drafts;
// stickies/ holds the board's sticky notes; anything else is a note, kept here only.
// Nothing is deleted: "archive" moves a note into .archive/. The one exception is a sticky note left empty, which
// is just a file with nothing in it.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, within, writeFileAtomic } from './config.js'

const NOTE_EXT = new Set(['.md', '.markdown', '.txt'])
const MAX_DEPTH = 5

export function notesRoot(cfg) {
  return path.resolve(cfg.notesDir)
}

export function ensureNotes(cfg) {
  const root = notesRoot(cfg)
  for (const d of ['', 'journal', 'drafts']) fs.mkdirSync(path.join(root, d), { recursive: true })
  return root
}

/** Absolute path of a note from its path relative to the notes folder; refuses anything outside it or hidden. */
export function resolveNote(cfg, rel, { anyExt = false } = {}) {
  if (typeof rel !== 'string' || !rel.trim()) throw new UserError('No note path')
  const clean = rel.replace(/\\/g, '/').trim()
  if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) throw new UserError('Note paths are relative to the notes folder')
  const segs = clean.split('/')
  if (segs.some(s => s === '' || s === '.' || s === '..' || s.startsWith('.'))) throw new UserError('Not a note path')
  const root = notesRoot(cfg)
  const abs = path.resolve(root, clean)
  if (!within(root, abs) || abs === root) throw new UserError('Outside the notes folder', 403)
  if (!anyExt && !NOTE_EXT.has(path.extname(abs).toLowerCase())) throw new UserError('Notes are .md or .txt files')
  return abs
}

function titleOf(file) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(2048)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      const text = buf.subarray(0, n).toString('utf8')
      const m = /^\s{0,3}#{1,3}\s+(.+?)\s*$/m.exec(text)
      if (m) return m[1].trim()
      const first = firstLine(text)
      if (first) return first
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    // fall back to the name
  }
  return path.basename(file).replace(/\.(md|markdown|txt)$/i, '')
}

/** A note with no heading (a sticky note) is called by its first line of words. */
export function firstLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '').trim())
    .find(l => l && !/^[-=*_#`~\s]+$/.test(l))
  if (!line) return ''
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

function excerptOfNote(file) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(1500)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      return buf
        .subarray(0, n)
        .toString('utf8')
        .replace(/^\s{0,3}#{1,3}\s+.*$/m, '')
        .replace(/[#>*_`|[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

/** Titles given to notes by hand, kept beside them (not in the file, which stays plain text): { path: title }. */
const titlesFile = () => path.join(DATA_DIR, 'note-titles.json')

export function readTitles() {
  try {
    const all = JSON.parse(fs.readFileSync(titlesFile(), 'utf8'))
    return all && typeof all === 'object' ? all : {}
  } catch {
    return {}
  }
}

/** Gives a note a title, changes it, or (empty) takes it away. */
export function setTitle(cfg, rel, title) {
  resolveNote(cfg, rel)
  const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const all = readTitles()
  if (t) all[rel] = t
  else delete all[rel]
  writeFileAtomic(titlesFile(), JSON.stringify(all, null, 2) + '\n')
  return { path: rel, title: t }
}

export function listNotes(cfg) {
  const root = notesRoot(cfg)
  const given = readTitles()
  const out = []
  const walk = (dir, depth) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(abs, depth + 1)
      } else if (e.isFile() && NOTE_EXT.has(path.extname(e.name).toLowerCase())) {
        const st = fs.statSync(abs)
        const rel = path.relative(root, abs).split(path.sep).join('/')
        const top = rel.includes('/') ? rel.split('/')[0] : ''
        out.push({ path: rel, name: e.name, folder: top, title: given[rel] || titleOf(abs), given: given[rel] || '', mtime: st.mtimeMs, size: st.size, excerpt: excerptOfNote(abs) })
      }
    }
  }
  walk(root, 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

export function readNote(cfg, rel) {
  const abs = resolveNote(cfg, rel)
  try {
    const st = fs.statSync(abs)
    return { path: rel, text: fs.readFileSync(abs, 'utf8'), mtime: st.mtimeMs }
  } catch {
    throw new UserError('That note is gone', 404)
  }
}

/**
 * Saves a note. With baseMtime (the mtime the editor loaded), refuses to overwrite a file that changed on disk
 * since, and returns the disk copy so the editor can offer Reload or Overwrite.
 */
export function writeNote(cfg, rel, text, baseMtime) {
  if (typeof text !== 'string') throw new UserError('No text')
  const abs = resolveNote(cfg, rel)
  if (baseMtime != null && fs.existsSync(abs)) {
    const st = fs.statSync(abs)
    if (Math.abs(st.mtimeMs - Number(baseMtime)) > 2) {
      return { conflict: true, path: rel, text: fs.readFileSync(abs, 'utf8'), mtime: st.mtimeMs }
    }
  }
  writeFileAtomic(abs, text)
  return { path: rel, mtime: fs.statSync(abs).mtimeMs }
}

const pad = n => String(n).padStart(2, '0')
const dayStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function slug(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

function unique(cfg, rel) {
  let candidate = rel
  for (let i = 2; fs.existsSync(resolveNote(cfg, candidate)); i++) candidate = rel.replace(/(\.\w+)$/, `-${i}$1`)
  return candidate
}

export function journalPath(now = new Date()) {
  return `journal/${dayStamp(now)}.md`
}

/**
 * Creates today's journal page (or returns it), a draft, a note, or a sticky note (no heading: it's called by its
 * first line, and may start with some text). Returns its relative path.
 */
export function newNote(cfg, kind, title, now = new Date(), text = '') {
  ensureNotes(cfg)
  if (kind === 'sticky') {
    const rel = unique(cfg, `stickies/${dayStamp(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`)
    writeFileAtomic(resolveNote(cfg, rel), String(text || '').slice(0, 200_000))
    return rel
  }
  if (kind === 'journal') {
    const rel = journalPath(now)
    const abs = resolveNote(cfg, rel)
    if (!fs.existsSync(abs)) {
      const heading = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      writeFileAtomic(abs, `# ${heading}\n\n`)
    }
    return rel
  }
  const name = slug(title)
  const rel = kind === 'draft'
    ? unique(cfg, `drafts/${dayStamp(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${name ? `-${name}` : ''}.md`)
    : unique(cfg, `${name || 'note'}.md`)
  writeFileAtomic(resolveNote(cfg, rel), `# ${title?.trim() || (kind === 'draft' ? 'Draft' : 'Note')}\n\n`)
  return rel
}

/** Adds a timestamped line to today's journal, creating the page if needed. */
export function appendJournal(cfg, text, now = new Date()) {
  const line = String(text || '').trim()
  if (!line) throw new UserError('Nothing to add')
  const rel = newNote(cfg, 'journal', '', now)
  const abs = resolveNote(cfg, rel)
  const body = fs.readFileSync(abs, 'utf8')
  const sep = body.endsWith('\n') ? '' : '\n'
  const entry = line.includes('\n') ? `\n**${pad(now.getHours())}:${pad(now.getMinutes())}**\n\n${line}\n` : `- ${pad(now.getHours())}:${pad(now.getMinutes())} ${line}\n`
  fs.appendFileSync(abs, sep + entry)
  return { path: rel, mtime: fs.statSync(abs).mtimeMs }
}

/**
 * Deletes a sticky note that has nothing in it (one made and left empty), so the folder doesn't fill with blank
 * files. Anything with writing in it is refused: that gets archived instead.
 */
export function discardEmpty(cfg, rel) {
  const abs = resolveNote(cfg, rel)
  if (!String(rel).replace(/\\/g, '/').startsWith('stickies/')) throw new UserError('Only sticky notes are discarded', 400)
  if (!fs.existsSync(abs)) return { discarded: false }
  if (fs.readFileSync(abs, 'utf8').trim()) throw new UserError('That sticky note has writing in it, so it was kept', 409)
  fs.unlinkSync(abs)
  return { discarded: true }
}

/** Moves a note into .archive/ (kept, out of the list). */
export function archiveNote(cfg, rel) {
  const abs = resolveNote(cfg, rel)
  if (!fs.existsSync(abs)) throw new UserError('That note is gone', 404)
  const root = notesRoot(cfg)
  let target = path.join(root, '.archive', rel)
  if (fs.existsSync(target)) target = target.replace(/(\.\w+)$/, `-${Date.now()}$1`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(abs, target)
  return { archivedTo: path.relative(root, target).split(path.sep).join('/') }
}
