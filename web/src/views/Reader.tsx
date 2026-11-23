// Full screen for one card, or two side by side to compare: the board stays behind, blurred, and Esc brings it back.
// Side by side, each half is the same page as one card full screen (its own bar, its own scrolling, notes still
// editable), with a divider to drag, scrolling together on request, and the differences between the two as text.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import { Archive, ArrowLeftRight, BookOpen, BookOpenText, Columns2, Diff, Link2, NotebookPen, Pencil, RefreshCw, SquareSplitHorizontal, X } from 'lucide-react'
import { get, post, type ShownRead } from '../api'
import { ago, useEvent } from '../lib'
import { spaceOf, useBoard, type CardNode, type Shown } from '../board'
import { useItemActions } from '../cards/ItemCard'
import { IconButton } from '../cards/CardShell'
import { NotePane, noteKind, noteTitle, useNote, type NoteMode } from '../components/NotePane'
import { dayOf, todayPage, useJournalSync } from '../journal'
import { Viewer, iconFor, kindLabel, placeOf } from '../components/Viewer'
import { CompareView } from '../components/Compare'
import { isPath, isUrl, unquote } from './paste'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import { cn } from '@/lib/utils'

/** What this page is to the full screen around it: one of two sides, or the only one. */
type SideCtl = { close: () => void; replace: (t: Shown) => void; compare?: () => void }
const SideContext = createContext<SideCtl | null>(null)
const same = (a: Shown, b: Shown) => a.type === b.type && a.ref === b.ref

export function Reader() {
  const board = useBoard()
  const target = board.expanded
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"], [role="menu"], [role="listbox"]') && !(e.target as HTMLElement).closest('.reader')) return
      board.expand(null)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [target, board])
  useEffect(() => {
    if (!target) setPicking(false)
  }, [target])
  if (!target) return null
  const main: Shown = { type: target.type, ref: target.ref }
  if (target.beside) return <Split left={main} right={target.beside} />
  return (
    <div className="reader" role="dialog" aria-modal="true" onMouseDown={e => e.target === e.currentTarget && board.expand(null)}>
      <SideContext.Provider value={{ close: () => board.expand(null), replace: t => board.expand(t), compare: () => setPicking(true) }}>
        <Page t={main} />
      </SideContext.Provider>
      <ComparePicker open={picking} onClose={() => setPicking(false)} exclude={main} onPick={t => board.expand({ ...main, beside: t })} />
    </div>
  )
}

function Page({ t }: { t: Shown }) {
  return t.type === 'item' ? <ItemPage id={t.ref} /> : <NotePage path={t.ref} />
}

const FRAC_KEY = 'cockpit.compare.split'
const LINK_KEY = 'cockpit.compare.linked'
const readFrac = () => {
  try {
    const f = Number(localStorage.getItem(FRAC_KEY))
    return f >= 0.2 && f <= 0.8 ? f : 0.5
  } catch {
    return 0.5
  }
}

