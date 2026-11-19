// Cockpit: a free-form board. Paste a link or path anywhere (or press +) and it lands as a card you can read,
// move, resize and put beside anything else. A small dock is the only chrome.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { Bookmark, ChevronsDownUp, ChevronsUpDown, ClipboardList, Inbox, Keyboard, LayoutGrid, Maximize, MessageSquare, Pin, Plus, Redo2, Settings2, Sparkles, StickyNote, Undo2, X } from 'lucide-react'
import { get, post, track, type Board, type ShownEntry, type TelemetryStatus } from './api'
import { BoardProvider, fitsContent, foldNode, isSticky, resizingRef, toNode, useBoard, type CardNode } from './board'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { KeysDialog } from './views/KeysDialog'
import { ItemCard } from './cards/ItemCard'
import { NoteCard } from './cards/NoteCard'
import { OutputsCard, OutputsList, newSinceOf, summary } from './cards/OutputsCard'
import { TasksCard, TrackerCard } from './cards/WorkCards'
import { CommandCard } from './cards/CommandCard'
import { LaterCard, laterCounts } from './cards/LaterCard'
import { dayOf } from './journal'
import { SnippetsCard } from './cards/SnippetsCard'
import { Palette } from './views/Palette'
import { PinnedSheet, QUICK_DRAG } from './views/PinnedSheet'
import { Reader } from './views/Reader'
import { SettingsDialog } from './views/SettingsDialog'
import { isPath, isUrl } from './views/paste'
import { ago, emit } from './lib'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const nodeTypes = { item: ItemCard, note: NoteCard, outputs: OutputsCard, tasks: TasksCard, tracker: TrackerCard, command: CommandCard, later: LaterCard, snippets: SnippetsCard }

export function App() {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    get<Board>('/api/board').then(setBoard, e => setError(e.message))
  }, [])
  if (error) return <div className="grid h-full place-items-center text-muted-foreground">{error}</div>
  if (!board) return null
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={600}>
      <ReactFlowProvider>
        <BoardProvider>
          <Canvas initial={board} />
          <Dock />
          <Palette />
          <OutputsSheet />
          <PinnedSheet />
          <Reader />
          <SettingsDialog />
          <KeysDialog />
          <FocusBar />
          <UsageAsk />
          <Toast />
          <Badge />
          <UrlState />
        </BoardProvider>
      </ReactFlowProvider>
    </TooltipProvider>
  )
}

