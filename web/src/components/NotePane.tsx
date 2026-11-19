// A note (journal page, thought or note) that saves as you type and never overwrites a change made elsewhere.
// The same pane sits in a card on the board and full screen.
import { useMemo, useSyncExternalStore } from 'react'
import { get, post, put, type NoteRead, type NoteSaved } from '../api'
import { clock, onEvent } from '../lib'
import { Editor } from './Editor'
import { Markdown } from './Markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type NoteMode = 'write' | 'split' | 'read'
type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

function joinRel(notePath: string, href: string) {
  const clean = decodeURIComponent(href.split('#')[0].split('?')[0])
  const parts = notePath.split('/').slice(0, -1)
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

export function noteKind(path: string) {
  return path.startsWith('journal/')
    ? 'Journal'
    : path.startsWith('thoughts/')
      ? 'Thought'
      : path.startsWith('drafts/')
        ? 'Draft'
        : path.startsWith('stickies/')
          ? 'Sticky note'
          : 'Note'
}

const HEADING = /^\s{0,3}#{1,3}\s+(.+?)\s*$/

/** A note's own title: a heading on its first line of text. A note has none until one is given. */
export function titleLine(text: string): { index: number; title: string } {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex(l => l.trim())
  const m = index >= 0 ? HEADING.exec(lines[index]) : null
  return m ? { index, title: m[1] } : { index: -1, title: '' }
}

/** Its title; a note without one is called by its first line of words. */
export function noteTitle(text: string, path: string) {
  const heading = titleLine(text).title
  if (heading) return heading
  const line = text
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '').trim())
    .find(l => l && !/^[-=*_#`~\s]+$/.test(l))
  if (line) return line.length > 60 ? `${line.slice(0, 57)}…` : line
  return path.startsWith('stickies/') ? 'Sticky note' : path.split('/').pop()?.replace(/\.(md|markdown|txt)$/i, '') || path
}

interface Snap {
  text: string
  status: Status
  savedAt: number
  disk: { text: string; mtime: number } | null
  error: string
}

/**
 * One copy of a note, shared by everything showing it (its card and full screen), so two editors of the same
 * note never trip over each other. Disk changes are compared by content, so the app's own saves (and a sync
 * that wrote the same text) never count as "changed elsewhere"; only a real edit elsewhere over unsaved typing does.
 */
class NoteStore {
  snap: Snap = { text: '', status: 'loading', savedAt: 0, disk: null, error: '' }
  private subs = new Set<() => void>()
  private base: number | null = null
  private latest = ''
  private saved = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> | null = null
  private recheck = false
  private stopEvents: (() => void) | null = null

  constructor(readonly path: string) {}

  private set(p: Partial<Snap>) {
    this.snap = { ...this.snap, ...p }
    this.subs.forEach(fn => fn())
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    if (this.subs.size === 1) {
      stores.set(this.path, this)
      this.stopEvents = onEvent('notes', (d: { path?: string }) => {
        if (!d.path || d.path.replace(/\\/g, '/') === this.path) this.fromDisk()
      })
      if (this.snap.status === 'loading' || this.snap.status === 'error') this.load()
      else this.fromDisk()
    }
    return () => {
      this.subs.delete(fn)
      if (this.subs.size) return
      // last one gone: write what's pending, then forget this copy
      this.save()
      this.stopEvents?.()
      stores.delete(this.path)
    }
  }

  private async read() {
    return get<NoteRead>(`/api/notes/file?p=${encodeURIComponent(this.path)}`)
  }

  private async load() {
    try {
      const n = await this.read()
      this.base = n.mtime
      this.latest = this.saved = n.text
      this.set({ text: n.text, savedAt: n.mtime, status: 'saved', error: '' })
    } catch (e: any) {
      // a sticky note left empty is cleaned away; brought back (Undo), it starts empty and is written at the first word
      if (this.path.startsWith('stickies/') && /gone/i.test(e.message)) {
        this.base = null
        this.latest = this.saved = ''
        this.set({ text: '', savedAt: 0, status: 'saved', error: '' })
        return
      }
      this.set({ error: e.message, status: 'error' })
    }
  }

  private dirty() {
    return this.latest !== this.saved
  }

  /** The file changed on disk (our own save, a sync, an agent, another program). */
  private async fromDisk() {
    if (this.snap.status === 'loading') return
    if (this.saving) {
      this.recheck = true
      return
    }
    let n: NoteRead
    try {
      n = await this.read()
    } catch {
      return // moved meanwhile
    }
    if (this.saving) {
      this.recheck = true
      return
    }
    if (n.text === this.saved || n.text === this.latest) {
      // nothing new in it for us
      this.base = n.mtime
      if (n.text === this.latest) this.saved = n.text
      this.set({ savedAt: n.mtime, status: this.dirty() ? 'dirty' : 'saved' })
    } else if (!this.dirty()) {
      this.base = n.mtime
      this.latest = this.saved = n.text
      this.set({ text: n.text, savedAt: n.mtime, status: 'saved', disk: null })
    } else {
      this.set({ disk: { text: n.text, mtime: n.mtime }, status: 'conflict' })
    }
  }

  save = async (force = false): Promise<void> => {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.saving) {
      await this.saving
      if (!force && !this.dirty()) return
    }
    const body = this.latest
    if (!force && body === this.saved) return
    if (this.snap.status === 'conflict' && !force) return
    this.set({ status: 'saving' })
    const run = (async () => {
      try {
        let r = await put<NoteSaved>('/api/notes/file', { path: this.path, text: body, baseMtime: force ? null : this.base })
        // the disk copy differs only by its time (our own earlier write, or a sync of the same text): write anyway
        if (r.conflict && (r.text === this.saved || r.text === body)) r = await put<NoteSaved>('/api/notes/file', { path: this.path, text: body, baseMtime: null })
        if (r.conflict) {
          this.set({ disk: { text: r.text || '', mtime: r.mtime }, status: 'conflict' })
          return
        }
        this.base = r.mtime
        this.saved = body
        this.set({ savedAt: r.mtime, disk: null, status: this.dirty() ? 'dirty' : 'saved' })
      } catch (e: any) {
        this.set({ error: e.message, status: 'error' })
      }
    })()
    this.saving = run
    await run
    this.saving = null
    if (this.recheck) {
      this.recheck = false
      this.fromDisk()
    }
    if (this.dirty() && this.snap.status !== 'conflict' && !this.timer) this.timer = setTimeout(() => this.save(), 800)
  }

  change = (t: string) => {
    if (t === this.latest) return
    this.latest = t
    if (this.snap.status === 'conflict') return this.set({ text: t })
    this.set({ text: t, status: this.dirty() ? 'dirty' : 'saved' })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.save(), 800)
  }

  takeDisk = () => {
    const disk = this.snap.disk
    if (!disk) return
    this.base = disk.mtime
    this.latest = this.saved = disk.text
    this.set({ text: disk.text, savedAt: disk.mtime, disk: null, status: 'saved' })
  }
}

