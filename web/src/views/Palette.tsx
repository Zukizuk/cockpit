// The + box: paste a link or path to open it, type to add a line to today's journal, or find anything kept and put it on the board.
import { useEffect, useMemo, useState } from 'react'
import { BookA, BookOpenText, Bookmark, Table2, ClipboardList, FileText, FolderOpen, Keyboard, LayoutGrid, Globe, MessageSquare, ListChecks, ListTodo, NotebookPen, NotebookText, Pin, Settings2, Sparkles, StickyNote } from 'lucide-react'
import { post } from '../api'
import { ago } from '../lib'
import { useBoard } from '../board'
import { summary } from '../cards/OutputsCard'
import { basename, iconFor, kindLabel } from '../components/Viewer'
import { isPath, isUrl, unquote } from './paste'
import { openDictionary } from './Dictionary'
import { looksTabular, newTable, rowsFromText } from '../cards/TableCard'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'

export function Palette() {
  const board = useBoard()
  const [q, setQ] = useState('')
  useEffect(() => {
    if (board.palette) setQ(board.paletteSeed)
  }, [board.palette, board.paletteSeed])

  const value = q.trim()
  const kind = !value ? '' : isUrl(value) ? 'link' : isPath(value) ? 'path' : 'text'
  const close = () => board.setPalette(false)

  const noteItems = useMemo(() => (board.notes?.notes || []).filter(n => n.excerpt).slice(0, 60), [board.notes])

  const journal = async () => {
    close()
    const r = await post<{ path: string }>('/api/notes/new', { kind: 'journal' })
    board.addCard('note', r.path)
  }

  // Windows' own Open dialog (the server opens it), so each file keeps its real path; several can be picked
  const chooseFiles = async () => {
    close()
    try {
      const r = await post<{ paths: string[]; busy?: boolean }>('/api/pick')
      if (r.busy) return board.toast('The file picker is already open')
      for (const p of r.paths) await board.showItem({ path: p })
    } catch (e: any) {
      board.toast(e.message)
    }
  }

  return (
    <CommandDialog open={board.palette} onOpenChange={o => board.setPalette(o)} title="Add to the board" description="Paste a link or a path, jot something for the journal, or find something kept" className="palette" showCloseButton={false}>
      <CommandInput value={q} onValueChange={setQ} placeholder="Paste a link or a path, jot a thought, or search…" />
      <CommandList>
        {/* with a link, a path or words typed there's always something to do with them: no "nothing matches" */}
        {!kind && <CommandEmpty>Nothing kept matches.</CommandEmpty>}
        {kind && (
          <CommandGroup forceMount>
            {kind === 'link' && (
              <>
                <CommandItem forceMount value={`__later ${value}`} onSelect={() => (close(), board.saveLater({ url: value }))}>
                  <Bookmark strokeWidth={1.5} />
                  <span className="shrink-0">Save for later</span>
                  <span className="min-w-0 truncate text-muted-foreground">{value.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  <CommandShortcut>Enter</CommandShortcut>
                </CommandItem>
                <CommandItem forceMount value={`__open ${value}`} onSelect={() => (close(), board.showItem({ url: value }))}>
                  <Globe strokeWidth={1.5} />
                  Read it now, on the board
                </CommandItem>
              </>
            )}
            {kind === 'path' && (
              <CommandItem forceMount value={`__open ${value}`} onSelect={() => (close(), board.showItem({ path: unquote(value) }))}>
                <FileText strokeWidth={1.5} />
                <span className="shrink-0">Open</span>
                <span className="min-w-0 truncate text-muted-foreground">{basename(unquote(value))}</span>
                <CommandShortcut>Enter</CommandShortcut>
              </CommandItem>
            )}
            {(kind === 'path' || kind === 'link') && (
              <CommandItem forceMount value={`__pin ${value}`} onSelect={() => (close(), board.pin(kind === 'link' ? { url: value } : { path: unquote(value) }))}>
                <Pin strokeWidth={1.5} />
                Pin to Quick access
              </CommandItem>
            )}
            {kind === 'text' && (
              <CommandItem
                forceMount
                value={`__thought ${value}`}
                onSelect={async () => {
                  close()
                  try {
                    const r = await post<{ path: string }>('/api/notes/thought', { text: value })
                    board.addCard('note', r.path)
                    board.toast("Added to today's journal")
                  } catch (e: any) {
                    board.toast(e.message)
                  }
                }}
              >
                <StickyNote strokeWidth={1.5} />
                <span className="shrink-0">Add to today's journal</span>
                <span className="min-w-0 truncate text-muted-foreground">“{value.split('\n')[0].slice(0, 60)}”</span>
              </CommandItem>
            )}
            {kind === 'text' && board.prefs.extras.dictionary && /^[\p{L}'’-]{2,40}$/u.test(value) && (
              <CommandItem forceMount value={`__define ${value}`} onSelect={() => (close(), openDictionary(value))}>
                <BookA strokeWidth={1.5} />
                <span className="shrink-0">Look up</span>
                <span className="min-w-0 truncate text-muted-foreground">“{value}”</span>
              </CommandItem>
            )}
            {kind === 'text' && board.prefs.extras.tables && looksTabular(value) && (
              <CommandItem forceMount value={`__table ${value}`} onSelect={() => (close(), newTable(board, { rows: rowsFromText(value) }))}>
                <Table2 strokeWidth={1.5} />
                Make a table from this
              </CommandItem>
            )}
            {kind === 'text' && (
              <CommandItem forceMount value={`__sticky ${value}`} onSelect={() => (close(), board.newSticky(value))}>
                <NotebookText strokeWidth={1.5} />
                Make a sticky note
              </CommandItem>
            )}
            {kind === 'text' && (
              <CommandItem forceMount value={`__later ${value}`} onSelect={() => (close(), board.saveLater({ text: value }))}>
                <Bookmark strokeWidth={1.5} />
                Keep on Later, to check
              </CommandItem>
            )}
            {kind === 'text' && (
              <CommandItem
                forceMount
                value={`__snippet ${value}`}
                onSelect={() => {
                  close()
                  post('/api/snippets', { text: value }).then(
                    () => board.addCard('snippets', 'snippets'),
                    (e: Error) => board.toast(e.message),
                  )
                }}
              >
                <ClipboardList strokeWidth={1.5} />
                Keep as a snippet, to copy
              </CommandItem>
            )}
          </CommandGroup>
        )}
        {kind !== 'link' && kind !== 'path' && (
          <>
            <CommandGroup heading="Add">
              {board.prefs.extras.tables && (
                <CommandItem value="table grid rows columns spreadsheet csv" onSelect={() => (close(), newTable(board))}>
                  <Table2 strokeWidth={1.5} />
                  Table
                </CommandItem>
              )}
              {board.prefs.extras.dictionary && (
                <CommandItem value="dictionary define word meaning look up" onSelect={() => (close(), openDictionary())}>
                  <BookA strokeWidth={1.5} />
                  Dictionary
                  <CommandShortcut>D</CommandShortcut>
                </CommandItem>
              )}
              <CommandItem value="sticky note new note" onSelect={() => (close(), board.newSticky())}>
                <NotebookText strokeWidth={1.5} />
                Sticky note
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem value="choose files browse open file picker computer" onSelect={chooseFiles}>
                <FolderOpen strokeWidth={1.5} />
                Choose files…
              </CommandItem>
              <CommandItem value="journal today" onSelect={journal}>
                <NotebookPen strokeWidth={1.5} />
                Today's journal
              </CommandItem>
              <CommandItem value="quick access pinned open often favourites" onSelect={() => (close(), board.setPinnedOpen(true))}>
                <Pin strokeWidth={1.5} />
                Quick access
                <CommandShortcut>Q</CommandShortcut>
              </CommandItem>
              <CommandItem value="snippets copy secrets clipboard" onSelect={() => (close(), board.addCard('snippets', 'snippets'))}>
                <ClipboardList strokeWidth={1.5} />
                Snippets
                <CommandShortcut>C</CommandShortcut>
              </CommandItem>
              <CommandItem value="later saved links read" onSelect={() => (close(), board.addCard('later', 'later'))}>
                <Bookmark strokeWidth={1.5} />
                Later
              </CommandItem>
              <CommandItem value="today tasks todoist" onSelect={() => (close(), board.addCard('tasks', 'today'))}>
                <ListTodo strokeWidth={1.5} />
                Today's tasks
              </CommandItem>
              {board.trackers
                .filter(t => t.ok)
                .map(t => (
                  <CommandItem key={t.file} value={`tracker ${t.name}`} onSelect={() => (close(), board.addCard('tracker', t.name))}>
                    <ListChecks strokeWidth={1.5} />
                    Tracker: {t.name}
                    <CommandShortcut>{t.counts.yours ? `${t.counts.yours} for you` : `${t.open.length} open`}</CommandShortcut>
                  </CommandItem>
                ))}
              <CommandItem value="tidy arrange line up cards" onSelect={() => (close(), board.tidy())}>
                <LayoutGrid strokeWidth={1.5} />
                Tidy the board
                <CommandShortcut>Ctrl Alt T</CommandShortcut>
              </CommandItem>
              <CommandItem value="what's new changelog changes updates" onSelect={() => (close(), board.openChangelog())}>
                <Sparkles strokeWidth={1.5} />
                What's new
              </CommandItem>
              <CommandItem value="send feedback issue bug idea" onSelect={() => (close(), board.sendFeedback())}>
                <MessageSquare strokeWidth={1.5} />
                Send feedback
              </CommandItem>
              <CommandItem value="keyboard shortcuts keys" onSelect={() => (close(), board.setKeysOpen(true))}>
                <Keyboard strokeWidth={1.5} />
                Keyboard shortcuts
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
              <CommandItem value="settings todoist notes folder" onSelect={() => (close(), board.setSettingsOpen(true))}>
                <Settings2 strokeWidth={1.5} />
                Settings
              </CommandItem>
            </CommandGroup>
            {board.outputs.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Outputs">
                  {board.outputs.slice(0, 6).map(g => (
                    <CommandItem key={g.id} value={`out ${g.id} ${summary(g)} ${g.from} ${g.items.map(i => i.label).join(' ')}`} onSelect={() => (close(), board.addCard('outputs', g.id))}>
                      <Sparkles strokeWidth={1.5} />
                      <span className="truncate">{summary(g)}</span>
                      <CommandShortcut>
                        {g.from.replace(/^Claude · /, '')} · {ago(g.createdAt)}
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {board.items.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Kept">
                  {board.items.slice(0, 80).map(e => {
                    const Icon = iconFor(e)
                    return (
                      <CommandItem
                        key={e.id}
                        value={`item ${e.id} ${e.title}`}
                        keywords={[e.path, e.url || '', e.siteName || '', ...(e.tags || [])]}
                        onSelect={() => (close(), board.addCard('item', e.id))}
                      >
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
            {noteItems.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Notes">
                  {noteItems.map(n => (
                    <CommandItem key={n.path} value={`note ${n.path} ${n.title}`} keywords={[n.excerpt || '']} onSelect={() => (close(), board.addCard('note', n.path))}>
                      {n.folder === 'journal' ? <BookOpenText strokeWidth={1.5} /> : <NotebookPen strokeWidth={1.5} />}
                      <span className="truncate">{n.title}</span>
                      <CommandShortcut>{ago(n.mtime)}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