function Canvas({ initial }: { initial: Board }) {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  const [nodes, , onNodesChange] = useNodesState<CardNode>(useMemo(() => initial.cards.map(toNode), [initial]))

  const onChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      onNodesChange(changes)
      // save once a move, resize or removal is finished (not on every frame, not on selection)
      if (changes.some(c => (c.type === 'position' && !c.dragging) || (c.type === 'dimensions' && !c.resizing) || c.type === 'remove')) board.persist()
    },
    [onNodesChange, board],
  )

  // A card that fits its content (Snippets, until a height is dragged by hand) never keeps a stray fixed height,
  // which would cut it off.
  useEffect(() => {
    const stuck = (n: CardNode) => fitsContent(n) && !n.data.folded && n.height !== undefined && !resizingRef.current
    if (nodes.some(stuck)) rf.setNodes(ns => ns.map(n => (stuck(n) ? { ...n, height: undefined } : n)))
  }, [nodes, rf])

  useEffect(() => {
    // Web links anywhere in Cockpit open through Windows, like every other link on this PC (a browser picker set
    // as the default gets to choose), instead of in the browser Cockpit happens to run in.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !/^https?:\/\//i.test(a.href) || a.origin === location.origin || e.defaultPrevented) return
      e.preventDefault()
      board.openLink(a.href)
    }
    addEventListener('click', onClick, true)
    return () => removeEventListener('click', onClick, true)
  }, [board])

  // Zoom: Ctrl+wheel and touchpad pinch (which arrives as Ctrl+wheel), a bigger step than React Flow's own and
  // centred on the pointer. Plain wheel still pans.
  useEffect(() => {
    const el = document.querySelector('.board')
    if (!el) return
    const onWheel = (e: Event) => {
      const w = e as WheelEvent
      if (!w.ctrlKey && !w.metaKey) return
      if ((w.target as HTMLElement | null)?.closest('[role="dialog"]')) return
      w.preventDefault()
      w.stopPropagation() // React Flow would otherwise pan with the same scroll
      const { x, y, zoom } = rf.getViewport()
      const delta = Math.max(-120, Math.min(120, w.deltaMode === 1 ? w.deltaY * 40 : w.deltaY))
      const next = Math.min(2, Math.max(0.15, zoom * Math.pow(2, -delta * 0.006)))
      if (next === zoom) return
      const rect = (el as HTMLElement).getBoundingClientRect()
      const px = w.clientX - rect.left
      const py = w.clientY - rect.top
      rf.setViewport({ x: px - ((px - x) * next) / zoom, y: py - ((py - y) * next) / zoom, zoom: next })
      board.persist()
    }
    // capture phase: React Flow's own wheel handler on the empty board stops the event before it bubbles here
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [rf, board])

  // Paste a link anywhere on the board and it's kept on Later (read in the background, nothing opens); a path
  // becomes a card; other text opens the + box with it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return
      const raw = e.clipboardData?.getData('text') || ''
      // the Snippets card selected: whatever is pasted is kept there, exactly as copied
      if (raw.trim() && rf.getNodes().some(n => n.selected && n.type === 'snippets')) {
        e.preventDefault()
        emit('snippet-paste', { text: raw })
        return
      }
      const text = raw.trim().replace(/^"(.*)"$/, '$1')
      if (!text) return
      e.preventDefault()
      if (isUrl(text)) board.saveLater({ url: text })
      else if (isPath(text)) board.showItem({ path: text })
      else board.setPalette(true, text)
    }
    addEventListener('paste', onPaste)
    return () => removeEventListener('paste', onPaste)
  }, [board, rf])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"], .cm-editor')
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        board.setPalette(true)
        return
      }
      if (typing || board.expanded || board.palette || document.querySelector('[role="menu"], [role="dialog"]')) return
      const picked = rf.getNodes().filter(n => n.selected)
      const one = picked.length === 1 ? picked[0] : null
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      // Undo and redo for the board's layout (inside a note, Ctrl+Z is the note's own)
      if (ctrl && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) board.redo()
        else board.undo()
        return
      }
      // Tidy, as Figma's Tidy up: Ctrl+Alt+T
      if (ctrl && e.altKey && key === 't') {
        e.preventDefault()
        board.tidy()
        return
      }
      // Lock in place, as Miro, FigJam and Excalidraw: Ctrl+Shift+L
      if (ctrl && e.shiftKey && key === 'l') {
        e.preventDefault()
        if (!picked.length) return board.toast('Select a card first')
        board.setLocked(
          picked.map(n => n.id),
          !picked.every(n => n.data.locked),
        )
        return
      }
      if (e.key === 'Escape' && picked.length) rf.setNodes(ns => ns.map(n => (n.selected ? { ...n, selected: false } : n)))
      // A selected note takes what's typed (Enter just puts the cursor in it), so typing meant for a note never
      // sets off the board's keys
      if (one?.type === 'note' && !ctrl && !e.altKey && (e.key === 'Enter' || (e.key.length === 1 && e.key !== ' '))) {
        if (e.key === 'Enter') e.preventDefault()
        emit('note-focus', { id: one.id })
        return
      }
      // the same for a card with a text box (Today's "Add a task", Later's "Add a link", Snippets' paste box): the
      // box takes the cursor during this keydown, so the key lands in it
      if (one && !ctrl && !e.altKey && (e.key === 'Enter' || (e.key.length === 1 && e.key !== ' '))) {
        const box = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(one.id)}"] [data-typeto]`)
        if (box && box.offsetParent) {
          if (e.key === 'Enter') e.preventDefault()
          box.focus()
          return
        }
      }
      // F2 names a note, as in Explorer
      if (e.key === 'F2' && one?.type === 'note') {
        e.preventDefault()
        emit('note-rename', { id: one.id })
        return
      }
      if (e.key === ' ' && one && (one.type === 'item' || one.type === 'note')) {
        e.preventDefault()
        board.expand({ type: one.type, ref: one.data.ref })
      }
      // Single keys (see KeysDialog): only bare keys, so Ctrl/Alt combinations stay the browser's and Windows'.
      // A capital letter is typing that missed its box, never a shortcut.
      if (ctrl || e.altKey || e.repeat || (e.shiftKey && /^[a-z]$/.test(key))) return
      // single-letter shortcuts can be turned off in Settings (the list, ?, still opens)
      if (!board.prefs.singleKeys && e.key !== '?') return
      const run: Record<string, () => void> = {
        n: () => board.newSticky(),
        l: () => board.addCard('later', 'later'),
        c: () => board.addCard('snippets', 'snippets'),
        o: () => board.setOutputsOpen(true),
        p: () => board.setPinnedOpen(true),
        q: () => board.setPinnedOpen(true),
        t: () => board.addCard('tasks', 'today'),
        // the journal card, back on today (it's moved, not doubled, if it was on an earlier day)
        j: () =>
          post<{ path: string }>('/api/notes/new', { kind: 'journal' }).then(r => {
            const card = rf.getNodes().find(n => n.type === 'note' && dayOf(n.data.ref))
            if (card && card.data.ref !== r.path) board.retarget(card.id, r.path, true)
            else board.addCard('note', r.path)
          }, err => board.toast(err.message)),
        '0': () => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 }),
        f: () => {
          if (!one) return board.toast('Select a card first, then F folds it')
          board.remember()
          rf.setNodes(ns => ns.map(n => (n.id === one.id ? foldNode(n, !n.data.folded) : n)))
          board.persist()
        },
        ',': () => board.setSettingsOpen(true),
        '?': () => board.setKeysOpen(true),
      }
      const fn = run[e.key.toLowerCase()]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [board, rf])

  // Something dragged out of Quick access becomes a card where it's dropped
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(QUICK_DRAG)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(QUICK_DRAG)
    if (!raw) return
    e.preventDefault()
    try {
      board.putOnBoard(JSON.parse(raw), rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    } catch {
      // not ours
    }
  }

  // right-click on empty board: what applies to the whole board
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; at: { x: number; y: number } } | null>(null)
  const foldable = nodes.filter(n => !isSticky(n.type, n.data.ref))
  const foldAll = (fold: boolean) => {
    if (fold) track('board.foldall')
    board.remember()
    rf.setNodes(ns => ns.map(n => (isSticky(n.type, n.data.ref) ? n : foldNode(n, fold))))
    board.persist()
  }
  const fitAll = () => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 })

  return (
    <div className="board" onDragOver={onDragOver} onDrop={onDrop}>
      <DropdownMenu open={!!paneMenu} onOpenChange={open => !open && setPaneMenu(null)} modal={false}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: paneMenu?.x ?? 0, top: paneMenu?.y ?? 0 }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onSelect={() => paneMenu && board.newSticky('', { at: paneMenu.at })}>
            <StickyNote strokeWidth={1.75} />
            Sticky note here
            <DropdownMenuShortcut>N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => board.setPalette(true)}>
            <Plus strokeWidth={1.75} />
            Add or find…
            <DropdownMenuShortcut>Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!foldable.some(n => !n.data.folded)} onSelect={() => foldAll(true)}>
            <ChevronsDownUp strokeWidth={1.75} />
            Fold all cards
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!foldable.some(n => n.data.folded)} onSelect={() => foldAll(false)}>
            <ChevronsUpDown strokeWidth={1.75} />
            Unfold all cards
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!nodes.length} onSelect={() => board.tidy()}>
            <LayoutGrid strokeWidth={1.75} />
            Tidy
            <DropdownMenuShortcut>Ctrl Alt T</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!nodes.length} onSelect={fitAll}>
            <Maximize strokeWidth={1.75} />
            Show everything
            <DropdownMenuShortcut>0</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => board.undo()}>
            <Undo2 strokeWidth={1.75} />
            Undo
            <DropdownMenuShortcut>Ctrl Z</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => board.redo()}>
            <Redo2 strokeWidth={1.75} />
            Redo
            <DropdownMenuShortcut>Ctrl Y</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => board.setKeysOpen(true)}>
            <Keyboard strokeWidth={1.75} />
            Keyboard shortcuts
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => board.openChangelog()}>
            <Sparkles strokeWidth={1.75} />
            What's new
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => board.setSettingsOpen(true)}>
            <Settings2 strokeWidth={1.75} />
            Settings
            <DropdownMenuShortcut>,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={board.sendFeedback}>
            <MessageSquare strokeWidth={1.75} />
            Send feedback
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReactFlow<CardNode>
        nodes={nodes}
        onNodesChange={onChange}
        nodeTypes={nodeTypes}
        defaultViewport={initial.viewport ?? { x: 0, y: 0, zoom: 1 }}
        fitView={!initial.viewport && nodes.length > 0}
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.15}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomActivationKeyCode={null}
        panOnDrag
        selectionOnDrag={false}
        deleteKeyCode={['Delete']}
        onMoveEnd={() => board.persist()}
        onNodeDragStart={() => board.remember()}
        // the Delete key only (cards taken off in code are kept for Undo where that happens)
        onBeforeDelete={async ({ nodes }) => {
          board.removing(nodes as CardNode[])
          return true
        }}
        onPaneClick={() => rf.setNodes(ns => ns.map(n => (n.selected ? { ...n, selected: false } : n)))}
        onPaneContextMenu={e => {
          e.preventDefault()
          track('board.menu')
          setPaneMenu({ x: e.clientX, y: e.clientY, at: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
        }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.8} color="var(--dots)" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="grid justify-items-center gap-3 text-center">
            <p className="text-[15px] text-foreground/80">An empty board</p>
            <p className="max-w-[360px] text-[13.5px] leading-relaxed text-muted-foreground">
              Paste a link anywhere, press <Kbd>N</Kbd> for a sticky note, or <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> for anything else.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function DockButton({ label, shortcut, onClick, children, active }: { label: string; shortcut?: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'relative grid size-9 place-items-center rounded-[10px] text-foreground/75 outline-none transition-[background-color,color,scale] duration-150 ease-(--ease-out) hover:bg-ink/[0.08] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]',
            active && 'bg-ink/[0.1] text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10}>
        {label}
        {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function Dock() {
  const board = useBoard()
  const rf = useReactFlow()
  const later = laterCounts(board.items).todo
  return (
    <nav className="dock glass" aria-label="Cockpit">
      <DockButton label="Add" shortcut="Ctrl K" onClick={() => board.setPalette(true)}>
        <Plus className="size-[18px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label="New sticky note" shortcut="N" onClick={() => board.newSticky()}>
        <StickyNote className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label="Quick access" shortcut="Q" onClick={() => board.setPinnedOpen(true)} active={board.pinnedOpen}>
        <Pin className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label="Later" shortcut="L" onClick={() => board.addCard('later', 'later')}>
        <Bookmark className="size-[16px]" strokeWidth={1.75} />
        {later > 0 && <span className="dock-dot">{later > 9 ? '9+' : later}</span>}
      </DockButton>
      <DockButton label="Snippets: things to copy" shortcut="C" onClick={() => board.addCard('snippets', 'snippets')}>
        <ClipboardList className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      {/* Outputs come from Claude Code (see the README); until something has arrived there's nothing to show */}
      {(board.outputs.length > 0 || board.outputsOpen) && (
        <DockButton label="Outputs" shortcut="O" onClick={() => board.setOutputsOpen(true)} active={board.outputsOpen}>
          <Inbox className="size-[17px]" strokeWidth={1.75} />
          {board.unseenOutputs > 0 && <span className="dock-dot">{board.unseenOutputs > 9 ? '9+' : board.unseenOutputs}</span>}
        </DockButton>
      )}
      <span className="mx-0.5 h-5 w-px bg-ink/10" />
      <DockButton label="Show everything" shortcut="0" onClick={() => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 })}>
        <Maximize className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label="Settings" shortcut="," onClick={() => board.setSettingsOpen(true)}>
        <Settings2 className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
    </nav>
  )
}

function OutputsSheet() {
  const board = useBoard()
  // what was new when the panel opened: kept for as long as it's open, so the "New" marks don't vanish at once
  const [since, setSince] = useState<Record<string, string | null>>({})
  useEffect(() => {
    if (!board.outputsOpen) {
      setSince({})
      return
    }
    // note each group's "new since" the first time it's seen while open (the list may still be loading)
    const missing = board.outputs.filter(g => !(g.id in since))
    if (!missing.length) return
    setSince(s => ({ ...s, ...Object.fromEntries(missing.map(g => [g.id, newSinceOf(g)])) }))
    const unseen = missing.filter(g => !g.seen)
    if (unseen.length) Promise.all(unseen.map(g => post(`/api/outputs/${g.id}`, { seen: true }))).then(board.reloadOutputs, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.outputsOpen, board.outputs])
  const clear = async (id: string) => {
    await post(`/api/outputs/${id}`, { hidden: true })
    board.reloadOutputs()
  }
  const clearAll = async () => {
    const r = await post<{ cleared: number }>('/api/outputs/clear')
    board.reloadOutputs()
    board.toast(`Cleared ${r.cleared} ${r.cleared === 1 ? 'chat' : 'chats'} (kept on disk, just hidden)`)
  }
  return (
    <Sheet open={board.outputsOpen} onOpenChange={board.setOutputsOpen}>
      <SheetContent side="right" className="glass-panel w-[min(460px,calc(100vw-24px))] gap-0 sm:max-w-none">
        <SheetHeader className="pb-2">
          <SheetTitle>Outputs</SheetTitle>
          <SheetDescription>What Claude made, one group per chat, newest turn on top.</SheetDescription>
          {board.outputs.length > 0 && (
            <Button size="sm" variant="ghost" className="absolute top-3.5 right-12 h-7 text-[12.5px] text-muted-foreground" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </SheetHeader>
        <div className="grid min-w-0 grid-cols-1 gap-3 overflow-x-hidden overflow-y-auto px-3 pb-6">
          {!board.outputs.length && <p className="px-2 text-[13.5px] text-muted-foreground">Nothing here. Each chat's files, links, drafts and commands arrive as its turns end.</p>}
          {board.outputs.map(g => (
            <section key={g.id} className="out-group min-w-0">
              <header className="group/head flex items-center gap-2 px-2 pb-1">
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{summary(g)}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {g.from} · {ago(g.updatedAt || g.createdAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[12.5px] text-muted-foreground"
                  onClick={() => {
                    board.addCard('outputs', g.id)
                    board.setOutputsOpen(false)
                  }}
                >
                  Put on board
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Clear this chat's outputs"
                      onClick={() => clear(g.id)}
                      className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-(--ease-out) hover:bg-ink/[0.08] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
                    >
                      <X className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Clear</TooltipContent>
                </Tooltip>
              </header>
              <OutputsList group={g} onView={() => board.setOutputsOpen(false)} newSince={since[g.id]} />
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** For screenshots and checks: ?expand=item:<id> or note:<path> opens the reader, ?palette opens the + box. */
function UrlState() {
  const board = useBoard()
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const ex = q.get('expand')
    if (ex) {
      const [type, ...rest] = ex.split(':')
      if (type === 'item' || type === 'note') board.expand({ type, ref: rest.join(':') })
    }
    if (q.has('palette')) board.setPalette(true, q.get('palette') || '')
    if (q.has('outputs')) board.setOutputsOpen(true)
    if (q.has('pinned')) board.setPinnedOpen(true)
    // A launch of the installed app (its shortcut key, the Later jump-list entry, or the Share menu) reaches the
    // window that is already open instead of opening a second one: the app's launch queue hands it over.
    const handle = (target: URL) => {
      const p = target.searchParams
      // (a moment later: the board's cards must be in place before checking whether Later is already on it)
      if (p.has('later')) setTimeout(() => board.addCard('later', 'later'), 300)
      if (target.pathname === '/share') {
        const url = p.get('url') || ''
        const text = p.get('text') || ''
        const title = p.get('title') || ''
        if (url || text) setTimeout(() => board.saveLater({ url: url || undefined, text: url ? undefined : text, title: title || undefined }), 300)
      }
      // for checks: ?focus=<card id> focuses that card, ?tidy tidies
      if (p.get('focus')) setTimeout(() => board.toggleFocus(p.get('focus') || undefined), 300)
      if (p.has('tidy')) setTimeout(() => board.tidy(), 300)
      if ((target.pathname !== '/' || target.search) && !p.has('static')) history.replaceState(null, '', '/')
    }
    // this page's own address first; then later launches of the app, skipping the queue's copy of this one
    const first = location.href
    handle(new URL(first))
    let initial = true
    const lq = (window as any).launchQueue
    lq?.setConsumer?.((params: { targetURL?: string }) => {
      if (params.targetURL && !(initial && params.targetURL === first)) handle(new URL(params.targetURL))
      initial = false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/** While focusing on one card: a small bar to bring everything back. */
function FocusBar() {
  const board = useBoard()
  if (!board.focusing) return null
  return (
    <div className="focus-bar glass" role="status">
      <span className="text-muted-foreground">Focus</span>
      <button type="button" onClick={() => board.toggleFocus()} className="focus-bar-btn">
        Bring everything back
      </button>
    </div>
  )
}

/** Asked once, after Cockpit's first day: may it send anonymous usage counts? (Never asked in a build with no
 * telemetry key; changeable in Settings, where "See what's sent" shows the exact data.) */
function UsageAsk() {
  const board = useBoard()
  const [ask, setAsk] = useState(false)
  useEffect(() => {
    get<TelemetryStatus>('/api/telemetry').then(s => setAsk(s.ask), () => {})
  }, [])
  if (!ask || board.focusing) return null
  const choose = (choice: 'yes' | 'no') => {
    setAsk(false)
    post('/api/telemetry', { choice })
      .then(() => board.toast(choice === 'yes' ? 'Thanks. You can change this in Settings.' : 'Nothing will be sent.'))
      .catch((e: Error) => board.toast(e.message))
  }
  return (
    <div className="focus-bar glass whitespace-nowrap" role="dialog" aria-label="Anonymous usage counts">
      <span>Share anonymous usage counts? Never what's on your board.</span>
      <button type="button" className="focus-bar-btn text-muted-foreground" onClick={() => board.setSettingsOpen(true)}>
        What's sent
      </button>
      <button type="button" className="focus-bar-btn text-muted-foreground" onClick={() => choose('no')}>
        No thanks
      </button>
      <button type="button" className="focus-bar-btn bg-ink/10" onClick={() => choose('yes')}>
        Share
      </button>
    </div>
  )
}

function Toast() {
  const { toastText, toastAction } = useBoard()
  return (
    <div className={cn('toast glass', toastText && 'is-on', toastText && toastAction && 'has-action')} role="status" aria-live="polite">
      <span>{toastText}</span>
      {toastText && toastAction && (
        <button type="button" className="toast-btn" onClick={toastAction.run}>
          {toastAction.label}
        </button>
      )}
    </div>
  )
}

/** Unseen things on the installed app's taskbar icon. */
function Badge() {
  const { items, unseenOutputs } = useBoard()
  const n = items.filter((e: ShownEntry) => !e.seen).length + unseenOutputs
  useEffect(() => {
    document.title = n ? `(${n}) Cockpit` : 'Cockpit'
    const nav = navigator as any
    if (nav.setAppBadge) (n ? nav.setAppBadge(n) : nav.clearAppBadge()).catch?.(() => {})
  }, [n])
  return null
}
