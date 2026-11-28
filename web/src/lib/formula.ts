// Formulas in a table's cells, written as in Excel so the .csv still works there: =SUM(B2:B7), =B2*C2, =ROUND(D2/3, 1).
// Cells are named as Excel names them: columns A, B, C…, rows from 1, where row 1 is the header. Only numbers and a
// small set of functions; no eval, nothing reaches outside the table. A formula that can't be worked out shows an
// error word, like Excel's.

export type Cell = { value: string; error?: string }

/** A number in a cell as people write them: "1,200", "€30", "12%" (as 12), "-4.5"; anything else is not a number. */
export function cellNumber(v: string): number | null {
  const s = v.trim().replace(/[\s,€$£%]/g, '')
  return s && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s) ? Number(s) : null
}

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
export const colLetters = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

class FormulaError extends Error {}

/** A result as a person writes it: 12,400 and 3.25 (no long tails of digits). */
const showNumber = (n: number) => (Math.round(n * 1e10) / 1e10).toLocaleString('en-US', { maximumFractionDigits: 10, useGrouping: Math.abs(n) >= 1000 })

type Token = { t: 'num' | 'ref' | 'range' | 'fn' | 'op' | '(' | ')' | ','; v: string }

function tokens(src: string): Token[] {
  const out: Token[] = []
  const re = /\s*(?:(\d*\.?\d+(?:e[-+]?\d+)?)|([A-Za-z]+\d+:[A-Za-z]+\d+)|([A-Za-z]+\d+)|([A-Za-z]+)\s*(?=\()|([-+*/^&<>=]{1,2})|([(),]))/giy
  let m: RegExpExecArray | null
  let at = 0
  while (at < src.length) {
    re.lastIndex = at
    m = re.exec(src)
    if (!m || m[0].length === 0) {
      if (!src.slice(at).trim()) break
      throw new FormulaError('#SYNTAX')
    }
    at = re.lastIndex
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] })
    else if (m[2]) out.push({ t: 'range', v: m[2].toUpperCase() })
    else if (m[3]) out.push({ t: 'ref', v: m[3].toUpperCase() })
    else if (m[4]) out.push({ t: 'fn', v: m[4].toUpperCase() })
    else if (m[5]) out.push({ t: 'op', v: m[5] })
    else out.push({ t: m[6] as '(' | ')' | ',', v: m[6] })
  }
  return out
}

type Value = number | number[]

const FUNCTIONS: Record<string, (args: Value[]) => number> = {
  SUM: a => flat(a).reduce((s, x) => s + x, 0),
  AVERAGE: a => {
    const f = flat(a)
    if (!f.length) throw new FormulaError('#DIV/0!')
    return f.reduce((s, x) => s + x, 0) / f.length
  },
  MIN: a => (flat(a).length ? Math.min(...flat(a)) : 0),
  MAX: a => (flat(a).length ? Math.max(...flat(a)) : 0),
  COUNT: a => flat(a).length,
  ROUND: a => {
    const [x, d = 0] = a.map(one)
    const p = 10 ** Math.trunc(d)
    return Math.round(x * p) / p
  },
  ABS: a => Math.abs(one(a[0])),
}
const flat = (a: Value[]) => a.flatMap(x => (Array.isArray(x) ? x : [x]))
const one = (v: Value | undefined) => {
  if (v === undefined) throw new FormulaError('#VALUE!')
  if (Array.isArray(v)) {
    if (v.length !== 1) throw new FormulaError('#VALUE!')
    return v[0]
  }
  return v
}

