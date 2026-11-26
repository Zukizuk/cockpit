// Draws one item, whatever it is, in a card on the board or full screen: articles, markdown, code, tables,
// Word, Excel, PowerPoint, images, PDF, HTML, media. What can't be drawn gets a big "open it in its own program".
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  AppWindow, FileCode2, FileSpreadsheet, FileText, FileType2, Film, Globe, Image as ImageIcon, NotebookText, Presentation, SquareSplitHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { get, post, type ShownEntry, type ShownRead } from '../api'
import { CompareView } from './Compare'
import { Markdown, highlightIn } from './Markdown'
import { CodeView, CsvView, DiffView, JsonView } from './Views'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const basename = (p: string) => p.split(/[\\/]/).pop() || p

/** A path as you'd say it: the home folder as ~ (C:\Users\me\projects\x becomes ~\projects\x). */
export const tidyPath = (p: string) => p.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~')

/** The folder a file is in, tidied: what a card's subtitle shows. */
export const folderOf = (p: string) => tidyPath(p.replace(/[\\/][^\\/]*$/, ''))

/** Where a file or folder is, in a few words: the two folders it's in ("Coupa › Savings Tracker"), not the whole path. */
export function placeOf(p: string) {
  const parts = tidyPath(p).split(/[\\/]/).filter(Boolean)
  parts.pop()
  return parts
    .slice(-2)
    .map(x => (x === '~' ? 'Home' : x))
    .join(' › ')
}

export function kindLabel(e: ShownEntry) {
  if (e.format === 'article' || e.format === 'link') return 'Article'
  if (e.kind === 'compare') return 'Compare'
  if (e.kind === 'content') return 'Write-up'
  const labels: Record<string, string> = {
    markdown: 'Document', code: 'Code', csv: 'Table', json: 'JSON', image: 'Image', pdf: 'PDF', html: 'Web page', diff: 'Diff',
    video: 'Video', audio: 'Audio', docx: 'Word', sheet: 'Excel', slides: 'PowerPoint', text: 'Text',
  }
  return labels[e.format] || 'File'
}

export function iconFor(e: Pick<ShownEntry, 'format' | 'kind'>): LucideIcon {
  if (e.kind === 'link' || e.format === 'article' || e.format === 'html') return Globe
  if (e.kind === 'compare') return SquareSplitHorizontal
  const map: Record<string, LucideIcon> = {
    markdown: NotebookText, code: FileCode2, json: FileCode2, diff: FileCode2, csv: FileSpreadsheet, sheet: FileSpreadsheet,
    docx: FileType2, slides: Presentation, image: ImageIcon, video: Film, audio: Film, pdf: FileText, text: FileText,
  }
  return map[e.format] || FileText
}

/** Where a relative path inside a file points, as an absolute path next to it. */
function joinPath(file: string, rel: string) {
  const sep = file.includes('\\') ? '\\' : '/'
  const cut = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return file.slice(0, cut) + sep + rel.replace(/[\\/]/g, sep)
}

