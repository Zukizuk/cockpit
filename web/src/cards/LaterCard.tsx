// Later: links and short notes kept to check when there's time. Paste or share a link and it lands here, read in
// the background so it can be read in Cockpit; open it in the browser with one click, or move it along:
// to check → reading → done. A note is something to do or remember, not to read: a click edits it, and it never
// goes to Reading. Each row is one line: on hover its main buttons cover the right end (as on Outputs), with the
// rest under ⋯; right-click has them all.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BookOpen, Bookmark, Check, Copy, ExternalLink, Globe, LayoutGrid, MoreHorizontal, Pencil, Pin, RotateCcw, StickyNote, X, type LucideIcon } from 'lucide-react'
import { get, openOutside, type LaterState, type ShownEntry, type ShownRead } from '../api'
import { iconFor, placeOf } from '../components/Viewer'
import { ago } from '../lib'
import { useBoard, type CardNode } from '../board'
import { dragToBoard } from '../drag'
import { CardShell } from './CardShell'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TABS: { value: LaterState; label: string }[] = [
  { value: 'todo', label: 'To check' },
  { value: 'reading', label: 'Reading' },
  { value: 'done', label: 'Done' },
]

/** Still being read in the background (given up on after two minutes, e.g. if Cockpit restarted meanwhile). */
const stillReading = (e: ShownEntry) => !!e.readingAt && Date.now() - Date.parse(e.readingAt) < 120_000

/** A note kept (not a page or a file): something to do or remember. */
const isNote = (e: ShownEntry) => e.kind === 'content' && e.from === 'you'

/** Where it is on the list. A note is never "being read" (one opened before this rule counts as to check). */
export const laterState = (e: ShownEntry): LaterState | undefined => (e.later === 'reading' && isNote(e) ? 'todo' : e.later)

export function laterCounts(items: ShownEntry[]) {
  const c: Record<LaterState, number> = { todo: 0, reading: 0, done: 0 }
  for (const e of items) {
    const s = laterState(e)
    if (s) c[s]++
  }
  return c
}

/** The words of a kept note (the list only carries its first line). */
const noteText = (e: ShownEntry) => get<ShownRead>(`/api/shown/${e.id}`).then(r => r.text ?? e.title, () => e.title)

/** The address without the scheme, for a link whose page gave no name: where on the site it goes. */
function pathOf(url = '') {
  try {
    const u = new URL(url)
    const p = `${u.pathname}${u.search}`.replace(/^\/$/, '')
    return p ? decodeURIComponent(p) : ''
  } catch {
    return ''
  }
}

/** more: only under ⋯ (and right-click), not among the row's hover buttons. */
type RowAction = { label: string; icon: LucideIcon; run: () => void; hidden?: boolean; danger?: boolean; gap?: boolean; more?: boolean }

function MiniButton({ a }: { a: RowAction }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={a.label}
          onClick={ev => {
            ev.stopPropagation()
            a.run()
          }}
          className="later-btn"
        >
          <a.icon className="size-[14px]" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{a.label}</TooltipContent>
    </Tooltip>
  )
}

/** A note's words, edited in the row: Enter keeps them (Shift+Enter for a new line), Esc leaves them as they were. */
function NoteEdit({ e, onDone }: { e: ShownEntry; onDone: () => void }) {
  const board = useBoard()
  const [text, setText] = useState<string | null>(null)
  const [was, setWas] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    noteText(e).then(t => {
      setWas(t)
      setText(t)
      // the cursor goes in, at the end, once the words are there
      requestAnimationFrame(() => {
        const el = box.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    })
  }, [e])
  const keep = async () => {
    const v = (text ?? '').trim()
    if (text !== null && v && v !== was.trim()) await board.setLaterText(e.id, v)
    onDone()
  }
  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      keep()
    } else if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      onDone()
    }
  }
  return (
    <div className="later-row is-editing">
      <StickyNote className="later-icon" strokeWidth={1.5} />
      <textarea
        ref={box}
        className="later-edit"
        aria-label="The note"
        value={text ?? ''}
        placeholder={text === null ? '' : 'Write the note…'}
        readOnly={text === null}
        onChange={ev => setText(ev.target.value)}
        onKeyDown={onKey}
        onBlur={keep}
      />
    </div>
  )
}

