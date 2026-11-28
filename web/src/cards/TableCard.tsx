// The Table extra (Settings > Extras): a small grid on the board, kept as a .csv in the notes folder's tables/, so it
// opens in Excel too. Type in a cell; Tab and Enter move along (and add a row at the end); a block copied from Excel
// pastes across the cells; Copy gives it back for Excel. The first row is the
// header. Claude can make a table, read it and fill it in.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ArrowDownAZ, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, ArrowUpZA, Copy, ExternalLink, Filter, FilterX, Heading, Plus, Table2, Trash2, X } from 'lucide-react'
import { get, openOutside, post, put, type TableData } from '../api'
import { useBoard, type CardNode } from '../board'
import { onEvent } from '../lib'
import { CardShell, type CardAction } from './CardShell'
import { TitleButton, TitleInput } from './NoteCard'
import { cn } from '@/lib/utils'
import { evaluate, hasFormulas, isTotalRow, shiftRows } from '../lib/formula'

type Board = ReturnType<typeof useBoard>

/** Text that is a table: lines with tabs (copied from Excel), or several lines of commas or pipes. */
export function looksTabular(text: string) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.some(l => l.includes('\t'))) return true
  if (lines.length < 2) return false
  return lines.every(l => /\|/.test(l)) || lines.every(l => l.split(',').length >= 2)
}

/** Rows from pasted text: Excel's tabs, a Markdown table, or commas. */
export function rowsFromText(text: string): string[][] {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')
  if (lines.some(l => l.includes('\t'))) return lines.map(l => l.split('\t'))
  if (lines.every(l => /\|/.test(l)))
    return lines
      .filter(l => !/^\s*\|?\s*:?-{2,}/.test(l))
      .map(l =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(c => c.trim()),
      )
  return lines.map(l => l.split(',').map(c => c.trim()))
}

const even = (rows: string[][]) => {
  const w = Math.max(1, ...rows.map(r => r.length))
  return rows.map(r => [...r, ...Array(w - r.length).fill('')])
}

/** Tab-separated, as Excel copies and pastes. */
const toTsv = (rows: string[][]) => rows.map(r => r.map(c => c.replace(/[\t\n]/g, ' ')).join('\t')).join('\n')

