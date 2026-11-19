// Renderers for what isn't markdown: highlighted code, CSV as a table, diffs.
import { useEffect, useMemo, useRef, useState } from 'react'
import { hljs } from './Markdown'

export function CodeView({ text, language }: { text: string; language?: string }) {
  const ref = useRef<HTMLElement>(null)
  const lines = useMemo(() => text.split('\n').length, [text])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = text
    el.removeAttribute('data-highlighted')
    el.className = 'hljs'
    if (text.length > 400_000) return
    if (language && hljs.getLanguage(language)) el.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value
    else if (!language && text.length < 100_000) el.innerHTML = hljs.highlightAuto(text).value
  }, [text, language])
  return (
    <div className="code-view">
      <pre className="gutter" aria-hidden="true">
        {Array.from({ length: Math.min(lines, 50_000) }, (_, i) => i + 1).join('\n')}
      </pre>
      <pre className="code">
        <code ref={ref} />
      </pre>
    </div>
  )
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter: string, maxRows = 5000): { rows: string[][]; more: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows + 1), more: true }
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return { rows, more: false }
}

function guessDelimiter(text: string, path?: string) {
  if (path?.toLowerCase().endsWith('.tsv')) return '\t'
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 2000)
  const counts = [',', ';', '\t', '|'].map(d => [d, first.split(d).length] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 1 ? counts[0][0] : ','
}

export function CsvView({ text, path }: { text: string; path?: string }) {
  const [filter, setFilter] = useState('')
  const { rows, more } = useMemo(() => parseCsv(text, guessDelimiter(text, path)), [text, path])
  const [head, ...body] = rows
  const numeric = useMemo(
    () => (head || []).map((_, c) => body.slice(0, 50).filter(r => r[c]?.trim()).every(r => /^-?[\d,. ]+%?$/.test(r[c].trim()))),
    [head, body],
  )
  const shown = filter ? body.filter(r => r.some(f => f.toLowerCase().includes(filter.toLowerCase()))) : body
  if (!head) return <p className="muted">Empty file.</p>
  return (
    <div className="csv-view">
      <div className="csv-bar">
        <span className="muted">
          {body.length.toLocaleString()} rows{more ? '+ (first 5,000 shown)' : ''} · {head.length} columns
        </span>
        <input className="input small" placeholder="Filter rows" value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th className="rownum">#</th>
              {head.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td className="rownum">{i + 1}</td>
                {head.map((_, c) => (
                  <td key={c} className={numeric[c] ? 'num' : ''}>
                    {r[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** A unified diff the way GitHub shows it: old and new line numbers, added lines green, removed lines red. */
export function DiffView({ text }: { text: string }) {
  const rows = useMemo(() => {
    const out: { kind: 'add' | 'del' | 'same' | 'hunk' | 'file'; text: string; a?: number; b?: number }[] = []
    let a = 0
    let b = 0
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
      if (h) {
        a = Number(h[1])
        b = Number(h[2])
        out.push({ kind: 'hunk', text: line })
      } else if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) {
        if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
        out.push({ kind: 'file', text: line })
      } else if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1), b: b++ })
      else if (line.startsWith('-')) out.push({ kind: 'del', text: line.slice(1), a: a++ })
      else if (line.startsWith('\\')) out.push({ kind: 'file', text: line })
      else if (a || b) out.push({ kind: 'same', text: line.slice(1), a: a++, b: b++ })
    }
    return out
  }, [text])
  const added = rows.filter(r => r.kind === 'add').length
  const removed = rows.filter(r => r.kind === 'del').length
  return (
    <div className="gh-diff">
      <div className="gh-diff-head">
        <span className="text-emerald-400">+{added}</span> <span className="text-red-400">−{removed}</span>
        <span className="gh-bar">
          {Array.from({ length: 5 }, (_, i) => {
            const total = added + removed || 1
            const green = Math.round((added / total) * 5)
            return <i key={i} className={i < green ? 'g' : 'r'} />
          })}
        </span>
      </div>
      <div className="gh-diff-body">
        {rows.map((r, i) =>
          r.kind === 'hunk' || r.kind === 'file' ? (
            <div key={i} className={`gh-row ${r.kind}`}>
              <span className="gh-n" />
              <span className="gh-n" />
              <span className="gh-t">{r.text}</span>
            </div>
          ) : (
            <div key={i} className={`gh-row ${r.kind}`}>
              <span className="gh-n">{r.a ?? ''}</span>
              <span className="gh-n">{r.b ?? ''}</span>
              <span className="gh-t">
                <span className="gh-sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>
                {r.text || ' '}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

export function JsonView({ text }: { text: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }, [text])
  return <CodeView text={pretty} language="json" />
}
