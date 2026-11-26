// Cockpit: a free-form board. Paste a link or path anywhere (or press +) and it lands as a card you can read,
// move, resize and put beside anything else. A small dock is the only chrome.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Background, BackgroundVariant, ConnectionMode, ReactFlow, ReactFlowProvider, SelectionMode, useEdgesState, useNodesState, useReactFlow, useStore, useStoreApi, type EdgeChange, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { ArrowLeftRight, Bookmark, ChevronRight, MoveRight, SquareDashed, Spline, Tag, Trash2, ChevronsDownUp, ChevronsUpDown, ClipboardList, Inbox, Keyboard, LayoutGrid, Maximize, MessageSquare, Minus, Pin, Plus, Redo2, Settings2, Sparkles, StickyNote, Undo2, X } from 'lucide-react'
import { get, post, track, type Board, type ShownEntry, type TelemetryStatus, type UpdateStatus } from './api'
import { BoardProvider, besideSpot, contentsOf, heldBy, offBoard, sectionOf, fitsContent, foldNode, isSection, isSticky, resizingRef, toEdge, toNode, useBoard, type CardNode, type LinkData, type LinkEdge } from './board'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { KeysDialog } from './views/KeysDialog'
import { ItemCard } from './cards/ItemCard'
import { NoteCard } from './cards/NoteCard'
import { KindChips, OutputsCard, OutputsList, chatOf, newSinceOf, type KindFilter } from './cards/OutputsCard'
import { TrackerCard } from './cards/WorkCards'
import { TasksCard } from './cards/TasksCard'
import { CommandCard } from './cards/CommandCard'
import { LaterCard, laterCounts } from './cards/LaterCard'
import { dayOf } from './journal'
import { SnippetsCard } from './cards/SnippetsCard'
import { Palette } from './views/Palette'
import { PinnedSheet, QUICK_DRAG } from './views/PinnedSheet'
import { FolderCard } from './cards/FolderCard'
import { Reader } from './views/Reader'
import { SettingsDialog } from './views/SettingsDialog'
import { isPath, isUrl } from './views/paste'
import { ago, emit, useData } from './lib'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SpaceSwitcher } from './views/SpaceSwitcher'
import { TuckedTray } from './views/TuckedTray'
import { PutAwayDialog, ShelfClock, ShelfCorner } from './views/Shelf'
import { ImageEditor } from './views/ImageEditor'
import { looksSecret } from './cards/SnippetsCard'
import { BoardAgent } from './agent/boardAgent'
import { AgentFrames, AgentPill } from './agent/presence'
import { DictionaryExtra, openDictionary } from './views/Dictionary'
import { TableCard } from './cards/TableCard'
import { Arrow } from './cards/Arrow'
import { SectionCard, SectionMenuItems } from './cards/SectionCard'
import { QuestionsCard } from './cards/QuestionsCard'

/**
 * Where the board's agent components live: a place of their own at the end of the page. A dialog that's open (the
 * shelf's "Put away", Settings) marks the rest of the page hidden from screen readers, and an agent skips what's hidden,
 * so with the components inside the app an agent saw an empty board while one was open. A live region is left out of
 * that marking (aria-hidden spares them), so the components stay in reach; "off" announces nothing.
 */
function agentHost() {
  let el = document.getElementById('agent-host')
  if (!el) {
    el = document.createElement('div')
    el.id = 'agent-host'
    el.setAttribute('aria-live', 'off')
    document.body.appendChild(el)
  }
  return el
}