/** Two pages side by side. */
function Split({ left, right }: { left: Shown; right: Shown }) {
  const board = useBoard()
  const [frac, setFrac] = useState(readFrac)
  const [linked, setLinked] = useState(() => {
    try {
      return localStorage.getItem(LINK_KEY) === '1'
    } catch {
      return false
    }
  })
  const [diff, setDiff] = useState(false)
  const [picking, setPicking] = useState<'left' | 'right' | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const L = useRef<HTMLDivElement>(null)
  const R = useRef<HTMLDivElement>(null)
  const show = (l: Shown | null, r: Shown | null) => board.expand(l && r ? { ...l, beside: r } : l || r)
  const toggleLinked = () =>
    setLinked(v => {
      try {
        localStorage.setItem(LINK_KEY, v ? '0' : '1')
      } catch {}
      return !v
    })

  // scrolling together: the other side follows to the same point of its own length (so two versions of one document,
  // one a little longer, stay level); the side being scrolled leads until it stops
  useEffect(() => {
    const a = L.current
    const b = R.current
    if (!linked || diff || !a || !b) return
    let lead: HTMLElement | null = null
    let until = 0
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      const now = performance.now()
      if (lead && lead !== from && now < until) return
      lead = from
      until = now + 120
      const max = from.scrollHeight - from.clientHeight
      to.scrollTop = (max > 0 ? from.scrollTop / max : 0) * (to.scrollHeight - to.clientHeight)
    }
    const fa = follow(a, b)
    const fb = follow(b, a)
    a.addEventListener('scroll', fa, { passive: true })
    b.addEventListener('scroll', fb, { passive: true })
    return () => {
      a.removeEventListener('scroll', fa)
      b.removeEventListener('scroll', fb)
    }
  }, [linked, diff, left.ref, right.ref])

  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !box.current) return
    e.preventDefault()
    const rect = box.current.getBoundingClientRect()
    let f = frac
    const move = (ev: PointerEvent) => setFrac((f = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width))))
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      document.body.classList.remove('col-resizing')
      try {
        localStorage.setItem(FRAC_KEY, String(f))
      } catch {}
    }
    document.body.classList.add('col-resizing')
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const even = () => {
    setFrac(0.5)
    try {
      localStorage.setItem(FRAC_KEY, '0.5')
    } catch {}
  }

  return (
    <div className="reader is-split" role="dialog" aria-modal="true" aria-label="Side by side">
      {diff ? (
        <div className="reader-side">
          <Differences left={left} right={right} onClose={() => setDiff(false)} />
        </div>
      ) : (
        <div ref={box} className="reader-halves">
          <div ref={L} className="reader-side" style={{ flexBasis: `${frac * 100}%` }}>
            <SideContext.Provider value={{ close: () => show(null, right), replace: t => (same(t, right) ? show(right, left) : show(t, right)), compare: () => setPicking('left') }}>
              <Page t={left} />
            </SideContext.Provider>
          </div>
          <div className="reader-divider" role="separator" aria-orientation="vertical" aria-label="Drag to make one side wider. Double-click to make them even." onPointerDown={drag} onDoubleClick={even} />
          <div ref={R} className="reader-side flex-1">
            <SideContext.Provider value={{ close: () => show(left, null), replace: t => (same(t, left) ? show(right, left) : show(left, t)), compare: () => setPicking('right') }}>
              <Page t={right} />
            </SideContext.Provider>
          </div>
        </div>
      )}
      <div className="compare-bar glass" role="toolbar" aria-label="Side by side">
        <IconButton icon={ArrowLeftRight} label="Swap sides" onClick={() => show(right, left)} />
        <IconButton icon={Link2} label={linked ? 'Scrolling together: click to scroll each on its own' : 'Scroll both together'} onClick={toggleLinked} active={linked} />
        <IconButton icon={Diff} label={diff ? 'Back to the two pages' : 'Show the differences'} onClick={() => setDiff(d => !d)} active={diff} />
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <IconButton icon={X} label="Close both (Esc)" onClick={() => board.expand(null)} />
      </div>
      <ComparePicker
        open={!!picking}
        onClose={() => setPicking(null)}
        exclude={picking === 'left' ? right : left}
        onPick={t => (picking === 'left' ? show(t, right) : show(left, t))}
        replacing
      />
    </div>
  )
}