function SafeHtml({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const clean = useMemo(() => DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button'] }), [html])
  useEffect(() => {
    if (ref.current) highlightIn(ref.current)
  }, [clean])
  return <article ref={ref} className={cn('md', className)} dangerouslySetInnerHTML={{ __html: clean }} />
}

/** Rows drawn at first; the rest of a sheet's first 500 on request (a wide sheet is thousands of cells). */
const FIRST_ROWS = 150

/** A workbook: one sheet at a time. Only the open sheet's rows come with the item; another loads when picked. */
function SheetView({ read }: { read: ShownRead }) {
  const [sheets, setSheets] = useState(read.sheets || [])
  const [at, setAt] = useState(read.sheet ?? 0)
  const [all, setAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const shownId = useRef(read.entry.id)
  // The card reads the file again whenever it looks changed (Excel's AutoSave, or a synced OneDrive folder, touch it
  // every few seconds). The same workbook keeps the sheet that's open and the rows already drawn, so nothing empties
  // and the scroll stays where it was; the fresh rows replace them quietly when they come (below).
  const stale = useRef(new Set<number>())
  useEffect(() => {
    const same = shownId.current === read.entry.id
    shownId.current = read.entry.id
    if (!same) {
      stale.current.clear()
      setSheets(read.sheets || [])
      setAt(read.sheet ?? 0)
      return
    }
    setSheets(prev =>
      (read.sheets || []).map((s, j) => {
        if (s.rows) return s
        const before = prev.find(x => x.name === s.name)?.rows
        if (before) stale.current.add(j)
        return before ? { ...s, rows: before } : s
      }),
    )
  }, [read])
  const open = Math.min(at, Math.max(0, sheets.length - 1))
  const missing = !!sheets[open] && !sheets[open].rows
  // the open sheet's rows, read again after the file changed: swapped in when they come, the old ones shown meanwhile
  useEffect(() => {
    if (!stale.current.has(open)) return
    stale.current.delete(open)
    const id = read.entry.id
    get<ShownRead>(`/api/shown/${id}?sheet=${open}`)
      .then(r => {
        const rows = r.sheets?.[open]?.rows
        if (rows && shownId.current === id) setSheets(ss => ss.map((s, j) => (j === open ? { ...s, rows } : s)))
      })
      .catch(() => {})
  }, [sheets, open, read.entry.id])
  useEffect(() => {
    if (!missing) return
    let live = true
    setLoading(true)
    get<ShownRead>(`/api/shown/${read.entry.id}?sheet=${open}`)
      .then(r => live && setSheets(ss => ss.map((s, j) => (j === open ? { ...s, rows: r.sheets?.[open]?.rows || [] } : s))))
      .catch(() => live && setSheets(ss => ss.map((s, j) => (j === open ? { ...s, rows: [] } : s))))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [missing, open, read.entry.id])
  // the rest of the workbook loads quietly once the open sheet is drawn, so switching sheets is instant
  const allLoaded = sheets.every(s => s.rows)
  useEffect(() => {
    if (missing || allLoaded) return
    let live = true
    const t = setTimeout(async () => {
      for (let i = 0; i < sheets.length && live; i++) {
        if (sheets[i].rows) continue
        try {
          const r = await get<ShownRead>(`/api/shown/${read.entry.id}?sheet=${i}`)
          if (live) setSheets(ss => ss.map((s, j) => (j === i && !s.rows ? { ...s, rows: r.sheets?.[i]?.rows || [] } : s)))
        } catch {
          return
        }
        await new Promise(res => setTimeout(res, 60))
      }
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, allLoaded, read.entry.id])
  // the tab shows as picked at once; the (possibly large) table follows without holding up the click
  const [picked, setPicked] = useState(at)
  useEffect(() => setPicked(at), [at])
  const pick = (i: number) => {
    setPicked(i)
    startTransition(() => {
      setAt(i)
      setAll(false)
    })
  }
  const sheet = sheets[open]
  const cells = useSheetCells(read.entry.path, sheet?.name || '')
  const loaded = sheet?.rows
  const drawn = useMemo(() => (all ? loaded || [] : (loaded || []).slice(0, FIRST_ROWS)), [loaded, all])
  if (!sheet) return <p className="text-muted-foreground">This workbook is empty.</p>
  const rows = sheet.rows || []
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => pick(i)}
              className={cn('h-7 rounded-md px-2.5 text-[13px] text-muted-foreground transition-[background-color,color] duration-150 hover:bg-ink/5 hover:text-foreground', i === picked && 'bg-ink/10 text-foreground')}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {cells.picked && (
        <div className="sheet-cellbar">
          <span className="sheet-cellbar-at">
            {colName(cells.picked[1])}
            {cells.picked[0] + 1}
          </span>
          <span className="sheet-cellbar-value">{drawn[cells.picked[0]]?.[cells.picked[1]] ?? ''}</span>
        </div>
      )}
      <div className="table-scroll min-h-0 flex-1" data-sheet={cells.scope}>
        <style>{cells.css}</style>
        {loading && !sheet.rows && <p className="p-2 text-[13px] text-muted-foreground">Opening {sheet.name}…</p>}
        <SheetTable rows={drawn} cols={sheet.cols} onPick={cells.pick} onResize={cells.resize} onFit={c => cells.fit(c, drawn)} />
      </div>
      {drawn.length < rows.length && (
        <button type="button" className="w-fit text-[12.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setAll(true)}>
          Show {(rows.length - drawn.length).toLocaleString()} more rows
        </button>
      )}
      {drawn.length === rows.length && sheet.total > rows.length && (
        <p className="text-[12.5px] text-muted-foreground">
          First {rows.length.toLocaleString()} of {sheet.total.toLocaleString()} rows. Open it in Excel for the rest.
        </p>
      )}
    </div>
  )
}

/** A column's letters, as Excel names them: A..Z, AA.. */
function colName(i: number) {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const WIDTHS_KEY = 'cockpit.sheet.widths'
const FIT_MAX = 1200
let measurer: CanvasRenderingContext2D | null = null

/**
 * A sheet's column widths (dragged or fitted; kept per file and sheet) and the cell picked to read in full. Both are
 * drawn by a style rule rather than on each cell, so a drag doesn't redraw thousands of cells.
 */
function useSheetCells(file: string, sheetName: string) {
  const key = `${file}|${sheetName}`
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [picked, setPicked] = useState<[number, number] | null>(null)
  useEffect(() => {
    setPicked(null)
    try {
      setWidths(JSON.parse(localStorage.getItem(WIDTHS_KEY) || '{}')[key] || {})
    } catch {
      setWidths({})
    }
  }, [key])
  const save = useCallback(
    (w: Record<number, number>) => {
      try {
        const all = JSON.parse(localStorage.getItem(WIDTHS_KEY) || '{}')
        all[key] = w
        localStorage.setItem(WIDTHS_KEY, JSON.stringify(all))
      } catch {}
    },
    [key],
  )
  const resize = useCallback(
    (c: number, w: number, done: boolean) =>
      setWidths(prev => {
        const next = { ...prev, [c]: Math.max(36, Math.round(w)) }
        if (done) save(next)
        return next
      }),
    [save],
  )
  const fit = useCallback(
    (c: number, rows: string[][]) => {
      measurer ||= document.createElement('canvas').getContext('2d')
      if (!measurer) return
      measurer.font = `12.5px ${getComputedStyle(document.body).fontFamily}`
      let w = measurer.measureText(colName(c)).width
      for (const r of rows) if (r[c]) w = Math.max(w, measurer.measureText(r[c]).width)
      resize(c, Math.min(FIT_MAX, w + 26), true)
    },
    [resize],
  )
  const pick = useCallback((r: number, c: number) => setPicked(p => (p && p[0] === r && p[1] === c ? null : [r, c])), [])
  const scope = useMemo(() => 's' + Math.random().toString(36).slice(2, 8), [])
  // nth-child counts the row-number column first
  const css =
    Object.entries(widths)
      .map(([c, w]) => `[data-sheet=${scope}] tr > :nth-child(${+c + 2}){width:${w}px;min-width:${w}px;max-width:${w}px}`)
      .join('') +
    (picked ? `[data-sheet=${scope}] tbody tr:nth-child(${picked[0] + 1}) > td:nth-child(${picked[1] + 2}){box-shadow:inset 0 0 0 2px var(--color-primary)}` : '')
  return { scope, css, picked, pick, resize, fit }
}

const NUM = /^-?[\d,. ]+%?$/
/**
 * One sheet's cells, drawn again only when the rows themselves change. Column letters on top: drag a column's edge to
 * widen it, double-click the edge to fit its longest value; click a cell to read all of it above the table.
 */
const SheetTable = memo(function SheetTable({
  rows,
  cols,
  onPick,
  onResize,
  onFit,
}: {
  rows: string[][]
  cols: number
  onPick: (r: number, c: number) => void
  onResize: (c: number, w: number, done: boolean) => void
  onFit: (c: number) => void
}) {
  const drag = (e: React.PointerEvent, c: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).parentElement!
    const x0 = e.clientX
    const w0 = th.getBoundingClientRect().width
    const move = (ev: PointerEvent) => onResize(c, w0 + ev.clientX - x0, false)
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('col-resizing')
      if (ev.clientX !== x0) onResize(c, w0 + ev.clientX - x0, true)
    }
    document.body.classList.add('col-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <table
      className="data sheet"
      onClick={e => {
        const td = (e.target as HTMLElement).closest('td')
        const tr = td?.parentElement as HTMLTableRowElement | undefined
        if (!td || !tr || td.cellIndex < 1 || tr.parentElement?.tagName !== 'TBODY') return
        if (window.getSelection()?.toString()) return
        onPick(tr.sectionRowIndex, td.cellIndex - 1)
      }}
    >
      <thead>
        <tr>
          <th className="rownum" />
          {Array.from({ length: cols }, (_, c) => (
            <th key={c} className="colhead">
              {colName(c)}
              <span className="col-grip" onPointerDown={e => drag(e, c)} onDoubleClick={() => onFit(c)} title="Drag to widen. Double-click to fit." />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="rownum">{i + 1}</td>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c} className={NUM.test(r[c] || '') ? 'num' : ''}>
                {r[c] ?? ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
})

function SlidesView({ slides }: { slides: NonNullable<ShownRead['slides']> }) {
  if (!slides.length) return <p className="text-muted-foreground">No slides with text.</p>
  return (
    <div className="grid gap-3">
      {slides.map(s => (
        <section key={s.n} className="rounded-xl bg-ink/[0.035] p-4 shadow-[0_0_0_1px_oklch(1_0_0/0.08)]">
          <div className="mb-1 text-[12px] text-muted-foreground">Slide {s.n}</div>
          {s.lines.length ? (
            <>
              <h3 className="mb-1 text-[16px] font-semibold">{s.lines[0]}</h3>
              {s.lines.slice(1).map((l, i) => (
                <p key={i} className="text-[14px] leading-relaxed text-foreground/85">
                  {l}
                </p>
              ))}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">(no text)</p>
          )}
        </section>
      ))}
      <p className="text-[12.5px] text-muted-foreground">The text of each slide. Open it in PowerPoint for the design.</p>
    </div>
  )
}

export function OpenNatively({ what, onOpen, note }: { what: string; onOpen: () => void; note?: string }) {
  return (
    <div className="grid h-full min-h-[160px] place-content-center justify-items-center gap-3 text-center">
      <AppWindow className="size-8 text-muted-foreground" strokeWidth={1.5} />
      <p className="max-w-[340px] text-[14px] text-muted-foreground">{note || `Cockpit can't draw this ${what}.`}</p>
      <Button onClick={onOpen} className="active:scale-[0.96] transition-[scale,background-color] duration-150">
        Open in its own program
      </Button>
    </div>
  )
}

export interface ViewerProps {
  read: ShownRead
  /** In a card: tighter type, frames fill the card. Full screen: reading sizes. */
  compact?: boolean
  onOpenNative: () => void
  onOpenPath?: (entry: ShownEntry) => void
  onReadAgain?: () => void
  /** An image finished loading: a card uses it to take the image's shape. */
  onImageLoad?: (img: HTMLImageElement) => void
}

/**
 * A page on the board that keeps what's typed in it. The page runs sealed off (no origin of its own); the server puts
 * a small script in it (server/lib/pages.js) that says hello when it's loaded, gets back what was kept, and tells this
 * frame what's in its fields as they change. This frame keeps that with the page's entry (pageState).
 */
function PageFrame({ id, src, title, state }: { id: string; src: string; title: string; state?: Record<string, unknown> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  // the latest: what the page last said, else what the entry came with
  const kept = useRef(state || {})
  const saved = useRef(false)
  useEffect(() => {
    if (!saved.current) kept.current = state || {}
  }, [state])
  useEffect(() => {
    const on = (m: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (!win || m.source !== win || !m.data || typeof m.data !== 'object') return
      if (m.data.cockpitPage === 'hello') win.postMessage({ cockpitPage: 'state', state: kept.current }, '*')
      else if (m.data.cockpitPage === 'save' && m.data.state && typeof m.data.state === 'object') {
        kept.current = m.data.state
        saved.current = true
        post(`/api/shown/${id}`, { pageState: m.data.state }).catch(() => {})
      }
    }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [id])
  return <iframe ref={frame} className="frame white" src={src} title={title} />
}

export function Viewer({ read, compact, onOpenNative, onOpenPath, onReadAgain, onImageLoad }: ViewerProps) {
  const e = read.entry
  const text = read.text ?? ''
  const [fit, setFit] = useState(true)
  const fileUrl = e.path ? `/api/shown/${e.id}/files/${encodeURIComponent(basename(e.path))}?v=${Math.round(read.mtime)}` : ''
  const resolveAsset = useCallback((href: string) => `/api/shown/${e.id}/files/${href.split('/').map(encodeURIComponent).join('/')}`, [e.id])
  const onLocalLink = useCallback(
    async (href: string) => {
      if (e.kind !== 'file') return
      const rel = decodeURIComponent(href.split('#')[0].split('?')[0])
      if (!rel) return
      try {
        onOpenPath?.(await post<ShownEntry>('/api/shown', { path: joinPath(e.path, rel) }))
      } catch {
        // a link to nothing
      }
    },
    [e, onOpenPath],
  )

  if (!read.exists) return <p className="text-muted-foreground">The file is no longer at {e.path}.</p>
  if (read.previewError) return <OpenNatively what="file" note={read.previewError} onOpen={onOpenNative} />
  const md = cn(compact && 'md-compact')

  switch (e.format) {
    case 'article':
      return <SafeHtml html={text} className={cn('article', md)} />
    case 'link':
      return (
        <div className="grid gap-3">
          <p className="text-muted-foreground">
            {e.readingAt && !e.readError && Date.now() - Date.parse(e.readingAt) < 120_000
              ? 'Still getting the page… it shows here in a moment.'
              : e.readError || 'This page could not be read here.'}
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <a href={e.url} target="_blank" rel="noopener noreferrer">
                Open in the browser
              </a>
            </Button>
            {onReadAgain && (
              <Button variant="ghost" onClick={onReadAgain}>
                Try again
              </Button>
            )}
          </div>
        </div>
      )
    case 'docx':
      return <SafeHtml html={read.html || ''} className={cn('docx', md)} />
    case 'sheet':
      return <SheetView read={read} />
    case 'slides':
      return <SlidesView slides={read.slides || []} />
    case 'compare':
      return <CompareView before={text} after={read.text2 ?? ''} leftName={basename(e.path)} rightName={basename(e.path2 || '')} />
    case 'markdown':
      return <Markdown text={text} className={md} resolveAsset={e.kind === 'file' ? resolveAsset : undefined} onLocalLink={onLocalLink} />
    case 'mermaid':
      return <Markdown text={'```mermaid\n' + text + '\n```'} className={md} />
    case 'code':
      return <CodeView text={text} language={e.language} />
    case 'text':
      return <CodeView text={text} language="plaintext" />
    case 'json':
      return <JsonView text={text} />
    case 'csv':
      return <CsvView text={text} path={e.path} />
    case 'diff':
      return <DiffView text={text} />
    case 'image':
      return (
        <div className={cn('image-view', fit && 'fit')} onClick={() => setFit(!fit)} title={fit ? 'Actual size' : 'Fit'}>
          <img src={fileUrl} alt={e.title} onLoad={ev => onImageLoad?.(ev.currentTarget)} />
        </div>
      )
    case 'pdf':
      return <iframe className="frame" src={fileUrl} title={e.title} />
    case 'html':
      // sandboxed by the server's CSP header: scripts run, Cockpit stays out of reach; what's typed is kept
      return <PageFrame id={e.id} src={fileUrl} title={e.title} state={e.pageState} />
    case 'video':
      return <video className="media" src={fileUrl} controls />
    case 'audio':
      return <audio className="media" src={fileUrl} controls />
    default:
      return <OpenNatively what="kind of file" onOpen={onOpenNative} />
  }
}
