// The shelf: for what you won't come back to for a week or two. "Put away…" on a card or a section asks until when
// (until you bring it back, or a day); it leaves the board and the tray at the top, and waits on the shelf, a tab at
// the start of the tray that lists what's on it, newest first, with when it was put away and when it comes back. On
// its day it comes back into the tray at the top, with a word that it's back. Only this space's.
import { useEffect, useState } from 'react'
import { useStore } from '@xyflow/react'
import { CalendarDays, Package, SquareDashed } from 'lucide-react'
import { useBoard, spaceOf, type CardNode } from '../board'
import { emit, onEvent } from '../lib'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Asks until when, then puts these cards away on the shelf. */
export const askPutAway = (ids: string[]) => ids.length && emit('shelf-ask', { ids })

const DAY = 86_400_000
/** The start of the day `days` from today, 8 in the morning (when it comes back). */
const dayFrom = (days: number) => {
  const d = new Date()
  d.setHours(8, 0, 0, 0)
  return d.getTime() + days * DAY
}
const nextMonday = () => {
  const d = new Date()
  const ahead = ((8 - d.getDay()) % 7) || 7
  return dayFrom(ahead)
}
const dayName = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const since = (t: number) => {
  const d = Math.floor((Date.now() - t) / DAY)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`
}

/** The "Put away…" choice: until when. Mounted once. */
export function PutAwayDialog() {
  const board = useBoard()
  const [ids, setIds] = useState<string[]>([])
  const [date, setDate] = useState('')
  useEffect(() => onEvent('shelf-ask', (d: { ids: string[] }) => (setIds(d.ids), setDate(''))), [])
  const put = (until?: number) => {
    board.tuck(ids, { until })
    setIds([])
  }
  const n = ids.length
  const choices: [string, number][] = [
    ['Tomorrow', dayFrom(1)],
    ['Next week (Monday)', nextMonday()],
    ['In two weeks', dayFrom(14)],
  ]
  return (
    <Dialog open={n > 0} onOpenChange={o => !o && setIds([])}>
      <DialogContent className="put-away sm:max-w-sm" onKeyDown={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{n > 1 ? `Put these ${n} away` : 'Put it away'}</DialogTitle>
          <DialogDescription>Off the board and out of the tray, kept on the shelf at the top until you want it back.</DialogDescription>
        </DialogHeader>
        <div className="put-away-choices">
          <Button variant="secondary" className="justify-start" autoFocus onClick={() => put()}>
            <Package strokeWidth={1.75} />
            Until I bring it back
          </Button>
          {choices.map(([label, t]) => (
            <Button key={label} variant="ghost" className="justify-start" onClick={() => put(t)}>
              <CalendarDays strokeWidth={1.75} />
              {label}
              <span className="ml-auto text-muted-foreground">{dayName(t)}</span>
            </Button>
          ))}
          <form
            className="put-away-date"
            onSubmit={e => {
              e.preventDefault()
              if (date) put(new Date(`${date}T08:00`).getTime())
            }}
          >
            <input type="date" value={date} min={new Date(dayFrom(1)).toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} aria-label="Bring it back on" />
            <Button type="submit" variant="ghost" disabled={!date}>
              Back on that day
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type Row = { id: string; type: string; ref: string; color: string; at: number; until?: number }

/** What's on the shelf in this space (for the tab and its list). */
export function useShelf() {
  const board = useBoard()
  const key = useStore(s =>
    JSON.stringify(
      s.nodes
        .filter(n => (n.data as CardNode['data']).tucked && (n.data as CardNode['data']).shelf && spaceOf(n as CardNode) === board.space)
        .map(n => {
          const d = n.data as CardNode['data']
          return [n.id, n.type, n.type === 'section' ? d.title || 'Section' : d.ref, d.color || '', d.shelf!.at, d.shelf!.until ?? 0]
        }),
    ),
  )
  return (JSON.parse(key) as [string, string, string, string, number, number][])
    .map(([id, type, ref, color, at, until]): Row => ({ id, type, ref, color, at, ...(until ? { until } : {}) }))
    .sort((a, b) => b.at - a.at)
}

/** Brings back into the tray what's due, now and every minute after (on any space: it waits in its own tray). */
export function ShelfClock() {
  const board = useBoard()
  const due = useStore(s =>
    s.nodes
      .filter(n => (n.data as CardNode['data']).shelf?.until)
      .map(n => `${n.id}:${(n.data as CardNode['data']).shelf!.until}`)
      .join(','),
  )
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    // every minute, and as soon as the window is back (after the PC slept, say)
    const tick = () => setNow(Date.now())
    const t = setInterval(tick, 60_000)
    addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  useEffect(() => {
    if (!due) return
    const back = due
      .split(',')
      .map(x => x.split(':'))
      .filter(([, u]) => Number(u) <= now)
      .map(([id]) => id)
    if (!back.length) return
    board.unshelf(back, 'due')
    board.toast(back.length === 1 ? 'Back from the shelf: it waits in the tray at the top' : `${back.length} back from the shelf, in the tray at the top`)
  }, [due, now, board])
  return null
}

/** The shelf's tab, at the start of the tray: how many are on it, and the list to bring them back from. */
export function ShelfTab({ titleOf }: { titleOf: (type: string, ref: string) => string }) {
  const board = useBoard()
  const rows = useShelf()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  if (!rows.length) return null
  const words = q.trim().toLowerCase()
  const shown = rows.map(r => ({ ...r, title: titleOf(r.type, r.ref) })).filter(r => !words || r.title.toLowerCase().includes(words))
  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="tuck-shelf" title="The shelf: what you've put away for later">
          <Package className="size-3 shrink-0" strokeWidth={2} />
          Shelf · {rows.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="tuck-list w-80 p-1.5">
        <div className="shelf-head">On the shelf</div>
        {rows.length > 7 && (
          <input className="tuck-search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find something put away…" aria-label="Find something on the shelf" onKeyDown={e => e.stopPropagation()} />
        )}
        <div className="tuck-rows">
          {shown.map(r => {
            const sticky = r.type === 'note' && !/^(journal|drafts)\//.test(r.ref)
            return (
              <button
                key={r.id}
                type="button"
                className="tuck-row shelf-row"
                onClick={() => {
                  board.untuck(r.id)
                  if (rows.length <= 1) setOpen(false)
                }}
                title="Bring it back to the board"
              >
                {r.type === 'section' ? <SquareDashed className="size-3.5 shrink-0" strokeWidth={1.75} /> : <span className={cn('tuck-dot', sticky ? `paper-${r.color || board.prefs.stickyColor}` : 'is-plain')} />}
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shelf-when">{r.until ? `back ${dayName(r.until)}` : since(r.at)}</span>
              </button>
            )
          })}
          {!shown.length && <div className="shelf-none">Nothing on the shelf matches.</div>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