const nodeTypes = { item: ItemCard, note: NoteCard, outputs: OutputsCard, tasks: TasksCard, tracker: TrackerCard, command: CommandCard, later: LaterCard, snippets: SnippetsCard, folder: FolderCard, table: TableCard, section: SectionCard, questions: QuestionsCard }
const edgeTypes = { arrow: Arrow }

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
        <BoardProvider initial={board}>
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
          <CornerTools />
          <SpaceSwitcher />
          <TuckedTray />
          <PutAwayDialog />
          <ImageEditor />
          <ShelfClock />
          <ShelfCorner />
          {createPortal(<BoardAgent />, agentHost())}
          <AgentPill />
          <DictionaryExtra />
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
  // cards of other spaces are there, hidden
  const [nodes, , onNodesChange] = useNodesState<CardNode>(
    useMemo(() => initial.cards.map(c => ({ ...toNode(c), hidden: offBoard(c, initial.space || 'main') })), [initial]),
  )

  const onChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      changes = snapToLinked(changes)
      changes = carryContents(changes)
      // a box dragged out on the board picks cards, not the sections they're in (a section is picked by its title)
      if (store.getState().userSelectionActive) changes = changes.filter(c => !(c.type === 'select' && c.selected && rf.getNode(c.id)?.type === 'section'))
      // a card that got bigger (a table's new rows, a resize let go; not its first measuring): its section grows to hold it
      const bigger = changes.flatMap(c => {
        if (c.type !== 'dimensions' || !c.dimensions || c.resizing) return []
        const was = rf.getNode(c.id)?.measured
        if (!was?.width || !was.height) return []
        return c.dimensions.width > was.width + 1 || c.dimensions.height > was.height + 1 ? [c.id] : []
      })
      onNodesChange(changes)
      if (bigger.length) setTimeout(() => board.growAround(bigger), 0)
      // save once a move, resize or removal is finished (not on every frame, not on selection)
      if (changes.some(c => (c.type === 'position' && !c.dragging) || (c.type === 'dimensions' && !c.resizing) || c.type === 'remove')) board.persist()
    },
    [onNodesChange, board],
  )
  // A section dragged by its title takes what's in it along: the cards (and smaller sections) whose middle was in it
  // when the drag began, unless they're being dragged anyway or are locked in place.
  const store = useStoreApi()
  // a card being dragged: the section it began in, and the one it's over now (lit up), if another
  const dropping = useRef<{ from?: string; over?: string } | null>(null)
  const carrying = useRef<{ leaders: Map<string, { x: number; y: number }>; items: Map<string, { x: number; y: number; leader: string }> } | null>(null)
  const startCarrying = (dragged: CardNode[]) => {
    const draggedIds = new Set(dragged.map(n => n.id))
    const all = rf.getNodes()
    const leaders = new Map<string, { x: number; y: number }>()
    const items = new Map<string, { x: number; y: number; leader: string }>()
    for (const s of dragged.filter(isSection)) {
      leaders.set(s.id, { ...s.position })
      for (const n of [...contentsOf(s, all), ...heldBy(s.id, all)]) if (!draggedIds.has(n.id) && !n.data.locked && !items.has(n.id)) items.set(n.id, { x: n.position.x, y: n.position.y, leader: s.id })
    }
    carrying.current = items.size ? { leaders, items } : null
  }
  function carryContents(changes: NodeChange<CardNode>[]) {
    const carry = carrying.current
    if (!carry) return changes
    const extra: NodeChange<CardNode>[] = []
    for (const c of changes) {
      if (c.type !== 'position' || !c.position) continue
      const start = carry.leaders.get(c.id)
      if (!start) continue
      const dx = c.position.x - start.x
      const dy = c.position.y - start.y
      for (const [id, it] of carry.items) if (it.leader === c.id) extra.push({ type: 'position', id, position: { x: it.x + dx, y: it.y + dy }, dragging: c.dragging })
    }
    return extra.length ? [...changes, ...extra] : changes
  }
  // A card dragged on its own, with its middle near level with (or in line with) the middle of a card it has an arrow
  // to, within a few pixels on screen, snaps into line with it, so the arrow between them runs straight.
  function snapToLinked(changes: NodeChange<CardNode>[]) {
    // while dragging, and where it's let go (React Flow's last change carries the place under the pointer, unsnapped)
    const moving = changes.filter(c => c.type === 'position' && c.position && c.dragging !== undefined)
    if (moving.length !== 1 || moving[0].type !== 'position' || !moving[0].position) return changes
    const ch = moving[0]
    const me = rf.getNode(ch.id)
    if (!me) return changes
    const linked = new Set(rf.getEdges().flatMap(e => (e.source === ch.id ? [e.target] : e.target === ch.id ? [e.source] : [])))
    if (!linked.size) return changes
    const size = (n: CardNode) => ({ w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 })
    const { w, h } = size(me)
    const near = 10 / rf.getZoom()
    const { x, y } = ch.position!
    // the smallest shift that lines something up, on each axis (none further than `near`)
    let dx = 0
    let dy = 0
    let bestX = near
    let bestY = near
    for (const id of linked) {
      const o = rf.getNode(id)
      if (!o || o.hidden) continue
      const os = size(o)
      // middles level (side by side) or in line (one above the other): an arrow leaves and reaches the middle of a
      // side, so that is what makes it straight
      const ddy = o.position.y + os.h / 2 - (y + h / 2)
      const ddx = o.position.x + os.w / 2 - (x + w / 2)
      if (Math.abs(ddy) < bestY) (bestY = Math.abs(ddy)), (dy = ddy)
      if (Math.abs(ddx) < bestX) (bestX = Math.abs(ddx)), (dx = ddx)
    }
    if (!dx && !dy) return changes
    return changes.map(c => (c === ch ? { ...ch, position: { x: x + dx, y: y + dy } } : c))
  }
  // arrows between cards
  const [edges, , onEdgesChange] = useEdgesState<LinkEdge>(useMemo(() => (initial.links || []).map(toEdge), [initial]))
  const onEdgeChange = useCallback(
    (changes: EdgeChange<LinkEdge>[]) => {
      onEdgesChange(changes)
      if (changes.some(c => c.type === 'remove')) board.persist()
    },
    [onEdgesChange, board],
  )
  // right-click on an arrow: its menu, where it was opened (as the board's own)
  const [arrowMenu, setArrowMenu] = useState<{ x: number; y: number; id: string; data: LinkData } | null>(null)
  const [arrowOpen, setArrowOpen] = useState(false)
  const openArrowMenu = (x: number, y: number, id: string) => {
    setArrowMenu({ x, y, id, data: (rf.getEdge(id)?.data || {}) as LinkData })
    setArrowOpen(true)
  }
  // A card's dots sit where its arrows meet it, so between two close cards they cover the line: a right-click or
  // double-click on a dot goes to the arrow under it.
  const throughDot = (what: 'menu' | 'label') => (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest?.('.link-handle')) return
    const edge = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map(el => el.closest('.react-flow__edge') as HTMLElement | null)
      .find(Boolean)
    const id = edge?.dataset.id
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    if (what === 'menu') openArrowMenu(e.clientX, e.clientY, id)
    else emit('arrow-label', { id })
  }

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

  // Paste on the board, and what's pasted lands where the mouse is, by what it is (as in FigJam): an image or a link
  // becomes a card (and can be kept on Later too, from the toast); a key, token or password goes to Snippets,
  // encrypted, never onto the board; a file path becomes a card; other text opens the + box with it.
  const pointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const follow = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY })
    addEventListener('pointermove', follow, { passive: true })
    return () => removeEventListener('pointermove', follow)
  }, [])
  // Ctrl+Shift+V on the board: the link that's pasted goes straight to Later (the paste event follows the key)
  const laterPaste = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyV') {
        laterPaste.current = true
        setTimeout(() => (laterPaste.current = false), 500)
      }
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [])
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
      // where the mouse is on the board (else the middle of the screen)
      const p = pointer.current
      const at = p && document.elementFromPoint(p.x, p.y)?.closest('.react-flow') ? rf.screenToFlowPosition(p) : undefined
      const image = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
      if (image) {
        e.preventDefault()
        board.showImage(image, at ? { at } : {})
        return
      }
      const text = raw.trim().replace(/^"(.*)"$/, '$1')
      if (!text) return
      e.preventDefault()
      // straight to Later, without reading it on the board first: Ctrl+Shift+V, or Later selected (as with Snippets)
      const toLater = laterPaste.current || rf.getNodes().some(n => n.selected && n.type === 'later')
      laterPaste.current = false
      if (isUrl(text) && toLater) board.saveLater({ url: text })
      else if (isUrl(text)) {
        board.showItem({ url: text }, at ? { at } : {}).then(id => {
          if (!id) return
          // it stays on the board either way; Later keeps it (under Reading) for when the card is gone
          board.toast('Put on the board', {
            label: 'Keep on Later too',
            run: () => {
              const ref = rf.getNode(id)?.data.ref
              if (ref) board.setLater(ref, 'reading').then(() => board.toast('On Later, under Reading'))
            },
          })
        })
      } else if (isPath(text)) board.showItem({ path: text }, at ? { at } : {})
      else if (looksSecret(text))
        post('/api/snippets', { text, secret: true }).then(
          () => board.toast('Kept in Snippets as a secret: hidden and encrypted', { label: 'Show', run: () => board.addCard('snippets', 'snippets') }),
          (err: Error) => board.toast(err.message),
        )
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
      // A section, as FigJam's Ctrl+Alt+G: around the selected cards, or an empty one in the middle of the screen. Also
      // from inside a note (a click on a sticky note puts the cursor in it), where it types nothing.
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.getModifierState('AltGraph') && e.key.toLowerCase() === 'g' && !board.expanded && !board.palette) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur()
        board.addSection({ around: rf.getNodes().filter(n => n.selected && !isSection(n)).map(n => n.id) })
        return
      }
      if (typing || board.expanded || board.palette || document.querySelector('[role="menu"], [role="dialog"]')) return
      const picked = rf.getNodes().filter(n => n.selected)
      const one = picked.length === 1 ? picked[0] : null
      // AltGr (French, German… keyboards) arrives as Ctrl+Alt: a character typed with it is a bare key, not a combination
      const altGr = e.getModifierState('AltGraph') || (e.ctrlKey && e.altKey && e.key.length === 1 && !/[a-z0-9]/i.test(e.key))
      const ctrl = (e.ctrlKey || e.metaKey) && !altGr
      const alt = e.altKey && !altGr
      // the digit row by position, so it works on AZERTY too (digits need Shift there)
      const digit = /^(Digit|Numpad)\d$/.test(e.code) ? e.code.slice(-1) : ''
      const key = e.key.toLowerCase()
      // Undo and redo for the board's layout (inside a note, Ctrl+Z is the note's own)
      if (ctrl && !alt && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) board.redo()
        else board.undo()
        return
      }
      // Zoom the board, not the page (as Figma): Ctrl + and Ctrl −, Ctrl 0 for 100%
      if (ctrl && !alt && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0' || digit === '0')) {
        e.preventDefault()
        if (e.key === '0' || digit === '0') rf.zoomTo(1, { duration: 200 })
        else if (e.key === '-') rf.zoomOut({ duration: 200 })
        else rf.zoomIn({ duration: 200 })
        return
      }
      // Tidy, as Figma's Tidy up: Ctrl+Alt+T
      if (ctrl && alt && key === 't') {
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
      if (one?.type === 'note' && !ctrl && !alt && (e.key === 'Enter' || (e.key.length === 1 && e.key !== ' '))) {
        if (e.key === 'Enter') e.preventDefault()
        emit('note-focus', { id: one.id })
        return
      }
      // the same for a card with a text box (Today's "Add a task", Later's "Add a link", Snippets' paste box): the
      // box takes the cursor during this keydown, so the key lands in it
      if (one && !ctrl && !alt && (e.key === 'Enter' || (e.key.length === 1 && e.key !== ' '))) {
        const box = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(one.id)}"] [data-typeto]`)
        if (box && box.offsetParent) {
          if (e.key === 'Enter') e.preventDefault()
          box.focus()
          return
        }
      }
      // F2 names a note, as in Explorer
      if (e.key === 'F2' && (one?.type === 'note' || one?.type === 'table' || one?.type === 'section')) {
        e.preventDefault()
        emit('note-rename', { id: one.id })
        return
      }
      if (e.key === ' ' && one && (one.type === 'item' || one.type === 'note')) {
        e.preventDefault()
        board.expand({ type: one.type, ref: one.data.ref })
      }
      // two picked: side by side
      if (e.key === ' ' && picked.length === 2) {
        e.preventDefault()
        board.compareCards(picked.map(n => n.id))
      }
      // Alt+1 to 9: that space
      if (alt && !ctrl && /^[1-9]$/.test(digit)) {
        const to = board.spaces[Number(digit) - 1]
        if (to) {
          e.preventDefault()
          board.switchSpace(to.id)
        }
        return
      }
      // Single keys (see KeysDialog): only bare keys, so Ctrl/Alt combinations stay the browser's and Windows'.
      // A capital letter is typing that missed its box, never a shortcut.
      if (ctrl || alt || e.repeat || (e.shiftKey && /^[a-z]$/.test(key))) return
      // single-letter shortcuts can be turned off in Settings (the list, ?, still opens)
      if (!board.prefs.singleKeys && e.key !== '?') return
      const run: Record<string, () => void> = {
        n: () => board.newSticky(),
        l: () => board.addCard('later', 'later'),
        c: () => board.addCard('snippets', 'snippets'),
        o: () => board.setOutputsOpen(true),
        p: () => board.setPinnedOpen(!board.pinnedOpen),
        q: () => board.setPinnedOpen(!board.pinnedOpen),
        t: () => board.addCard('tasks', 'today'),
        // the journal card, back on today (it's moved, not doubled, if it was on an earlier day)
        j: () =>
          board.prefs.extras.journal &&
          post<{ path: string }>('/api/notes/new', { kind: 'journal' }).then(r => {
            const card = rf.getNodes().find(n => n.type === 'note' && dayOf(n.data.ref))
            if (card && card.data.ref !== r.path) board.retarget(card.id, r.path, true)
            else board.addCard('note', r.path)
          }, err => board.toast(err.message)),
        '0': () => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 }),
        f: () => {
          // every selected card (a sticky note rolls up into its strip); all fold, unless they all are already
          const cards = picked.filter(n => !isSection(n))
          // only sections picked: they fold to their bars (or open), all of them unless they all are
          const sections = picked.filter(isSection)
          if (!cards.length && sections.length) {
            const f = !sections.every(n => n.data.folded)
            for (const s of sections) board.foldSection(s.id, f)
            return
          }
          if (!cards.length) return board.toast('Select a card first, then F folds it')
          const fold = !cards.every(n => n.data.folded)
          const ids = new Set(cards.map(n => n.id))
          board.remember()
          rf.setNodes(ns => ns.map(n => (ids.has(n.id) ? foldNode(n, fold) : n)))
          board.persist()
        },
        ',': () => board.setSettingsOpen(true),
        // spaces: the one before, the one after, the list
        '[': () => {
          const i = board.spaces.findIndex(x => x.id === board.space)
          if (i > 0) board.switchSpace(board.spaces[i - 1].id)
        },
        ']': () => {
          const i = board.spaces.findIndex(x => x.id === board.space)
          if (i < board.spaces.length - 1) board.switchSpace(board.spaces[i + 1].id)
        },
        s: () => emit('spaces-open'),
        // the Dictionary (an extra, when it's on)
        d: () => board.prefs.extras.dictionary && openDictionary(),
        // hide the selected cards' contents (sharing the screen), or show them again
        h: () => {
          if (!picked.length) return board.toast('Select a card first, then H hides its contents')
          board.setVeiled(
            picked.map(n => n.id),
            !picked.every(n => n.data.veiled),
          )
        },
        '?': () => board.setKeysOpen(true),
      }
      const fn = run[e.key.toLowerCase()] ?? (digit === '0' ? run['0'] : undefined)
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [board, rf])

  // Something dragged out of a list (Quick access, Later, Outputs, a folder card) becomes a card where it's dropped;
  // so does a link dragged in from the browser
  const outside = (e: React.DragEvent) => e.dataTransfer.types.includes('text/uri-list') && !e.dataTransfer.types.includes('Files')
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(QUICK_DRAG) && !outside(e) && !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: React.DragEvent) => {
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    // images dropped from Explorer or another app: each a card, side by side (other files: the browser gives their
    // contents, not where they are, so Send to or Choose files is the way for those)
    const files = [...e.dataTransfer.files]
    if (files.length) {
      e.preventDefault()
      const images = files.filter(f => f.type.startsWith('image/'))
      if (!images.length) return board.toast('Only images can be dropped here. For other files: Send to → Cockpit in Explorer, or Choose files in the + box')
      images.slice(0, 12).forEach((f, i) => board.showImage(f, { at: { x: at.x + i * 40, y: at.y + i * 40 } }))
      return
    }
    const raw = e.dataTransfer.getData(QUICK_DRAG)
    if (raw) {
      e.preventDefault()
      try {
        board.putOnBoard(JSON.parse(raw), at)
      } catch {
        // not ours
      }
      return
    }
    const url = e.dataTransfer.getData('text/uri-list').split(/\r?\n/).find(l => /^https?:\/\//i.test(l.trim()))
    if (url) {
      e.preventDefault()
      board.showItem({ url: url.trim() }, { at })
    }
  }

  // right-click on empty board: what applies to the whole board
  // where it was opened stays after it closes: the menu fades out where it was, not at the top-left corner its
  // anchor would jump back to (it flashed there for a moment)
  // (section: the one right-clicked inside, if any: its menu comes first)
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; at: { x: number; y: number }; section?: string } | null>(null)
  const [paneOpen, setPaneOpen] = useState(false)
  // right-clicked inside a section: its own menu first, and only what can go there from the board's (the board-wide
  // items are a right-click outside any section away)
  const inSection = paneMenu?.section ? rf.getNode(paneMenu.section) : undefined
  // the cards on this space that fold (sticky notes fold one at a time, with their own button or F, not all at once;
  // cards in other spaces or tucked away are left as they are)
  const foldable = nodes.filter(n => !n.hidden && !isSticky(n.type, n.data.ref) && !isSection(n))
  const foldAll = (fold: boolean) => {
    if (fold) track('board.foldall')
    const ids = new Set(foldable.filter(n => !!n.data.folded !== fold).map(n => n.id))
    board.remember()
    rf.setNodes(ns => ns.map(n => (ids.has(n.id) ? foldNode(n, fold) : n)))
    board.persist()
  }
  const onlyStickies = nodes.some(n => !n.hidden) && !foldable.length
  const fitAll = () => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 })

  return (
    <div className="board" onDragOver={onDragOver} onDrop={onDrop} onContextMenuCapture={throughDot('menu')} onDoubleClickCapture={throughDot('label')}>
      <DropdownMenu open={arrowOpen} onOpenChange={open => !open && setArrowOpen(false)} modal={false}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden data-anchor="arrow" className="pointer-events-none fixed size-px" style={{ left: arrowMenu?.x ?? 0, top: arrowMenu?.y ?? 0 }} />
        </DropdownMenuTrigger>
        {arrowMenu && (
          <DropdownMenuContent align="start" className="min-w-56" aria-label="Arrow">
            <DropdownMenuItem onSelect={() => setTimeout(() => emit('arrow-label', { id: arrowMenu.id }), 60)}>
              <Tag strokeWidth={1.75} />
              {arrowMenu.data.label ? 'Change the label' : 'Add a label'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => board.setLink(arrowMenu.id, 'reverse')}>
              <ArrowLeftRight strokeWidth={1.75} />
              Point the other way
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => board.setLink(arrowMenu.id, { heads: arrowMenu.data.heads === 'both' ? undefined : 'both' })}>
              <MoveRight strokeWidth={1.75} />
              {arrowMenu.data.heads === 'both' ? 'Arrowhead at one end' : 'Arrowheads at both ends'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => board.setLink(arrowMenu.id, { heads: arrowMenu.data.heads === 'none' ? undefined : 'none' })}>
              <Minus strokeWidth={1.75} />
              {arrowMenu.data.heads === 'none' ? 'Make it an arrow' : 'Plain line, no arrowhead'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => board.setLink(arrowMenu.id, { dash: !arrowMenu.data.dash })}>
              <Spline strokeWidth={1.75} />
              {arrowMenu.data.dash ? 'Solid line' : 'Dashed line'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => board.removeLink(arrowMenu.id)}>
              <Trash2 strokeWidth={1.75} />
              Remove the arrow
              <DropdownMenuShortcut>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
      <DropdownMenu open={paneOpen} onOpenChange={open => !open && setPaneOpen(false)} modal={false}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden data-anchor="board" className="pointer-events-none fixed size-px" style={{ left: paneMenu?.x ?? 0, top: paneMenu?.y ?? 0 }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          {inSection && (
            <>
              <DropdownMenuLabel className="pane-section-label">
                <SquareDashed className="size-3.5" strokeWidth={2} />
                <span className="truncate">{inSection.data.title || 'Section'}</span>
              </DropdownMenuLabel>
              <SectionMenuItems id={inSection.id} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => paneMenu && board.newSticky('', { at: paneMenu.at })}>
            <StickyNote strokeWidth={1.75} />
            Sticky note here
            <DropdownMenuShortcut>N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => paneMenu && board.addSection({ at: paneMenu.at })}>
            <SquareDashed strokeWidth={1.75} />
            Section here
            <DropdownMenuShortcut>Ctrl Alt G</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => board.setPalette(true)}>
            <Plus strokeWidth={1.75} />
            Add or find…
            <DropdownMenuShortcut>Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
          {!inSection && (
            <>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!foldable.some(n => !n.data.folded)} onSelect={() => foldAll(true)}>
            <ChevronsDownUp strokeWidth={1.75} />
            {onlyStickies ? 'Fold all cards (not sticky notes)' : 'Fold all cards'}
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
            </>
          )}
          {!inSection && (
            <>
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
            </>
          )}
          {!inSection && (
            <>
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
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReactFlow<CardNode, LinkEdge>
        nodes={nodes}
        onNodesChange={onChange}
        nodeTypes={nodeTypes}
        edges={edges}
        onEdgesChange={onEdgeChange}
        edgeTypes={edgeTypes}
        // an arrow: drag from the dot on any side of a card to another card; let go on empty board for a new sticky
        // note there, with the arrow to it
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        onConnect={c => c.source && c.target && board.addLink(c.source, c.target)}
        onConnectEnd={(e, state) => {
          if (state.isValid || !state.fromNode) return
          const p = 'changedTouches' in e ? e.changedTouches[0] : e
          const from = state.fromNode.id
          // let go anywhere on a card (not only near one of its dots): the arrow goes to that card
          const over = (document.elementFromPoint(p.clientX, p.clientY)?.closest('.react-flow__node') as HTMLElement | null)?.dataset.id
          if (over) return void (over !== from && board.addLink(from, over))
          board.newSticky('', { at: rf.screenToFlowPosition({ x: p.clientX, y: p.clientY }) }).then(id => id && board.addLink(from, id))
        }}
        onEdgeDoubleClick={(_e, edge) => emit('arrow-label', { id: edge.id })}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault()
          openArrowMenu(e.clientX, e.clientY, edge.id)
        }}
        // a click on a dot doesn't start an arrow (only a drag does): it may be on top of an arrow's end
        connectOnClick={false}
        defaultViewport={initial.viewport ?? { x: 0, y: 0, zoom: 1 }}
        fitView={!initial.viewport && nodes.some(n => !n.hidden)}
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.15}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomActivationKeyCode={null}
        // as FigJam: dragging on empty board selects (a box), scrolling moves around, and so does dragging with the
        // middle button or with Space held; Shift or Ctrl adds a card to the selection
        panOnDrag={[1]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        deleteKeyCode={['Delete']}
        onMoveEnd={() => board.persist()}
        onNodeDragStart={(_e, node, dragged) => {
          board.remember()
          startCarrying(dragged)
          dropping.current = { from: isSection(node) ? undefined : sectionOf(node, rf.getNodes())?.id, over: undefined }
        }}
        // a card dragged over a section it isn't in yet: the section lights up (it joins it there)
        onNodeDrag={(_e, node, dragged) => {
          const d = dropping.current
          if (!d || dragged.some(isSection)) return
          const moving = new Set(dragged.map(n => n.id))
          const s = sectionOf(node, rf.getNodes().filter(n => !moving.has(n.id)))?.id
          const over = s && s !== d.from ? s : undefined
          if (over !== d.over) emit('section-drop', { id: (d.over = over) ?? null })
        }}
        // (after the last move, which carries what's in a section to where it's let go); a card let go half out of
        // a section, or newly in one, has it grow to hold it
        onNodeDragStop={(_e, _node, dragged) => {
          const joined = dropping.current?.over
          if (joined) emit('section-drop', { id: null })
          dropping.current = null
          setTimeout(() => {
            carrying.current = null
            const cards = dragged.filter(n => !isSection(n)).map(n => n.id)
            // dropped into a section on top of what's in it: it moves beside the nearest card there, lined up
            const s = joined && rf.getNode(joined)
            if (s && cards.length === 1) {
              const me = rf.getNode(cards[0])
              const others = contentsOf(s, rf.getNodes()).filter(n => n.id !== cards[0] && !isSection(n))
              const size = me && { w: me.measured?.width ?? me.width ?? 300, h: me.measured?.height ?? me.height ?? 280 }
              const to = me && size && besideSpot(me.position, size, others)
              if (to) rf.setNodes(ns => ns.map(n => (n.id === cards[0] ? { ...n, position: to } : n)))
            }
            setTimeout(() => board.growAround(cards, joined && cards.length === 1 ? joined : undefined), 0)
          }, 0)
        }}
        // the Delete key only (cards taken off in code are kept for Undo where that happens)
        onBeforeDelete={async ({ nodes, edges }) => {
          if (nodes.length) board.removing(nodes as CardNode[])
          else if (edges.length) board.remember()
          return true
        }}
        onPaneClick={() => rf.setNodes(ns => ns.map(n => (n.selected ? { ...n, selected: false } : n)))}
        onPaneContextMenu={e => {
          e.preventDefault()
          track('board.menu')
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          // inside a section (the smallest one there, on this space): its menu, then what can go there
          const section = rf
            .getNodes()
            .filter(n => isSection(n) && !n.hidden && !n.data.folded)
            .map(n => ({ n, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 }))
            .filter(({ n, w, h }) => at.x > n.position.x && at.x < n.position.x + w && at.y > n.position.y && at.y < n.position.y + h)
            .sort((a, b) => a.w * a.h - b.w * b.h)[0]?.n.id
          setPaneMenu({ x: e.clientX, y: e.clientY, at, ...(section ? { section } : {}) })
          setPaneOpen(true)
        }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.8} color="var(--dots)" />
        <AgentFrames />
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

/** Bottom right, as FigJam: zoom out and in (the tooltip says the zoom; Ctrl 0 goes back to 100%), and ? for the
 * keyboard shortcuts. */
function CornerTools() {
  const board = useBoard()
  const rf = useReactFlow()
  const scale = useStore(s => s.transform[2])
  const zoom = Math.round(scale * 100)
  // things pinned to cards (comment bubbles) keep their size on screen at any zoom
  useEffect(() => {
    document.documentElement.style.setProperty('--board-zoom', String(scale))
  }, [scale])
  const tool = (label: string, keys: string, onClick: () => void, children: React.ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={onClick} className="corner-btn">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
        <span className="ml-2 opacity-60">{keys}</span>
      </TooltipContent>
    </Tooltip>
  )
  return (
    <div className="corner-tools">
      <div className="corner-pill glass" role="group" aria-label={`Zoom, ${zoom}%`}>
        {tool(`Zoom out (${zoom}%)`, 'Ctrl −', () => rf.zoomOut({ duration: 200 }), <Minus className="size-[16px]" strokeWidth={1.75} />)}
        <span className="corner-sep" />
        {tool(`Zoom in (${zoom}%)`, 'Ctrl +', () => rf.zoomIn({ duration: 200 }), <Plus className="size-[16px]" strokeWidth={1.75} />)}
      </div>
      <div className="corner-pill corner-round glass">{tool('Keyboard shortcuts', '?', () => board.setKeysOpen(true), <span className="text-[15px] font-medium">?</span>)}</div>
    </div>
  )
}

function Dock() {
  const board = useBoard()
  const rf = useReactFlow()
  const later = laterCounts(board.items).todo
  const update = useData(() => get<UpdateStatus>('/api/update'), [board.settingsOpen], { refreshEvery: 3_600_000 })
  return (
    <nav className="dock glass" aria-label="Cockpit">
      <DockButton label="Add" shortcut="Ctrl K" onClick={() => board.setPalette(true)}>
        <Plus className="size-[18px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label="New sticky note" shortcut="N" onClick={() => board.newSticky()}>
        {/* a little sticky note that peeks up on hover (FigJam's toolbar does this) */}
        <span aria-hidden className={cn('dock-sticky', `paper-${board.prefs.stickyColor}`)} />
      </DockButton>
      <DockButton label="Quick access" shortcut="Q" onClick={() => board.setPinnedOpen(!board.pinnedOpen)} active={board.pinnedOpen}>
        <Pin className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label="Later" shortcut="L" onClick={() => board.addCard('later', 'later')}>
        <Bookmark className="size-[16px]" strokeWidth={1.75} />
        {later > 0 && <span className="dock-dot">{later > 9 ? '9+' : later}</span>}
      </DockButton>
      <DockButton label="Snippets: things to copy" shortcut="C" onClick={() => board.addCard('snippets', 'snippets')}>
        <ClipboardList className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      {/* what Claude Code chats made; always here, so it can be found before anything has arrived */}
      <DockButton label="Outputs" shortcut="O" onClick={() => board.setOutputsOpen(true)} active={board.outputsOpen}>
        <Inbox className="size-[17px]" strokeWidth={1.75} />
        {board.unseenOutputs > 0 && <span className="dock-dot">{board.unseenOutputs > 9 ? '9+' : board.unseenOutputs}</span>}
      </DockButton>
      <span className="mx-0.5 h-5 w-px bg-ink/10" />
      <DockButton label="Show everything" shortcut="0" onClick={() => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 })}>
        <Maximize className="size-[16px]" strokeWidth={1.75} />
      </DockButton>
      <DockButton label={update.data?.available ? `Settings: Cockpit ${update.data.latest?.version} is available` : 'Settings'} shortcut="," onClick={() => board.setSettingsOpen(true)}>
        <Settings2 className="size-[16px]" strokeWidth={1.75} />
        {update.data?.available && <span className="dock-dot is-plain" />}
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
  // each chat folds; the newest is open, the others folded, unless opened or folded by hand (kept in this browser)
  const [folds, setFolds] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('cockpit.outputs.folds') || '{}') || {}
    } catch {
      return {}
    }
  })
  const isOpen = (id: string, n: number) => folds[id] ?? n === 0
  const toggle = (id: string, n: number) =>
    setFolds(f => {
      const next = { ...f, [id]: !(f[id] ?? n === 0) }
      try {
        const live = Object.fromEntries(Object.entries(next).filter(([k]) => board.outputs.some(g => g.id === k)))
        localStorage.setItem('cockpit.outputs.folds', JSON.stringify(live))
      } catch {}
      return next
    })
  const [filters, setFilters] = useState<Record<string, KindFilter>>({})
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
    <Sheet open={board.outputsOpen} onOpenChange={board.setOutputsOpen} modal={false}>
      <SheetContent side="right" className="glass-panel w-[min(460px,calc(100vw-24px))] gap-0 sm:max-w-none">
        <SheetHeader className="pb-2">
          <SheetTitle>Outputs</SheetTitle>
          <SheetDescription className="sr-only">What Claude made, one group per chat, newest turn on top.</SheetDescription>
          {board.outputs.length > 0 && (
            <Button size="sm" variant="ghost" className="absolute top-3.5 right-12 h-7 text-[12.5px] text-muted-foreground" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </SheetHeader>
        <div className="grid min-w-0 grid-cols-1 gap-3 overflow-x-hidden overflow-y-auto px-3 pb-6">
          {!board.outputs.length && (
            <div className="grid gap-3 px-2">
              <p className="text-[13.5px] text-muted-foreground">Nothing here yet. Each Claude Code chat's files, links, drafts and commands arrive as its turns end.</p>
              <p className="text-[13px] text-muted-foreground">Nothing arriving? Check that Cockpit is connected to Claude Code.</p>
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => {
                  board.setOutputsOpen(false)
                  board.setSettingsOpen(true)
                  setTimeout(() => emit('settings-section', { section: 'claude' }), 0)
                }}
              >
                Settings → Claude Code
              </Button>
            </div>
          )}
          {board.outputs.map((g, n) => (
            <section key={g.id} className={cn('out-group min-w-0', !isOpen(g.id, n) && 'is-folded')}>
              <header className="group/head flex items-center gap-2 px-2 pb-1">
                <button type="button" className="out-fold" aria-expanded={isOpen(g.id, n)} onClick={() => toggle(g.id, n)}>
                  <ChevronRight className="out-fold-chev size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13.5px] font-medium">{chatOf(g)}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {g.items.length} {g.items.length === 1 ? 'thing' : 'things'} · {ago(g.updatedAt || g.createdAt)}
                    </span>
                  </span>
                </button>
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
              {isOpen(g.id, n) && (
                <>
                  <KindChips group={g} value={filters[g.id] || 'all'} onChange={f => setFilters(m => ({ ...m, [g.id]: f }))} />
                  <OutputsList group={g} onView={() => board.setOutputsOpen(false)} newSince={since[g.id]} filter={filters[g.id] || 'all'} />
                </>
              )}
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
