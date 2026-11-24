// Previews of Office files (Word, Excel, PowerPoint), made once and kept.
//
// Reading one can take seconds (a 12 MB workbook with 28 sheets takes about 10), so:
//   - it runs in a worker thread (office-worker.js): the server keeps answering everything else meanwhile
//   - what it makes is kept in ~/.cockpit/cache/office, under the file's path, size and time: opening it again,
//     even after a restart, reads that instead (a changed file is read again)
//   - a workbook's sheets are kept one per file and sent one at a time: the list of sheets and the open one
// Two requests for the same file while it's being read share the one read.
import { appPath } from './app-root.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { checkSize } from './office-parse.js'

/** Bump when what's kept changes shape, so old previews are made again. */
const CACHE_FORMAT = 2
const KEEP = 300
const cacheRoot = () => path.join(DATA_DIR, 'cache', 'office')
const reading = new Map()

function keyOf(entry) {
  const st = fs.statSync(entry.path)
  return crypto.createHash('sha1').update(`${CACHE_FORMAT}|${entry.format}|${path.resolve(entry.path)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 24)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function inWorker(format, file) {
  return new Promise((resolve, reject) => {
    const w = new Worker(appPath('server', 'lib', 'office-worker.js'), { workerData: { format, file } })
    w.once('message', m => (m.error ? reject(m.user ? new UserError(m.error, 413) : new Error(m.error)) : resolve(m)))
    w.once('error', reject)
    w.once('exit', code => code && reject(new Error(`the reader stopped (${code})`)))
  })
}

/** Keeps the newest previews only. */
function prune() {
  try {
    const dirs = fs.readdirSync(cacheRoot()).map(d => ({ d, t: fs.statSync(path.join(cacheRoot(), d)).mtimeMs }))
    if (dirs.length <= KEEP) return
    dirs.sort((a, b) => a.t - b.t)
    for (const { d } of dirs.slice(0, dirs.length - KEEP)) fs.rmSync(path.join(cacheRoot(), d), { recursive: true, force: true })
  } catch {
    // only a cache
  }
}

/** Reads the file (in the worker) and keeps the result: a workbook as an index plus one file per sheet. */
async function make(entry, dir) {
  checkSize(entry.path)
  const out = await inWorker(entry.format, entry.path)
  fs.mkdirSync(dir, { recursive: true })
  if (out.sheets) {
    out.sheets.forEach((s, i) => writeFileAtomic(path.join(dir, `sheet-${i}.json`), JSON.stringify(s.rows)))
    writeFileAtomic(path.join(dir, 'index.json'), JSON.stringify({ sheets: out.sheets.map(({ rows, ...s }) => s) }))
  } else {
    writeFileAtomic(path.join(dir, 'index.json'), JSON.stringify(out))
  }
  prune()
}

/**
 * The preview for an Office entry, merged into what /api/shown/<id> returns. For a workbook: every sheet's name,
 * size and column count, with the rows of one sheet (`sheet`, the first by default).
 */
export async function readOffice(entry, { sheet = 0 } = {}) {
  try {
    const key = keyOf(entry)
    const dir = path.join(cacheRoot(), key)
    if (!readJson(path.join(dir, 'index.json'))) {
      if (!reading.has(key)) reading.set(key, make(entry, dir).finally(() => reading.delete(key)))
      await reading.get(key)
    }
    const index = readJson(path.join(dir, 'index.json'))
    if (!index) throw new Error('the preview went missing')
    if (!index.sheets) return index
    const at = Math.min(Math.max(0, Number(sheet) || 0), Math.max(0, index.sheets.length - 1))
    const rows = readJson(path.join(dir, `sheet-${at}.json`)) || []
    return { sheets: index.sheets.map((s, i) => (i === at ? { ...s, rows } : s)), sheet: at }
  } catch (e) {
    return { previewError: e instanceof UserError ? e.message : `Couldn't preview this file (${e?.message || e}). Open it in its own program.` }
  }
}
