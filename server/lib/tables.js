// The Table extra: a small grid on the board, kept as a .csv file in the notes folder's tables/ (so it opens in Excel
// and stays the person's). The first row is the header. Its title is the file's name.
import fs from 'node:fs'
import path from 'node:path'
import { UserError, writeFileAtomic } from './config.js'
import { notesRoot, resolveNote } from './notes.js'

export const MAX_ROWS = 500
export const MAX_COLS = 30
const MAX_CELL = 2000

/** A table's file from its path relative to the notes folder (a .csv under tables/). */
export function resolveTable(cfg, rel) {
  const abs = resolveNote(cfg, rel, { anyExt: true })
  if (path.extname(abs).toLowerCase() !== '.csv') throw new UserError('Tables are .csv files')
  return abs
}

/** RFC 4180 CSV (as Excel writes it): quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === ',') (row.push(cell), (cell = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row))
  return rows
}

const field = v => {
  const t = String(v ?? '')
  return /[",\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
export const toCsv = rows => rows.map(r => r.map(field).join(',')).join('\r\n') + '\r\n'

/** Rows made even (every row as wide as the widest), within the limits, as strings. */
export function tidyRows(rows) {
  if (!Array.isArray(rows)) throw new UserError('No rows')
  const clean = rows.slice(0, MAX_ROWS).map(r => (Array.isArray(r) ? r : [r]).slice(0, MAX_COLS).map(v => String(v ?? '').slice(0, MAX_CELL)))
  const width = Math.max(1, ...clean.map(r => r.length))
  return clean.map(r => [...r, ...Array(width - r.length).fill('')])
}

const titleOf = rel => path.basename(rel).replace(/\.csv$/i, '')
const safeName = t =>
  String(t || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80) || 'Table'

function freePath(cfg, title, except) {
  const root = notesRoot(cfg)
  fs.mkdirSync(path.join(root, 'tables'), { recursive: true })
  const base = safeName(title)
  for (let i = 1; ; i++) {
    const rel = `tables/${i === 1 ? base : `${base} ${i}`}.csv`
    if (rel === except || !fs.existsSync(path.join(root, rel))) return rel
  }
}

export function readTable(cfg, rel) {
  const abs = resolveTable(cfg, rel)
  let text
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    throw new UserError('That table is gone (its file was moved or deleted)', 404)
  }
  return { path: rel, title: titleOf(rel), rows: tidyRows(parseCsv(text)), mtime: fs.statSync(abs).mtimeMs }
}

/** Saves the rows; with baseMtime, refuses when the file changed since (someone else wrote it). */
export function writeTable(cfg, rel, rows, baseMtime) {
  const abs = resolveTable(cfg, rel)
  if (baseMtime && fs.existsSync(abs) && Math.abs(fs.statSync(abs).mtimeMs - baseMtime) > 1) throw new UserError('Changed elsewhere: reload it first', 409)
  // a BOM, so Excel reads it as UTF-8
  writeFileAtomic(abs, '﻿' + toCsv(tidyRows(rows)))
  return { path: rel, title: titleOf(rel), mtime: fs.statSync(abs).mtimeMs }
}

const START = [['Name', 'Notes'], ['', ''], ['', '']]

/** A new table: a header row and a couple of empty rows unless rows are given. */
export function newTable(cfg, title, rows) {
  const rel = freePath(cfg, title || 'Table')
  const start = Array.isArray(rows) && rows.length ? rows : START
  writeTable(cfg, rel, start)
  return readTable(cfg, rel)
}

/** Never typed in: as it was made (or every cell empty). */
const untouched = rows => rows.every((r, i) => r.every((c, j) => !c.trim() || (i === 0 && START[0][j] === c)))

/**
 * A table taken off the board without anything typed in it is just a blank file: it goes, so blank tables don't
 * pile up (and the next new one is "Table" again). Anything with writing in it is kept.
 */
export function discardEmpty(cfg, rel) {
  const abs = resolveTable(cfg, rel)
  if (!fs.existsSync(abs)) return { discarded: false }
  if (!untouched(parseCsv(fs.readFileSync(abs, 'utf8')))) throw new UserError('That table has something in it, so it was kept', 409)
  fs.unlinkSync(abs)
  return { discarded: true }
}

/** The tables kept (newest first), to find one again and put it back on the board. */
export function listTables(cfg) {
  const dir = path.join(notesRoot(cfg), 'tables')
  let names = []
  try {
    names = fs.readdirSync(dir).filter(n => /\.csv$/i.test(n) && !n.startsWith('.'))
  } catch {
    return []
  }
  return names
    .map(n => {
      const rel = `tables/${n}`
      try {
        const st = fs.statSync(path.join(dir, n))
        const rows = parseCsv(fs.readFileSync(path.join(dir, n), 'utf8'))
        return { path: rel, title: titleOf(rel), mtime: st.mtimeMs, rows: Math.max(0, rows.length - 1), columns: rows[0] || [] }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
}

/** Deleting a table moves its file to the notes folder's .archive (as notes are archived): nothing is lost. */
export function archiveTable(cfg, rel) {
  const abs = resolveTable(cfg, rel)
  if (!fs.existsSync(abs)) throw new UserError('That table is gone', 404)
  const root = notesRoot(cfg)
  let target = path.join(root, '.archive', rel)
  if (fs.existsSync(target)) target = target.replace(/(\.csv)$/i, `-${Date.now()}$1`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(abs, target)
  return { archivedTo: path.relative(root, target).split(path.sep).join('/') }
}

/** Gives a table another name (its file is renamed); returns its new path. */
export function renameTable(cfg, rel, title) {
  const abs = resolveTable(cfg, rel)
  const next = freePath(cfg, title, rel)
  if (next === rel) return readTable(cfg, rel)
  fs.renameSync(abs, resolveTable(cfg, next))
  return readTable(cfg, next)
}
