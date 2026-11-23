// Two versions side by side, before on the left and after on the right, with long unchanged stretches folded.
import { useMemo, useState } from 'react'
import { diffLines } from 'diff'

type Row = { kind: 'same' | 'del' | 'add' | 'change'; left?: string; right?: string; ln?: number; rn?: number } | { kind: 'fold'; count: number; id: number }

function buildRows(before: string, after: string): Row[] {
  const parts = diffLines(before.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n'))
  const rows: Row[] = []
  let ln = 1
  let rn = 1
  const lines = (s: string) => {
    const l = s.split('\n')
    if (l[l.length - 1] === '') l.pop()
    return l
  }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p.added && !p.removed) {
      for (const l of lines(p.value)) rows.push({ kind: 'same', left: l, right: l, ln: ln++, rn: rn++ })
    } else if (p.removed && parts[i + 1]?.added) {
      const del = lines(p.value)
      const add = lines(parts[i + 1].value)
      for (let k = 0; k < Math.max(del.length, add.length); k++) {
        rows.push({ kind: 'change', left: del[k], right: add[k], ln: del[k] !== undefined ? ln++ : undefined, rn: add[k] !== undefined ? rn++ : undefined })
      }
      i++
    } else if (p.removed) {
      for (const l of lines(p.value)) rows.push({ kind: 'del', left: l, ln: ln++ })
    } else {
      for (const l of lines(p.value)) rows.push({ kind: 'add', right: l, rn: rn++ })
    }
  }
  return rows
}

/** Folds runs of unchanged lines longer than 2×context, keeping `context` lines around each change. */
function fold(rows: Row[], context: number, open: Set<number>): Row[] {
  const out: Row[] = []
  let i = 0
  let id = 0
  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      out.push(rows[i++])
      continue
    }
    let j = i
    while (j < rows.length && rows[j].kind === 'same') j++
    const run = rows.slice(i, j)
    const head = i === 0 ? 0 : context
    const tail = j === rows.length ? 0 : context
    const foldId = id++
    if (run.length > head + tail + 3 && !open.has(foldId)) {
      out.push(...run.slice(0, head), { kind: 'fold', count: run.length - head - tail, id: foldId }, ...run.slice(run.length - tail))
    } else out.push(...run)
    i = j
  }
  return out
}

export function CompareView({ before, after, leftName, rightName, tags = ['Before', 'After'] }: { before: string; after: string; leftName: string; rightName: string; tags?: [string, string] }) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const rows = useMemo(() => buildRows(before, after), [before, after])
  const changed = rows.filter(r => r.kind !== 'same').length
  const shown = useMemo(() => fold(rows, 3, open), [rows, open])
  return (
    <div className="compare">
      <div className="compare-head">
        <div>
          <span className="tag-before">{tags[0]}</span> {leftName}
        </div>
        <div>
          <span className="tag-after">{tags[1]}</span> {rightName}
        </div>
      </div>
      {changed === 0 && <p className="compare-same">The two files are the same.</p>}
      <div className="compare-body">
        {shown.map((r, i) =>
          r.kind === 'fold' ? (
            <button key={`f${r.id}-${i}`} className="fold" onClick={() => setOpen(new Set([...open, r.id]))}>
              ⋯ {r.count} unchanged lines
            </button>
          ) : (
            <div key={i} className={`crow ${r.kind}`}>
              <span className="cn">{r.ln ?? ''}</span>
              <span className={`cl ${r.kind === 'del' || (r.kind === 'change' && r.left !== undefined) ? 'minus' : ''} ${r.left === undefined ? 'empty' : ''}`}>{r.left ?? ''}</span>
              <span className="cn">{r.rn ?? ''}</span>
              <span className={`cl ${r.kind === 'add' || (r.kind === 'change' && r.right !== undefined) ? 'plus' : ''} ${r.right === undefined ? 'empty' : ''}`}>{r.right ?? ''}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