function LaterRow({ e }: { e: ShownEntry }) {
  const board = useBoard()
  const [mode, setMode] = useState<'' | 'naming' | 'editing'>('')
  const [menuOpen, setMenuOpen] = useState(false)
  const isLink = e.kind === 'link'
  const isFile = e.kind === 'file'
  const note = isNote(e)
  const state = laterState(e)
  const read = () => {
    board.expand({ type: 'item', ref: e.id })
    if (state === 'todo') board.setLater(e.id, 'reading')
  }
  const openFile = () => openOutside({ kind: 'shown', id: e.id }).catch(err => board.toast(err.message))
  const copyIt = async () => {
    if (isLink) return board.copy(e.url || '', 'Link copied')
    if (isFile) return board.copy(e.path, 'Path copied')
    board.copy(await noteText(e), 'Note copied')
  }
  const toSticky = async () => {
    await board.newSticky(await noteText(e))
    await board.setLater(e.id, null)
  }
  const takeOff = async () => {
    const before = e.later ?? 'todo'
    await board.setLater(e.id, null)
    board.toast('Taken off Later', { label: 'Undo', run: () => board.setLater(e.id, before) })
  }
  // a page that couldn't be read (or isn't yet) only opens in the browser
  const readable = !isLink || e.format !== 'link'

  const actions: RowAction[] = [
    { label: 'Open in the browser', icon: ExternalLink, run: () => board.openLink(e.url || ''), hidden: !isLink },
    { label: 'Open in its own program', icon: ExternalLink, run: openFile, hidden: !isFile },
    { label: 'Read here', icon: BookOpen, run: read, hidden: note || !readable },
    { label: note ? 'Copy the note' : isLink ? 'Copy link' : 'Copy path', icon: Copy, run: copyIt, hidden: !note && !isLink && !isFile },
    { label: note ? 'Edit' : 'Rename', icon: Pencil, run: () => setMode(note ? 'editing' : 'naming'), more: !note },
    { label: 'Pin to Quick access', icon: Pin, run: () => board.pin(isLink ? { url: e.url, title: e.title } : { path: e.path, title: e.title }), hidden: !isLink && !isFile, more: true },
    { label: 'Put on the board', icon: LayoutGrid, run: () => board.addCard('item', e.id), hidden: note, more: true },
    { label: 'Move to a sticky note', icon: StickyNote, run: toSticky, hidden: !note },
    state === 'done'
      ? { label: 'Back to To check', icon: RotateCcw, run: () => board.setLater(e.id, 'todo'), gap: true }
      : { label: 'Done', icon: Check, run: () => board.setLater(e.id, 'done'), gap: true },
    { label: 'Take off the list', icon: X, run: takeOff, danger: true },
  ].filter(a => !a.hidden)
  // the menus hold only what isn't already a button on the row
  const menuActions = actions.filter(a => a.more)

  if (mode === 'editing') return <NoteEdit e={e} onDone={() => setMode('')} />

  const Icon = isLink ? Globe : isFile ? iconFor(e) : StickyNote
  // a link named after its own address says where on the site it goes instead of repeating the site
  const unnamed = isLink && (e.title === e.siteName || e.title === e.url || !!e.autoTitle)
  const where = isLink ? (unnamed && pathOf(e.url)) || e.siteName : isFile ? placeOf(e.path) : 'Note'
  const status = isLink && e.format === 'link' ? (stillReading(e) ? 'Getting the page…' : e.readError ? 'Browser only' : '') : ''
  const when = state === 'done' ? `done ${ago(e.doneAt)}` : ago(e.laterAt || e.createdAt)
  const old = state === 'todo' && Date.now() - Date.parse(e.laterAt || e.createdAt) > 3 * 86_400_000
  const open = () => (isLink ? board.openLink(e.url || '') : note ? setMode('editing') : read())

  const row = (
        <div className={cn('later-row', menuOpen && 'is-menu')} onDoubleClick={() => !note && readable && read()} {...dragToBoard({ kind: 'item', target: e.id, title: e.title })}>
          <Icon className="later-icon" strokeWidth={1.5} />
          {mode === 'naming' ? (
              <Input
                autoFocus
                defaultValue={e.title}
                aria-label="Name"
                className="h-7 min-w-0 flex-1 px-2 text-[13.5px]"
                onFocus={ev => ev.currentTarget.select()}
                onKeyDown={ev => {
                  if (ev.key === 'Enter') {
                    board.renameItem(e.id, ev.currentTarget.value)
                    setMode('')
                  } else if (ev.key === 'Escape') {
                    ev.stopPropagation()
                    setMode('')
                  }
                }}
                onBlur={ev => {
                  if (ev.currentTarget.value.trim() && ev.currentTarget.value !== e.title) board.renameItem(e.id, ev.currentTarget.value)
                  setMode('')
                }}
              />
            ) : (
            <>
              <button type="button" className={cn('later-title', state === 'done' && 'is-done')} onClick={open} title={isLink ? e.url : e.title}>
                {e.title}
              </button>
              <span className={cn('later-detail', old && 'is-old')} title={[where, when, status, old && 'waiting a while'].filter(Boolean).join(' · ')}>
                {[where, when, status].filter(Boolean).join(' · ')}
              </span>
              <div className="later-actions">
                {actions
                  .filter(a => !a.more)
                  .map(a => (
                    <MiniButton key={a.label} a={a} />
                  ))}
                {menuActions.length > 0 && (
                <DropdownMenu onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="More" className="later-btn" onClick={ev => ev.stopPropagation()}>
                      <MoreHorizontal className="size-[14px]" strokeWidth={1.75} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    {menuActions.map((a, i) => (
                      <div key={a.label}>
                        {a.gap && i > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem variant={a.danger ? 'destructive' : 'default'} onSelect={() => a.run()}>
                          <a.icon strokeWidth={1.75} />
                          {a.label}
                        </DropdownMenuItem>
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                )}
              </div>
            </>
          )}
        </div>
  )
  // a note's row has no menu left (its buttons are all there is): a right-click there gets the card's menu
  if (!menuActions.length) return row
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {menuActions.map((a, i) => (
          <div key={a.label}>
            {a.gap && i > 0 && <ContextMenuSeparator />}
            <ContextMenuItem variant={a.danger ? 'destructive' : 'default'} onSelect={() => a.run()}>
              <a.icon strokeWidth={1.75} />
              {a.label}
            </ContextMenuItem>
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function LaterCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const [tab, setTab] = useState<LaterState>('todo')
  const [text, setText] = useState('')
  const kept = board.items.filter(e => e.later)
  const counts = laterCounts(kept)
  const rows = kept
    .filter(e => laterState(e) === tab)
    .sort((a, b) => String(tab === 'done' ? b.doneAt : b.laterAt).localeCompare(String(tab === 'done' ? a.doneAt : a.laterAt)))
    .slice(0, tab === 'done' ? 50 : 200)

  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={Bookmark}
      title="Later"
      subtitle={`${counts.todo} to check${counts.reading ? ` · ${counts.reading} reading` : ''}`}
      actions={[{ label: 'Remove from board', icon: X, run: () => board.removeCard(id) }]}
      bodyClassName="later-body"
    >
      <div className="grid grid-cols-1 gap-2.5">
        <form
          onSubmit={async ev => {
            ev.preventDefault()
            const v = text.trim()
            if (!v) return
            await board.saveLater(/^https?:\/\/\S+$/i.test(v) ? { url: v } : { text: v })
            setText('')
            setTab('todo')
          }}
        >
          <Input data-typeto value={text} onChange={ev => setText(ev.target.value)} placeholder="Add a link or a note…" />
        </form>
        <ToggleGroup type="single" value={tab} onValueChange={v => v && setTab(v as LaterState)} variant="outline" size="sm" className="w-full">
          {TABS.map(t => (
            <ToggleGroupItem key={t.value} value={t.value} className="flex-1 gap-1.5 px-3">
              {t.label}
              {counts[t.value] > 0 && <span className="text-muted-foreground tabular-nums">{counts[t.value]}</span>}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {!rows.length && (
          <p className="px-1 py-2 text-[13.5px] text-muted-foreground">{tab === 'todo' ? 'Nothing to check.' : tab === 'reading' ? 'Nothing being read.' : 'Nothing done yet.'}</p>
        )}
        <div className="later-list">
          {rows.map(e => (
            <LaterRow key={e.id} e={e} />
          ))}
        </div>
      </div>
    </CardShell>
  )
}