/** The text of what's on a side, for showing the differences: a note as written, a file or page as its text. */
function textOf(r: ShownRead): string | null {
  if (r.entry.format === 'compare') return null
  if (typeof r.text === 'string') return r.text
  if (r.html) {
    const doc = new DOMParser().parseFromString(r.html, 'text/html')
    return [...doc.body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre, tr')]
      .filter(e => e.tagName === 'TR' || !e.closest('tr, li li'))
      .map(e => (e.tagName === 'TR' ? [...e.children].map(c => c.textContent?.trim() || '').join('\t') : e.textContent?.trim() || ''))
      .join('\n')
  }
  if (r.sheets) {
    const s = r.sheets[r.sheet ?? 0]
    return s?.rows ? s.rows.map(row => row.join('\t')).join('\n') : null
  }
  if (r.slides) return r.slides.map(s => [`Slide ${s.n}`, ...s.lines].join('\n')).join('\n\n')
  return null
}

function NoteText({ path, onText }: { path: string; onText: (t: string | null) => void }) {
  const note = useNote(path)
  useEffect(() => onText(note.status === 'loading' ? null : note.text), [note.text, note.status, onText])
  return null
}

function ItemText({ id, onText }: { id: string; onText: (t: string | null, title?: string) => void }) {
  useEffect(() => {
    get<ShownRead>(`/api/shown/${id}`).then(
      r => onText(textOf(r) ?? '\u0000', r.entry.title),
      () => onText('\u0000'),
    )
  }, [id, onText])
  return null
}

function useTitle(t: Shown) {
  const board = useBoard()
  if (t.type === 'item') return board.items.find(e => e.id === t.ref)?.title || 'File'
  const n = board.notes?.notes.find(x => x.path === t.ref)
  return n?.given || n?.title || noteKind(t.ref)
}

/** The two sides' text, line against line. */
function Differences({ left, right, onClose }: { left: Shown; right: Shown; onClose: () => void }) {
  const [a, setA] = useState<string | null>(null)
  const [b, setB] = useState<string | null>(null)
  const onA = useCallback((t: string | null) => setA(t), [])
  const onB = useCallback((t: string | null) => setB(t), [])
  const la = useTitle(left)
  const lb = useTitle(right)
  // \0 marks a side that has no text (a picture, a video, a PDF)
  const none = [a === '\u0000' && la, b === '\u0000' && lb].filter(Boolean)
  return (
    <div className="reader-page wide">
      {left.type === 'note' ? <NoteText path={left.ref} onText={onA} /> : <ItemText id={left.ref} onText={onA} />}
      {right.type === 'note' ? <NoteText path={right.ref} onText={onB} /> : <ItemText id={right.ref} onText={onB} />}
      <header className="reader-bar glass">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-muted-foreground">Differences</div>
          <div className="truncate text-[14px] font-medium">
            {la} <span className="text-muted-foreground">and</span> {lb}
          </div>
        </div>
        <IconButton icon={Columns2} label="Back to the two pages" onClick={onClose} />
      </header>
      <div className="reader-body">
        {none.length ? (
          <p className="text-[14px] text-muted-foreground">{none.join(' and ')} has no text to compare line by line. The two pages side by side are the way to compare it.</p>
        ) : a === null || b === null ? (
          <p className="text-[13.5px] text-muted-foreground">Reading both…</p>
        ) : (
          <CompareView before={a} after={b} leftName={la} rightName={lb} tags={['Left', 'Right']} />
        )}
      </div>
    </div>
  )
}

/** Picks what goes on the other side: a card on this board, anything kept, a note, or a pasted path or link. */
function ComparePicker({ open, onClose, exclude, onPick, replacing }: { open: boolean; onClose: () => void; exclude: Shown; onPick: (t: Shown) => void; replacing?: boolean }) {
  const board = useBoard()
  const [q, setQ] = useState('')
  useEffect(() => {
    if (open) setQ('')
  }, [open])
  const key = useStore(s =>
    JSON.stringify(
      s.nodes
        .filter(n => (n.type === 'item' || n.type === 'note') && spaceOf(n as CardNode) === board.space)
        .map(n => [n.type, (n.data as CardNode['data']).ref]),
    ),
  )
  const onBoard = useMemo(() => (JSON.parse(key) as [Shown['type'], string][]).map(([type, ref]) => ({ type, ref })).filter(t => !same(t, exclude)), [key, exclude])
  const titleOf = (t: Shown) => {
    if (t.type === 'item') return board.items.find(e => e.id === t.ref)?.title || 'File'
    const n = board.notes?.notes.find(x => x.path === t.ref)
    return n?.given || n?.title || n?.excerpt?.split('\n')[0] || noteKind(t.ref)
  }
  const pick = (t: Shown) => {
    onClose()
    onPick(t)
  }
  const value = q.trim()
  const pasted = isUrl(value) || isPath(value)
  const openPasted = async () => {
    onClose()
    try {
      const e = await post<{ id: string }>('/api/shown', isUrl(value) ? { url: value } : { path: unquote(value) })
      onPick({ type: 'item', ref: e.id })
    } catch (err: any) {
      board.toast(err.message)
    }
  }
  const notes = (board.notes?.notes || []).filter(n => !(exclude.type === 'note' && exclude.ref === n.path)).slice(0, 60)
  return (
    <CommandDialog open={open} onOpenChange={o => !o && onClose()} title={replacing ? 'Put something else on this side' : 'Compare with…'} description="A card on this board, anything kept, a note, or a path or link to paste" className="palette" showCloseButton={false}>
      <CommandInput value={q} onValueChange={setQ} placeholder={replacing ? 'Put something else on this side…' : 'Compare with… (a card, a note, or paste a path or link)'} />
      <CommandList>
        <CommandEmpty>Nothing by that name.</CommandEmpty>
        {pasted && (
          <CommandGroup heading="Pasted">
            <CommandItem forceMount value={`__open ${value}`} onSelect={openPasted}>
              <SquareSplitHorizontal strokeWidth={1.5} />
              <span className="truncate">{value}</span>
            </CommandItem>
          </CommandGroup>
        )}
        {onBoard.length > 0 && (
          <CommandGroup heading="On this board">
            {onBoard.map(t => {
              const e = t.type === 'item' ? board.items.find(x => x.id === t.ref) : null
              const Icon = e ? iconFor(e) : NotebookPen
              return (
                <CommandItem key={`b${t.type}${t.ref}`} value={`board ${t.type} ${t.ref} ${titleOf(t)}`} onSelect={() => pick(t)}>
                  <Icon strokeWidth={1.5} />
                  <span className="truncate">{titleOf(t)}</span>
                  <CommandShortcut>{e ? kindLabel(e) : noteKind(t.ref)}</CommandShortcut>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        {board.items.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Kept">
              {board.items
                .filter(e => !(exclude.type === 'item' && exclude.ref === e.id))
                .slice(0, 80)
                .map(e => {
                  const Icon = iconFor(e)
                  return (
                    <CommandItem key={e.id} value={`item ${e.id} ${e.title}`} keywords={[e.path, e.url || '', e.siteName || '']} onSelect={() => pick({ type: 'item', ref: e.id })}>
                      <Icon strokeWidth={1.5} />
                      <span className="truncate">{e.title}</span>
                      <CommandShortcut>
                        {kindLabel(e)} · {ago(e.shownAt || e.createdAt)}
                      </CommandShortcut>
                    </CommandItem>
                  )
                })}
            </CommandGroup>
          </>
        )}
        {notes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {notes.map(n => (
                <CommandItem key={n.path} value={`note ${n.path} ${n.title}`} keywords={[n.excerpt || '']} onSelect={() => pick({ type: 'note', ref: n.path })}>
                  {n.folder === 'journal' ? <BookOpenText strokeWidth={1.5} /> : <NotebookPen strokeWidth={1.5} />}
                  <span className="truncate">{n.title}</span>
                  <CommandShortcut>{ago(n.mtime)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}

function Bar({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  const board = useBoard()
  const side = useContext(SideContext)
  const split = !!board.expanded?.beside
  return (
    <header className="reader-bar glass">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] text-muted-foreground">{kicker}</div>
        <div className="truncate text-[14px] font-medium">{title}</div>
      </div>
      <div className="flex items-center gap-0.5">
        {children}
        {side?.compare && (
          <>
            <span className="mx-1 h-5 w-px bg-ink/10" />
            <IconButton icon={SquareSplitHorizontal} label={split ? 'Put something else on this side' : 'Compare with… (side by side)'} onClick={side.compare} />
          </>
        )}
        <IconButton icon={X} label={split ? 'Close this side' : 'Close (Esc)'} onClick={() => (side ? side.close() : board.expand(null))} />
      </div>
    </header>
  )
}

function ItemPage({ id }: { id: string }) {
  const board = useBoard()
  const side = useContext(SideContext)
  const split = !!board.expanded?.beside
  const [read, setRead] = useState<ShownRead | null>(null)
  const load = useCallback(() => get<ShownRead>(`/api/shown/${id}`).then(setRead, e => board.toast(e.message)), [id, board])
  useEffect(() => {
    load()
  }, [load])
  // a link saved a moment ago may still be loading in the background: show the article as soon as it's in
  useEvent('shown', () => {
    if (read?.entry.format === 'link' && read.entry.readingAt) load()
  })
  const { native, readAgain, actions } = useItemActions(read, load)
  if (!read) return null
  const e = read.entry
  const wide = ['compare', 'csv', 'code', 'text', 'json', 'pdf', 'html', 'image', 'diff', 'video', 'sheet'].includes(e.format)
  return (
    <div className={cn('reader-page', wide && 'wide')}>
      <Bar kicker={[kindLabel(e), e.kind === 'link' ? e.siteName : e.kind === 'file' ? placeOf(e.path) : e.from, ago(e.shownAt || e.createdAt)].filter(Boolean).join(' · ')} title={e.title}>
        {actions
          .filter(a => !a.hidden)
          // side by side there's room for fewer buttons: the ones that open it elsewhere stay
          .slice(0, split ? 3 : undefined)
          .map(a => (
            <IconButton key={a.label} icon={a.icon} label={a.label} onClick={a.run} />
          ))}
      </Bar>
      <div className={cn('reader-body', ['pdf', 'html'].includes(e.format) && 'tall')}>
        {e.kind === 'link' && e.format === 'article' && (
          <>
            <h1 className="reader-title">{e.title}</h1>
            <p className="mb-8 text-[13.5px] text-muted-foreground">
              {[e.siteName, e.byline, e.words ? `${Math.max(1, Math.round(e.words / 230))} min read` : ''].filter(Boolean).join(' · ')}
            </p>
          </>
        )}
        <Viewer read={read} onOpenNative={() => native('default')} onOpenPath={n => (side ? side.replace({ type: 'item', ref: n.id }) : board.expand({ type: 'item', ref: n.id }))} onReadAgain={readAgain} />
      </div>
    </div>
  )
}

function NotePage({ path }: { path: string }) {
  const board = useBoard()
  const side = useContext(SideContext)
  const note = useNote(path)
  const journal = useJournalSync(path.startsWith('journal/'))
  // an earlier journal day opens to read; Write is one click away
  const [mode, setMode] = useState<NoteMode>(() => (dayOf(path) && dayOf(path) < dayOf(todayPage()) ? 'read' : 'write'))
  return (
    <div className={cn('reader-page', mode === 'split' && 'wide')}>
      <Bar kicker={[noteKind(path), note.statusText, journal.text].filter(Boolean).join(' · ')} title={board.notes?.notes.find(n => n.path === path)?.given || noteTitle(note.text, path)}>
        {journal.enabled && (
          <IconButton icon={RefreshCw} label="Sync with Kokoro now" onClick={() => note.save().then(journal.syncNow).then(board.toast)} active={journal.sync?.syncing} />
        )}
        <IconButton icon={Pencil} label="Write" onClick={() => setMode('write')} active={mode === 'write'} />
        <IconButton icon={Columns2} label="Write and read side by side" onClick={() => setMode('split')} active={mode === 'split'} />
        <IconButton icon={BookOpen} label="Read" onClick={() => setMode('read')} active={mode === 'read'} />
        <IconButton
          icon={Archive}
          label="Archive note"
          onClick={async () => {
            await note.save()
            await post('/api/notes/archive', { path })
            if (side) side.close()
            else board.expand(null)
            board.toast('Archived (kept in .archive)')
          }}
        />
      </Bar>
      <div className="reader-body">
        <NotePane path={path} mode={mode} note={note} autoFocus={!board.expanded?.beside} />
      </div>
    </div>
  )
}
