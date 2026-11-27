// A folder on the board: what's in it, one level at a time (the card opens subfolders as you expand them).
import fs from 'node:fs'
import path from 'node:path'
import { UserError } from './config.js'
import { formatByExt } from './files.js'

const MAX = 2000
// Windows' and Office's own clutter, never something you put there
const NOISE = /^(desktop\.ini|thumbs\.db|\.ds_store|~\$.*|~wrl.*\.tmp)$/i

export function folderPath(p) {
  const dir = String(p || '').trim().replace(/^"(.*)"$/, '$1')
  if (!dir || !path.isAbsolute(dir)) throw new UserError('A folder needs its full path')
  let st
  try {
    st = fs.statSync(dir)
  } catch {
    throw new UserError('That folder is no longer there', 404)
  }
  if (!st.isDirectory()) throw new UserError('That is a file, not a folder')
  return path.resolve(dir)
}

export const isFolder = p => {
  try {
    return path.isAbsolute(String(p)) && fs.statSync(String(p)).isDirectory()
  } catch {
    return false
  }
}

/** Folders first, then files, each by name; hidden and system clutter left out. */
export function listFolder(p) {
  const dir = folderPath(p)
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    throw new UserError(e?.code === 'EPERM' || e?.code === 'EACCES' ? (process.platform === 'darwin' ? "macOS doesn't let Cockpit read that folder (System Settings → Privacy & Security)" : "Windows doesn't let Cockpit read that folder") : "Couldn't read that folder")
  }
  const out = []
  for (const e of entries) {
    if (NOISE.test(e.name) || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    let st = null
    try {
      st = fs.statSync(full)
    } catch {
      continue // a broken link, or a cloud file Windows won't describe
    }
    const isDir = st.isDirectory()
    out.push({ name: e.name, path: full, dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtimeMs, format: isDir ? '' : formatByExt(full) })
  }
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  out.sort((a, b) => Number(b.dir) - Number(a.dir) || coll.compare(a.name, b.name))
  return { path: dir, name: path.basename(dir) || dir, entries: out.slice(0, MAX), more: Math.max(0, out.length - MAX) }
}
