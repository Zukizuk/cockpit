// The Table extra (Settings > Extras): a small grid on the board, kept as a .csv in the notes folder's tables/, so it
// opens in Excel too. Type in a cell; Tab and Enter move along (and add a row at the end); a block copied from Excel
// pastes across the cells; Copy gives it back for Excel, or as Markdown for a note or a chat. The first row is the
// header. Claude can make a table, read it and fill it in.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Copy, ExternalLink, FileText, Heading, Plus, Table2, X } from 'lucide-react'
import { get, openOutside, post, put, type TableData } from '../api'
import { useBoard, type CardNode } from '../board'
import { onEvent } from '../lib'
import { CardShell, IconButton, type CardAction } from './CardShell'
import { TitleButton, TitleInput } from './NoteCard'
import { cn } from '@/lib/utils'

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
const toMarkdown = (rows: string[][]) => {
  const esc = (c: string) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
  const [head, ...body] = rows
  return [`| ${head.map(esc).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n')
}

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

  const rows = t?.rows || []
  const cols = rows[0]?.length || 0
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
      if (r === rows.length - 1) addRow()
      return focusCell(r + 1, 0)
    }
    // Enter goes down; after Tab, Tab, Enter it goes back to the column the row was started in (as Excel does)
    const from = tabFrom.current
    if (/^(Enter|Arrow|Escape)/.test(e.key)) tabFrom.current = null
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) return r > 0 && focusCell(r - 1, c)
      if (r === rows.length - 1) addRow()
      return focusCell(r + 1, from ?? c)
    }
    if (e.key === 'ArrowDown' && r < rows.length - 1) return e.preventDefault(), focusCell(r + 1, c)
    if (e.key === 'ArrowUp' && r > 0) return e.preventDefault(), focusCell(r - 1, c)
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

  const copy = (how: 'tsv' | 'md') => board.copy(how === 'tsv' ? toTsv(rows) : toMarkdown(rows), how === 'tsv' ? 'Copied: paste it into Excel' : 'Copied as Markdown')
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

  const actions: CardAction[] = [
    { label: 'Rename', icon: Heading, run: () => setNaming(true), keys: 'F2' },
    { label: 'Copy for Excel', icon: Copy, run: () => copy('tsv') },
    { label: 'Copy as Markdown', icon: FileText, run: () => copy('md') },
    { label: 'Add a row', icon: Plus, run: () => addRow(), gap: true },
    { label: 'Add a column', icon: Plus, run: addCol },
    { label: 'Open in Excel', icon: ExternalLink, run: () => save().then(() => openOutside({ kind: 'table', path: data.ref, how: 'default' })).catch(e => board.toast(e.message)), gap: true },
    { label: 'Remove from board', icon: X, run: () => board.removeCard(id), keys: 'Del' },
  ]

  const title = t?.title || data.ref.split('/').pop()?.replace(/\.csv$/i, '') || 'Table'
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={Table2}
      title={naming ? <TitleInput value={title} onDone={keepTitle} /> : <TitleButton title={title} empty="Table" always onName={() => setNaming(true)} />}
      subtitle={err || undefined}
      hug
      quick={<IconButton icon={Copy} label="Copy for Excel" onClick={() => copy('tsv')} />}
      actions={actions}
      bodyClassName="table-body"
    >
      {t && (
        <div className="tbl-wrap">
          <table ref={grid} className="tbl" onBlur={e => !e.currentTarget.contains(e.relatedTarget as Node) && save()}>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={cn(r === 0 && 'tbl-head')}>
                  {row.map((v, c) => (
                    <td key={c}>
                      <input
                        data-cell={`${r}:${c}`}
                        value={v}
                        aria-label={r === 0 ? `Column ${c + 1} heading` : `${rows[0][c] || `Column ${c + 1}`}, row ${r}`}
                        placeholder={r === 0 ? `Column ${c + 1}` : ''}
                        spellCheck={false}
                        onChange={e => set(r, c, e.target.value)}
                        onKeyDown={e => onKey(e, r, c)}
                        onPaste={e => onPaste(e, r, c)}
                        onMouseDown={() => (tabFrom.current = null)}
                      />
                      {r === 0 && cols > 1 && (
                        <button type="button" className="tbl-drop tbl-drop-col" aria-label={`Delete column ${rows[0][c] || c + 1}`} title="Delete this column" onClick={() => dropCol(c)}>
                          <X className="size-3" strokeWidth={2} />
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="tbl-side">
                    {r === 0 ? (
                      <button type="button" className="tbl-add" aria-label="Add a column" title="Add a column" onClick={addCol}>
                        <Plus className="size-3.5" strokeWidth={1.75} />
                      </button>
                    ) : (
                      rows.length > 2 && (
                        <button type="button" className="tbl-drop" aria-label={`Delete row ${r}`} title="Delete this row" onClick={() => dropRow(r)}>
                          <X className="size-3" strokeWidth={2} />
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="tbl-add-row" onClick={() => (addRow(), focusCell(rows.length, 0))}>
            <Plus className="size-3.5" strokeWidth={1.75} />
            Row
          </button>
        </div>
      )}
    </CardShell>
  )
}