/** Works out every cell of the table: a formula's result, or its error; other cells as they are. */
export function evaluate(rows: string[][]): Cell[][] {
  const done = new Map<string, Cell>()
  const busy = new Set<string>()

  const cellAt = (r: number, c: number): Cell => {
    const key = `${r}:${c}`
    const known = done.get(key)
    if (known) return known
    const raw = rows[r]?.[c] ?? ''
    if (!raw.startsWith('=') || raw.length < 2) return { value: raw }
    if (busy.has(key)) throw new FormulaError('#CYCLE!')
    busy.add(key)
    let cell: Cell
    try {
      const n = run(raw.slice(1))
      cell = { value: Number.isFinite(n) ? showNumber(n) : '#NUM!' }
    } catch (e) {
      cell = { value: e instanceof FormulaError ? e.message : '#ERROR!', error: e instanceof FormulaError ? e.message : '#ERROR!' }
      if (cell.value === '#NUM!') cell.error = '#NUM!'
    } finally {
      busy.delete(key)
    }
    done.set(key, cell)
    return cell
  }
  // a referenced cell's number: empty counts as 0 in sums and sums only; words are skipped in a range
  const numberAt = (r: number, c: number, inRange: boolean): number | null => {
    const cell = cellAt(r, c)
    if (cell.error) throw new FormulaError(cell.error)
    const n = cellNumber(cell.value)
    if (n !== null) return n
    if (inRange) return null
    if (!cell.value.trim()) return 0
    throw new FormulaError('#VALUE!')
  }
  const at = (ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!
    return { r: Number(m[2]) - 1, c: colIndex(m[1]) }
  }

  function run(src: string): number {
    const toks = tokens(src)
    let i = 0
    const peek = () => toks[i]
    const take = () => toks[i++]
    const expect = (t: Token['t']) => {
      if (peek()?.t !== t) throw new FormulaError('#SYNTAX')
      return take()
    }
    // + and -, then * and /, then ^, then a value
    const sum = (): Value => {
      let v = product()
      while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = take().v
        const r = one(product())
        v = op === '+' ? one(v) + r : one(v) - r
      }
      return v
    }
    const product = (): Value => {
      let v = power()
      while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = take().v
        const r = one(power())
        if (op === '/' && r === 0) throw new FormulaError('#DIV/0!')
        v = op === '*' ? one(v) * r : one(v) / r
      }
      return v
    }
    const power = (): Value => {
      const v = unary()
      if (peek()?.t === 'op' && peek().v === '^') {
        take()
        return one(v) ** one(power())
      }
      return v
    }
    const unary = (): Value => {
      if (peek()?.t === 'op' && (peek().v === '-' || peek().v === '+')) {
        const op = take().v
        const v = one(unary())
        return op === '-' ? -v : v
      }
      return atom()
    }
    const atom = (): Value => {
      const tk = take()
      if (!tk) throw new FormulaError('#SYNTAX')
      if (tk.t === 'num') return Number(tk.v)
      if (tk.t === 'ref') {
        const { r, c } = at(tk.v)
        if (r < 0 || r >= rows.length || c < 0 || c >= (rows[0]?.length ?? 0)) throw new FormulaError('#REF!')
        return numberAt(r, c, false) ?? 0
      }
      if (tk.t === 'range') {
        const [a, b] = tk.v.split(':').map(at)
        const out: number[] = []
        for (let r = Math.max(0, Math.min(a.r, b.r)); r <= Math.min(rows.length - 1, Math.max(a.r, b.r)); r++)
          for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
            const n = numberAt(r, c, true)
            if (n !== null) out.push(n)
          }
        return out
      }
      if (tk.t === 'fn') {
        const fn = FUNCTIONS[tk.v]
        if (!fn) throw new FormulaError('#NAME?')
        expect('(')
        const args: Value[] = []
        if (peek()?.t !== ')') {
          args.push(sum())
          while (peek()?.t === ',') {
            take()
            args.push(sum())
          }
        }
        expect(')')
        return fn(args)
      }
      if (tk.t === '(') {
        const v = sum()
        expect(')')
        return v
      }
      throw new FormulaError('#SYNTAX')
    }
    const v = one(sum())
    if (i < toks.length) throw new FormulaError('#SYNTAX')
    return v
  }

  return rows.map((row, r) =>
    row.map((_, c) => {
      try {
        return cellAt(r, c)
      } catch (e) {
        const msg = e instanceof FormulaError ? e.message : '#ERROR!'
        return { value: msg, error: msg }
      }
    }),
  )
}

/** Whether any cell of the table is a formula. */
export const hasFormulas = (rows: string[][]) => rows.some(r => r.some(c => c.startsWith('=') && c.length > 1))

/** A formula moved by `rows` rows (a row sorted elsewhere): its cell names move with it, as Excel's do. */
export const shiftRows = (formula: string, rows: number) =>
  !rows || !formula.startsWith('=') ? formula : formula.replace(/(?<![A-Za-z])([A-Za-z]{1,3})(\d+)(?![\d(])(?!\s*\()/g, (_, col: string, row: string) => `${col}${Math.max(1, Number(row) + rows)}`)

/** A total row: one with a formula over a range (=SUM(D2:D7)). Sorting keeps it under the rest. */
export const isTotalRow = (row: string[]) => row.some(c => c.startsWith('=') && /[A-Za-z]+\d+:[A-Za-z]+\d+/.test(c))
