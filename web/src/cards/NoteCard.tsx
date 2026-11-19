// A note on the board. A sticky note (any note that isn't a journal page or a draft) is paper you write on
// directly: click anywhere in it and type, or select it and just start typing. A journal page or a draft is a card
// that opens ready to write too, with Read one click away. Both save as you type. A note has no title until it's
// given one: click the top of the card (or F2, or ⋯ > Add a title). The title lives only there, kept beside the
// note, so the note itself stays plain writing.
import { useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Archive, BookOpen, CalendarCheck, ChevronLeft, ChevronRight, Code2, Copy, ExternalLink, Heading, Lock, LockOpen, Maximize2, NotebookPen, Pencil, Pin, RefreshCw, StickyNote, X } from 'lucide-react'
import { editorLabel, openOutside } from '../api'
import { isSticky, useBoard, type CardNode } from '../board'
import { NotePane, noteKind, noteTitle, useNote } from '../components/NotePane'
import { post } from '../api'
import { onEvent } from '../lib'
import { CardShell, IconButton, type CardAction } from './CardShell'
import { dayLabel, dayOf, journalPages, openToday, useJournalSync, useTodayPage } from '../journal'
import { cn } from '@/lib/utils'

export function NoteCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const note = useNote(data.ref)
  const sticky = isSticky('note', data.ref)
  const journal = useJournalSync(data.ref.startsWith('journal/'))
  const [reading, setReading] = useState(false)
  // only a note put on the board just now takes the cursor (not every note card when the board loads)
  const [fresh] = useState(() => !!data.born && Date.now() - data.born < 2500)
  const listed = board.notes?.notes.find(n => n.path === data.ref)?.given ?? ''
  // the title just typed, until the notes list catches up
  const [typed, setTyped] = useState<string | null>(null)
  useEffect(() => setTyped(null), [listed])
  const own = typed ?? listed
  const title = own || noteTitle(note.text, data.ref)
  const [naming, setNaming] = useState(false)
  const expand = () => board.expand({ type: 'note', ref: data.ref })

  // a journal day: always today unless you step back; an earlier day is read-only until unlocked
  const day = dayOf(data.ref)
  const today = useTodayPage()
  const past = !!day && day < dayOf(today)
  const [unlocked, setUnlocked] = useState(false)
  useEffect(() => setUnlocked(false), [data.ref])
  const locked = past && !unlocked
  const pages = day ? journalPages((board.notes?.notes || []).map(n => n.path), today) : []
  const at = pages.indexOf(data.ref)
  const goTo = async (ref: string) => {
    try {
      await note.save()
      board.retarget(id, ref === today ? await openToday() : ref)
    } catch (e: any) {
      board.toast(e.message)
    }
  }
  // a new day moves the card to the new page (only once the day has changed, so a past day you're reading stays put
  // until tomorrow; the day it last saw is kept in this browser)
  useEffect(() => {
    if (!day) return
    const key = `cockpit.journal-day.${id}`
    let seen: string | null = null
    try {
      seen = localStorage.getItem(key)
      localStorage.setItem(key, today)
    } catch {}
    if (seen && seen !== today && data.ref !== today) goTo(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, !!day])
  // F2 on the board, with this card selected
  useEffect(() => onEvent('note-rename', (d: { id?: string }) => d.id === id && setNaming(true)), [id])
  const keepTitle = (v: string | null) => {
    setNaming(false)
    if (v === null || v.trim() === own) return
    setTyped(v.trim())
    post('/api/notes/title', { path: data.ref, title: v }).catch(e => (setTyped(null), board.toast(e.message)))
  }
  // the top of the card: the title (or, on hover, room for one); a click names it
  const titleSlot = naming ? (
    <TitleInput value={own} onDone={keepTitle} />
  ) : (
    <TitleButton title={own} empty={day ? 'Untitled Journal' : 'Untitled'} always={!sticky} onName={() => setNaming(true)} />
  )

  const actions: CardAction[] = [
    { label: 'Open full screen', icon: Maximize2, run: expand, keys: 'Space' },
    { label: own ? 'Rename' : 'Add a title', icon: Heading, run: () => setNaming(true), keys: 'F2' },
    ...(journal.enabled ? [{ label: 'Sync with Kokoro now', icon: RefreshCw, run: () => note.save().then(journal.syncNow).then(board.toast) }] : []),
    { label: 'Copy the text', icon: Copy, run: () => board.copy(note.text.trim(), 'Copied'), hidden: !note.text.trim() },
    { label: 'Pin to Quick access', icon: Pin, run: () => board.pin({ note: data.ref, title }) },
    {
      label: editorLabel(board.prefs.editor),
      icon: board.prefs.editor === 'vscode' ? Code2 : ExternalLink,
      run: () => note.save().then(() => openOutside({ kind: 'note', path: data.ref, how: 'editor' })).catch(e => board.toast(e.message)),
    },
    {
      label: 'Archive note',
      icon: Archive,
      danger: true,
      gap: true,
      run: async () => {
        await note.save()
        await note.archive()
        board.removeCard(id, { quiet: true })
        board.toast('Archived (kept in .archive)')
      },
    },
    { label: 'Remove from board', icon: X, run: () => board.removeCard(id), keys: 'Del' },
  ]

  if (sticky)
    return (
      <CardShell
        selected={!!selected}
        pulse={data.pulse}
        born={data.born}
        icon={StickyNote}
        title={title}
        sticky={data.color || board.prefs.stickyColor}
        stripText={note.status === 'conflict' || note.status === 'error' ? note.statusText : titleSlot}
        onExpand={expand}
        quick={<IconButton icon={Maximize2} label="Open full screen" onClick={expand} />}
        actions={actions}
        bodyClassName="sticky-body"
      >
        <NotePane path={data.ref} mode="write" note={note} compact autoFocus={fresh} focusId={id} placeholder="Write…" />
      </CardShell>
    )

  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={NotebookPen}
      title={titleSlot}
      subtitle={[day ? (data.ref === today ? 'Today' : dayLabel(data.ref)) : noteKind(data.ref), locked && 'Read only', note.statusText, journal.text].filter(Boolean).join(' · ')}
      onExpand={expand}
      quick={
        <>
          {day && at > 0 && <IconButton icon={ChevronLeft} label="Earlier" onClick={() => goTo(pages[at - 1])} />}
          {day && at >= 0 && at < pages.length - 1 && <IconButton icon={ChevronRight} label="Later" onClick={() => goTo(pages[at + 1])} />}
          {past && <IconButton icon={CalendarCheck} label="Back to today" onClick={() => goTo(today)} />}
          {past ? (
            <IconButton icon={locked ? Lock : LockOpen} label={locked ? 'Unlock to edit' : 'Lock again'} active={!locked} onClick={() => setUnlocked(!unlocked)} />
          ) : (
            <IconButton icon={reading ? Pencil : BookOpen} label={reading ? 'Write' : 'Read'} onClick={() => setReading(!reading)} />
          )}
          <IconButton icon={Maximize2} label="Open full screen" onClick={expand} />
        </>
      }
      actions={actions}
    >
      <NotePane path={data.ref} mode={locked || (!past && reading) ? 'read' : 'write'} note={note} compact autoFocus={fresh && !locked} focusId={id} />
    </CardShell>
  )
}