/** Numbers as numbers ("9" before "10", "1,200" and "€30" too), the rest as words; empty cells always last. */
const asNumber = (v: string) => {
  const s = v.trim().replace(/[\s,€$£%]/g, '')
  return s && /^[-+]?\d*\.?\d+$/.test(s) ? Number(s) : null
}
export function compareCells(a: string, b: string) {
  if (!a.trim() || !b.trim()) return !a.trim() && !b.trim() ? 0 : !a.trim() ? 1 : -1
  const x = asNumber(a)
  const y = asNumber(b)
  if (x !== null && y !== null) return x - y
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
/** The rows under the header in order of one column (A to Z, or Z to A); the header stays on top, ties keep their order. */
export function sortRows(rows: string[][], col: number, desc = false, values?: string[][]) {
  const [head, ...body] = rows
  // a formula's cell sorts by its result (values: what each cell shows)
  const shows = (i: number) => (values?.[i + 1] ?? body[i])[col] ?? ''
  const all = body.map((r, i) => ({ r, i, v: shows(i) }))
  // total rows (=SUM over a range) stay under the rest, in their order
  const totals = all.filter(x => isTotalRow(x.r))
  const sorted = all
    .filter(x => !isTotalRow(x.r))
    .sort((p, q) => {
      const empty = !p.v.trim() || !q.v.trim()
      const c = compareCells(p.v, q.v)
      return (empty || !desc ? c : -c) || p.i - q.i
    })
  // a row's own formulas (=B2*C2) follow it to where it went
  return [head, ...[...sorted, ...totals].map((x, to) => x.r.map(cell => shiftRows(cell, to - x.i)))]
}
/** Whether a row passes the filters (a word or part of one per column, any case); a row still empty always does. */
export function passes(row: string[], filters: string[]) {
  if (row.every(c => !c.trim())) return true
  return filters.every((f, c) => !f.trim() || (row[c] ?? '').toLowerCase().includes(f.trim().toLowerCase()))
}
const filterKey = (ref: string) => `cockpit-table-filter:${ref}`

/** A new table on the board (rows given, or a header and two empty rows); resolves to its card's id. */
export async function newTable(board: Board, { title, rows }: { title?: string; rows?: string[][] } = {}) {
  try {
    const t = await post<TableData>('/api/tables/new', { title: title || 'Table', rows })
    return board.addCard('table', t.path)
  } catch (e: any) {
    board.toast(e.message)
  }
}

export function TableCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const [t, setT] = useState<TableData | null>(null)
  const [err, setErr] = useState('')
  const [naming, setNaming] = useState(false)
  const [fresh] = useState(() => !!data.born && Date.now() - data.born < 2500)
  const rowsRef = useRef<string[][]>([])
  const mtime = useRef(0)
  const dirty = useRef(false)
  const timer = useRef<number>(0)
  const grid = useRef<HTMLTableElement>(null)
  const tabFrom = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await get<TableData>(`/api/tables?p=${encodeURIComponent(data.ref)}`)
      mtime.current = r.mtime
      rowsRef.current = r.rows
      dirty.current = false
      setT(r)
      setErr('')
    } catch (e: any) {
      setErr(e.message)
    }
  }, [data.ref])
  useEffect(() => {
    load()
  }, [load])
  // F2 on the board, with this card selected
  useEffect(() => onEvent('note-rename', (d: { id?: string }) => d.id === id && setNaming(true)), [id])

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    try {
      const r = await put<{ mtime: number }>('/api/tables', { path: data.ref, rows: rowsRef.current, baseMtime: mtime.current })
      mtime.current = r.mtime
    } catch (e: any) {
      board.toast(e.message)
      load()
    }
  }, [data.ref, board, load])

  // written elsewhere (Claude, or Cockpit in another window): read it again, unless this is our own save
  useEffect(
    () =>
      onEvent('tables', (d: { path?: string; to?: string }) => {
        if (d.path !== data.ref) return
        if (d.to) return board.retarget(id, d.to)
        get<TableData>(`/api/tables?p=${encodeURIComponent(data.ref)}`)
          .then(r => {
            if (Math.abs(r.mtime - mtime.current) <= 1 || dirty.current) return
            mtime.current = r.mtime
            rowsRef.current = r.rows
            setT(r)
          })
          .catch(() => {})
      }),
    [data.ref, id, board],
  )
  // anything typed is saved when the card is left, or the page goes
  useEffect(() => {
    const flush = () => void save()
    addEventListener('beforeunload', flush)
    return () => {
      removeEventListener('beforeunload', flush)
      flush()
    }
  }, [save])

  const change = (rows: string[][]) => {
    rowsRef.current = even(rows)
    dirty.current = true
    setT(x => (x ? { ...x, rows: rowsRef.current } : x))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 600)
  }

  // at once when the cell is there (typing goes on straight away); a row just added is there after it's drawn
  const focusCell = (r: number, c: number) => {
    const go = () => {
      const el = grid.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`)
      el?.focus()
      el?.select()
      return !!el
    }
    if (!go()) requestAnimationFrame(go)
  }
  // a blank table just added takes the cursor; one that came filled in (Claude's, or pasted) doesn't take keys
  // meant for something else
  useEffect(() => {
    if (fresh && t && t.rows.slice(1).every(r => r.every(c => !c.trim()))) focusCell(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, !!t])

  const rows = useMemo(() => t?.rows || [], [t?.rows])
  const cols = rows[0]?.length || 0
  // formulas (=SUM(B2:B7)): each cell shows its result, and its formula while it's being edited
  const values = useMemo(() => (hasFormulas(rows) ? evaluate(rows) : null), [rows])
  const shows = (r: number) => (values ? values[r].map(x => x.value) : rows[r])
  const [editing, setEditing] = useState<string | null>(null)

  // Filter: a box under each heading; only the rows that match are shown (the file keeps them all). Kept for this
  // table on this PC until cleared.
  const [filters, setFilters] = useState<string[] | null>(() => {
    try {
      const f = JSON.parse(localStorage.getItem(filterKey(data.ref)) || 'null')
      return Array.isArray(f) ? f.map(String) : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      if (filters) localStorage.setItem(filterKey(data.ref), JSON.stringify(filters))
      else localStorage.removeItem(filterKey(data.ref))
    } catch {}
  }, [filters, data.ref])
  const filtering = !!filters && filters.some(f => f.trim())
  const shown = rows.map((_, r) => r === 0 || !filters || passes(shows(r), filters))
  const shownCount = shown.filter((s, r) => r > 0 && s).length
  const openFilter = () => {
    setFilters(f => f ?? Array(cols).fill(''))
    requestAnimationFrame(() => grid.current?.querySelector<HTMLInputElement>('input[data-filter="0"]')?.focus())
  }
  const setFilter = (c: number, v: string) => setFilters(f => Array.from({ length: cols }, (_, j) => (j === c ? v : (f?.[j] ?? ''))))
  /** The next row shown, up or down from r (the header, row 0, is always shown). */
  const nextShown = (r: number, step: 1 | -1) => {
    for (let i = r + step; i >= 0 && i < rows.length; i += step) if (shown[i]) return i
    return -1
  }
  const sortBy = (c: number, desc = false) => {
    change(sortRows(rows, c, desc, values?.map(r => r.map(x => x.value))))
    board.toast(`Sorted by ${rows[0]?.[c]?.trim() || `column ${c + 1}`}, ${desc ? 'Z to A' : 'A to Z'}`)
  }
  const set = (r: number, c: number, v: string) => change(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)))
  const addRow = (at = rows.length) => change([...rows.slice(0, at), Array(cols).fill(''), ...rows.slice(at)])
  const addCol = () => change(rows.map((row, i) => [...row, i === 0 ? `Column ${cols + 1}` : '']))
  const dropRow = (r: number) => rows.length > 1 && change(rows.filter((_, i) => i !== r))
  const dropCol = (c: number) => cols > 1 && change(rows.map(row => row.filter((_, j) => j !== c)))

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    e.stopPropagation()
    if (e.key === 'Tab') {
      e.preventDefault()
      tabFrom.current ??= c
      if (e.shiftKey) return c > 0 ? focusCell(r, c - 1) : r > 0 && focusCell(r - 1, cols - 1)
      if (c < cols - 1) return focusCell(r, c + 1)
      tabFrom.current = 0
      const below = nextShown(r, 1)
      if (below < 0) {
        addRow()
        return focusCell(rows.length, 0)
      }
      return focusCell(below, 0)
    }
    // Enter goes down; after Tab, Tab, Enter it goes back to the column the row was started in (as Excel does)
    const from = tabFrom.current
    if (/^(Enter|Arrow|Escape)/.test(e.key)) tabFrom.current = null
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) return r > 0 && focusCell(nextShown(r, -1), c)
      const below = nextShown(r, 1)
      if (below < 0) {
        addRow()
        return focusCell(rows.length, from ?? c)
      }
      return focusCell(below, from ?? c)
    }
    if (e.key === 'ArrowDown' && nextShown(r, 1) > 0) return e.preventDefault(), focusCell(nextShown(r, 1), c)
    if (e.key === 'ArrowUp' && r > 0) return e.preventDefault(), focusCell(nextShown(r, -1), c)
    if (e.key === 'Escape') {
      e.currentTarget.blur()
      save()
    }
  }

  // a block copied from Excel (or a Markdown table) fills the cells from this one, adding rows and columns as needed
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const block = rowsFromText(text)
    const next = rows.map(row => [...row])
    block.forEach((line, i) => {
      next[r + i] ??= Array(cols).fill('')
      line.forEach((v, j) => (next[r + i][c + j] = v))
    })
    change(next)
  }

  const copy = () => board.copy(toTsv(rows), 'Copied: paste it into Excel')
  const keepTitle = async (v: string | null) => {
    setNaming(false)
    if (v === null || !v.trim() || v.trim() === t?.title) return
    try {
      await save()
      const r = await post<TableData>('/api/tables/rename', { path: data.ref, title: v })
      board.retarget(id, r.path)
    } catch (e: any) {
      board.toast(e.message)
    }
  }

  // what was right-clicked: a cell's menu is only about it, its row and its column (the card's own menu is the title's)
  const [at, setAt] = useState<{ r: number; c: number } | null>(null)
  const insertCol = (at: number) => change(rows.map((row, i) => [...row.slice(0, at), i === 0 ? `Column ${cols + 1}` : '', ...row.slice(at)]))
  const colName = (c: number) => rows[0]?.[c]?.trim() || `column ${c + 1}`
  const cellActions: CardAction[] = at
    ? [
        { label: `Sort by ${colName(at.c)}, A to Z`, icon: ArrowDownAZ, run: () => sortBy(at.c), context: true, hidden: rows.length < 3 },
        { label: `Sort by ${colName(at.c)}, Z to A`, icon: ArrowUpZA, run: () => sortBy(at.c, true), context: true, hidden: rows.length < 3 },
        { label: filters ? `Filter ${colName(at.c)}` : 'Filter rows', icon: Filter, run: () => (openFilter(), requestAnimationFrame(() => grid.current?.querySelector<HTMLInputElement>(`input[data-filter="${at.c}"]`)?.focus())), context: true, gap: true },
        { label: 'Insert a row above', icon: ArrowUpToLine, run: () => addRow(Math.max(1, at.r)), context: true, hidden: at.r === 0, gap: true },
        { label: 'Insert a row below', icon: ArrowDownToLine, run: () => addRow(at.r + 1), context: true },
        { label: 'Insert a column left', icon: ArrowLeftToLine, run: () => insertCol(at.c), context: true },
        { label: 'Insert a column right', icon: ArrowRightToLine, run: () => insertCol(at.c + 1), context: true },
        { label: 'Delete this row', icon: Trash2, run: () => dropRow(at.r), context: true, danger: true, gap: true, hidden: at.r === 0 || rows.length <= 2 },
        { label: `Delete ${colName(at.c)}`, icon: Trash2, run: () => dropCol(at.c), context: true, danger: true, gap: at.r === 0 || rows.length <= 2, hidden: cols <= 1 },
      ]
    : []

  const actions: CardAction[] = [
    ...cellActions,
    { label: 'Rename', icon: Heading, run: () => setNaming(true), keys: 'F2' },
    { label: 'Copy the table', icon: Copy, run: copy },
    { label: 'Open in Excel', icon: ExternalLink, run: () => save().then(() => openOutside({ kind: 'table', path: data.ref, how: 'default' })).catch(e => board.toast(e.message)) },
    { label: 'Filter rows', icon: Filter, run: openFilter, hidden: !!filters },
    { label: 'Clear the filter', icon: FilterX, run: () => setFilters(null), hidden: !filters },
    {
      label: 'Delete table',
      icon: Trash2,
      danger: true,
      gap: true,
      run: async () => {
        try {
          await save()
          await post('/api/tables/archive', { path: data.ref })
          board.removeCard(id, { quiet: true })
          board.toast('Table deleted (kept in the .archive of your notes folder)')
        } catch (e: any) {
          board.toast(e.message)
        }
      },
    },
    { label: 'Remove from board', icon: X, run: () => board.removeCard(id), keys: 'Del' },
  ]

  const title = t?.title || data.ref.split('/').pop()?.replace(/\.csv$/i, '') || 'Table'
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={Table2}
      title={err ? <span className="text-destructive">{err}</span> : naming ? <TitleInput value={title} onDone={keepTitle} /> : <TitleButton title={title} empty="Table" always onName={() => setNaming(true)} />}
      subtitle={data.folded && t ? `${Math.max(0, t.rows.length - 1)} ${t.rows.length === 2 ? 'row' : 'rows'} · folded` : undefined}
      hug
      bare
      onMenuButton={() => setAt(null)}
      onContext={e => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell
        setAt(cell ? { r: Number(cell.split(':')[0]), c: Number(cell.split(':')[1]) } : null)
      }}
      actions={actions}
      bodyClassName="table-body"
    >
      {t && (
        <div className="tbl-free">
          {filters && (
            <div className="tbl-filter-note">
              <span>{filtering ? `Showing ${shownCount} of ${rows.length - 1} rows` : 'Type in a box to show only the rows that match'}</span>
              <button type="button" onClick={() => setFilters(null)}>
                Clear the filter
              </button>
            </div>
          )}
          <div className="tbl-grid">
            <table ref={grid} className="tbl" onBlur={e => !e.currentTarget.contains(e.relatedTarget as Node) && save()}>
              <tbody>
                {rows.map((row, r) => (
                  <Fragment key={r}>
                  {r === 1 && filters && (
                    <tr className="tbl-filter">
                      {rows[0].map((h, c) => (
                        <td key={c}>
                          <input
                            data-filter={c}
                            value={filters[c] ?? ''}
                            placeholder="Filter…"
                            aria-label={`Filter ${h.trim() || `column ${c + 1}`}`}
                            spellCheck={false}
                            onChange={e => setFilter(c, e.target.value)}
                            onKeyDown={e => {
                              e.stopPropagation()
                              if (e.key === 'Escape') setFilters(null)
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  )}
                  {shown[r] && (
                  <tr className={cn(r === 0 && 'tbl-head')}>
                    {row.map((v, c) => (
                      <td key={c}>
                        <input
                          data-cell={`${r}:${c}`}
                          value={editing === `${r}:${c}` || !values ? v : values[r][c].value}
                          title={v.startsWith('=') && v.length > 1 ? v : undefined}
                          className={cn(values && v.startsWith('=') && v.length > 1 && 'is-formula', values?.[r][c].error && 'is-error')}
                          onFocus={() => setEditing(`${r}:${c}`)}
                          onBlur={() => setEditing(e => (e === `${r}:${c}` ? null : e))}
                          aria-label={r === 0 ? `Column ${c + 1} heading` : `${rows[0][c] || `Column ${c + 1}`}, row ${r}`}
                          placeholder={r === 0 ? `Column ${c + 1}` : ''}
                          spellCheck={false}
                          onChange={e => set(r, c, e.target.value)}
                          onKeyDown={e => onKey(e, r, c)}
                          onPaste={e => onPaste(e, r, c)}
                          onMouseDown={() => (tabFrom.current = null)}
                        />
                        {r === 0 && cols > 1 && (
                          <button type="button" className="tbl-drop-col" aria-label={`Delete ${colName(c)}`} title="Delete this column" onClick={() => dropCol(c)}>
                            <X className="size-3" strokeWidth={2} />
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {/* a column and a row are added from the table's own edges */}
          <button type="button" className="tbl-edge tbl-edge-col" aria-label="Add a column" title="Add a column" onClick={addCol}>
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
          <button type="button" className="tbl-edge tbl-edge-row" aria-label="Add a row" title="Add a row" onClick={() => (addRow(), focusCell(rows.length, 0))}>
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
    </CardShell>
  )
}
