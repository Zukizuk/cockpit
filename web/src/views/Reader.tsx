// Full screen for one card: the board stays behind, blurred, and Esc brings it back.
import { useCallback, useEffect, useState } from 'react'
import { Archive, BookOpen, Columns2, Pencil, RefreshCw, X } from 'lucide-react'
import { get, post, type ShownRead } from '../api'
import { ago, useEvent } from '../lib'
import { useBoard } from '../board'
import { useItemActions } from '../cards/ItemCard'
import { IconButton } from '../cards/CardShell'
import { NotePane, noteKind, noteTitle, useNote, type NoteMode } from '../components/NotePane'
import { dayOf, todayPage, useJournalSync } from '../journal'
import { Viewer, folderOf, kindLabel } from '../components/Viewer'
import { cn } from '@/lib/utils'

export function Reader() {
  const board = useBoard()
  const target = board.expanded
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
  if (!target) return null
  return (
    <div className="reader" role="dialog" aria-modal="true" onMouseDown={e => e.target === e.currentTarget && board.expand(null)}>
      {target.type === 'item' ? <ItemPage id={target.ref} /> : <NotePage path={target.ref} />}
    </div>
  )
}

function Bar({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  const board = useBoard()
  return (
    <header className="reader-bar glass">
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] text-muted-foreground">{kicker}</div>
        <div className="truncate text-[14px] font-medium">{title}</div>
      </div>
      <div className="flex items-center gap-0.5">
        {children}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <IconButton icon={X} label="Close (Esc)" onClick={() => board.expand(null)} />
      </div>
    </header>
  )
}

function ItemPage({ id }: { id: string }) {
  const board = useBoard()
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
      <Bar kicker={[kindLabel(e), e.kind === 'link' ? e.siteName : e.kind === 'file' ? folderOf(e.path) : e.from, ago(e.shownAt || e.createdAt)].filter(Boolean).join(' · ')} title={e.title}>
        {actions
          .filter(a => !a.hidden)
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
        <Viewer read={read} onOpenNative={() => native('default')} onOpenPath={n => board.expand({ type: 'item', ref: n.id })} onReadAgain={readAgain} />
      </div>
    </div>
  )
}

function NotePage({ path }: { path: string }) {
  const board = useBoard()
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
            board.expand(null)
            board.toast('Archived (kept in .archive)')
          }}
        />
      </Bar>
      <div className="reader-body">
        <NotePane path={path} mode={mode} note={note} autoFocus />
      </div>
    </div>
  )
}
