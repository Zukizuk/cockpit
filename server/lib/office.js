// Light previews of Office files, so most of them can be read without opening Word, Excel or PowerPoint:
// Word as HTML (mammoth), spreadsheets as tables (SheetJS, first rows only), PowerPoint as each slide's text (the
// slide XML read with JSZip). Anything heavier opens in its own program.
import fs from 'node:fs'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { UserError } from './config.js'

const MAX_BYTES = 60 * 1024 * 1024
const MAX_ROWS = 500
const MAX_COLS = 60

function checkSize(file) {
  const size = fs.statSync(file).size
  if (size > MAX_BYTES) throw new UserError('This file is too large to preview here. Open it in its own program.', 413)
}

export async function docxToHtml(file) {
  checkSize(file)
  const r = await mammoth.convertToHtml({ path: file })
  return r.value
}

export function readSheets(file) {
  checkSize(file)
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', sheetRows: MAX_ROWS + 1, cellDates: true, dense: true })
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false })
    const full = ws['!fullref'] || ws['!ref']
    let total = rows.length
    try {
      if (full) total = XLSX.utils.decode_range(full).e.r + 1
    } catch {
      // keep the counted rows
    }
    const clipped = rows.slice(0, MAX_ROWS).map(r => r.slice(0, MAX_COLS).map(v => String(v ?? '')))
    return { name, rows: clipped, total, cols: clipped.reduce((m, r) => Math.max(m, r.length), 0) }
  })
}

const decode = s =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')

export async function pptxSlides(file) {
  checkSize(file)
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const num = n => Number(/slide(\d+)\.xml$/.exec(n)?.[1] || 0)
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b))
  const slides = []
  for (const n of names) {
    const xml = await zip.file(n).async('string')
    const lines = xml
      .split(/<\/a:p>/)
      .map(p => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decode(m[1])).join(''))
      .map(t => t.trim())
      .filter(Boolean)
    slides.push({ n: num(n), lines })
  }
  return slides
}

/** The preview for an Office entry, merged into what /api/shown/<id> returns. */
export async function readOffice(entry) {
  try {
    if (entry.format === 'docx') return { html: await docxToHtml(entry.path) }
    if (entry.format === 'sheet') return { sheets: readSheets(entry.path) }
    if (entry.format === 'slides') return { slides: await pptxSlides(entry.path) }
  } catch (e) {
    return { previewError: e instanceof UserError ? e.message : `Couldn't preview this file (${e?.message || e}). Open it in its own program.` }
  }
  return {}
}