const stores = new Map<string, NoteStore>()

export function useNote(path: string) {
  const store = useMemo(() => {
    let s = stores.get(path)
    if (!s) stores.set(path, (s = new NoteStore(path)))
    return s
  }, [path])
  const snap = useSyncExternalStore(store.subscribe, () => store.snap)
  const { text, status, savedAt, disk, error } = snap

  const statusText =
    status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved' : status === 'saved' ? (savedAt ? `Saved ${clock(savedAt)}` : '') : status === 'conflict' ? 'Changed elsewhere' : status === 'error' ? 'Not saved' : ''

  return { text, status, statusText, error, disk, change: store.change, save: store.save, takeDisk: store.takeDisk, archive: () => post('/api/notes/archive', { path }) }
}

interface PaneProps {
  path: string
  mode: NoteMode
  note: ReturnType<typeof useNote>
  compact?: boolean
  /** Cursor in it at once (full screen, or a note just made). */
  autoFocus?: boolean
  /** The card's id: typing on the selected card goes into this note. */
  focusId?: string
  placeholder?: string
}

export function NotePane({ path, mode, note, compact, autoFocus, focusId, placeholder }: PaneProps) {
  if (note.status === 'loading') return <p className="text-muted-foreground">Loading…</p>
  return (
    <div className="note-pane flex min-h-0 flex-col gap-3">
      {note.status === 'conflict' && note.disk && (
        <div className="note-conflict flex flex-wrap items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
          <span>This note was changed somewhere else while you were writing.</span>
          <Button size="sm" variant="secondary" onClick={note.takeDisk}>
            Load theirs
          </Button>
          <Button size="sm" variant="ghost" onClick={() => note.save(true)}>
            Keep mine
          </Button>
        </div>
      )}
      {note.status === 'error' && <p className="text-[13px] text-destructive">{note.error}</p>}
      <div className={cn('note-body', `mode-${mode}`)}>
        {mode !== 'read' && (
          <div className="note-edit nokey">
            <Editor
              docKey={path}
              value={note.text}
              onChange={note.change}
              onSave={() => note.save()}
              placeholder={placeholder || 'Start writing…'}
              autoFocus={autoFocus}
              focusId={focusId}
            />
          </div>
        )}
        {mode !== 'write' && (
          <div className="note-preview">
            <Markdown
              text={note.text}
              className={cn(compact && 'md-compact')}
              resolveAsset={href => `/api/notes/asset?p=${encodeURIComponent(joinRel(path, href))}`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