/** The title, or a faint "Untitled" where one can go (on a sticky note, only on hover). A click names it; a
 * double-click still opens the note. */
function TitleButton({ title, empty, always, onName }: { title: string; empty: string; always: boolean; onName: () => void }) {
  const timer = useRef<number>(0)
  return (
    <button
      type="button"
      className={cn('note-title', !title && 'is-empty', always && 'is-always')}
      onClick={e => {
        e.stopPropagation()
        // wait a moment: the first click of a double-click (full screen) shouldn't start naming
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(onName, 220)
      }}
      onDoubleClick={() => window.clearTimeout(timer.current)}
    >
      {title || empty}
    </button>
  )
}

/** The title being typed: Enter keeps it (empty takes the title away), Esc leaves it as it was. */
function TitleInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const born = useRef(Date.now())
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  const grab = () => {
    const el = ref.current
    if (el && document.activeElement !== el) {
      el.focus()
      el.select()
    }
  }
  // a closing menu hands focus back to its button a moment later, so take it again
  useEffect(() => {
    grab()
    const timers = [0, 60, 160, 320].map(ms => window.setTimeout(grab, ms))
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [])
  return (
    <input
      ref={ref}
      defaultValue={value}
      placeholder="Untitled"
      aria-label="Title"
      className="note-title-input nodrag"
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={e => (Date.now() - born.current < 450 ? window.setTimeout(grab, 0) : finish(e.currentTarget.value))}
    />
  )
}
