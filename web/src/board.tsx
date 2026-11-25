// The board's state and the actions every part of Cockpit uses: put something on the board (or bring it into view
// if it's already there), expand it full screen, open it in its own program, and a few things everything reads
// (Claude's outputs, the library, notes, trackers). React Flow owns the cards' positions and sizes; they are
// saved to the server a moment after they stop changing. Every change to the layout (a move, a resize, Tidy, a
// card added or taken off) can be undone with Ctrl+Z.
import { startAgentBridge } from './agent/bridge'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useReactFlow, useStore, type Edge, type Node } from '@xyflow/react'
import { useTheme, type Theme } from './theme'
import { get, post, put, track, type Board, type BoardCard, type BoardLink, type CardType, type Config, type Editor, type Extras, type NotesList, type OutputGroup, type Often, type Pin, type PinInput, type PinnedList, type CardComment, type ShownEntry, type Space, type StickyColor, type Tracker, type AgentMark } from './api'
import { pack } from './layout'
import { useData, useEvent } from './lib'

export const SIZES: Record<CardType, { w: number; h: number }> = {
  item: { w: 620, h: 700 },
  /** a journal page or a draft (a sticky note is smaller: STICKY) */
  note: { w: 460, h: 480 },
  outputs: { w: 460, h: 340 },
  tasks: { w: 420, h: 480 },
  tracker: { w: 480, h: 600 },
  command: { w: 600, h: 460 },
  later: { w: 440, h: 560 },
  snippets: { w: 400, h: 140 },
  folder: { w: 420, h: 520 },
  table: { w: 520, h: 320 },
  section: { w: 640, h: 420 },
  questions: { w: 440, h: 460 },
}

/** A sticky note: any note that isn't a journal page or a draft (new ones live in notes/stickies). */
export const isSticky = (type: string | undefined, ref: string) => type === 'note' && !/^(journal|drafts)\//.test(ref)
export const STICKY = { w: 300, h: 280 }
export const sizeFor = (type: CardType, ref = '') => (isSticky(type, ref) ? STICKY : SIZES[type])

/** The smallest a card can be made: what it needs to stay usable (Later's tabs and row buttons, say). */
export function minSize(type: CardType, ref = '') {
  if (isSticky(type, ref)) return { w: 200, h: 140 }
  if (type === 'later') return { w: 380, h: 260 }
  if (type === 'snippets') return { w: 320, h: SNIPPETS_MIN_H }
  if (type === 'section') return { w: 240, h: 160 }
  return { w: 260, h: 150 }
}

/** Snippets is never made shorter than its header and the box to paste into. */
export const SNIPPETS_MIN_H = 160

/** A folded card is just its header: the title line and what it's about. */
export const FOLDED_H = 46
/** A sticky note rolls up into its strip (30px) with the roll showing under it. */
export const STICKY_FOLDED_H = 36
/** How tall a card is folded: its title line; a sticky note, its strip. */
/** A folded section is a bar under its title. */
export const SECTION_FOLDED_H = 44
export const foldedH = (type: string | undefined, ref: string) => (type === 'section' ? SECTION_FOLDED_H : isSticky(type, ref) ? STICKY_FOLDED_H : FOLDED_H)

/** openH: the height a folded card goes back to when it's unfolded. */
export type CardData = { ref: string; pulse?: number; born?: number; folded?: boolean; openH?: number; locked?: boolean; color?: StickyColor; sized?: boolean; space?: string; tucked?: boolean; veiled?: boolean; agents?: AgentMark; title?: string; inside?: string }
export type CardNode = Node<CardData, CardType>

/** Cards as tall as what's in them (up to a limit, then they scroll), until a height is dragged by hand (sized). */
export const AUTO_HEIGHT = new Set<CardType>(['snippets'])
/** Cards exactly the size of what's in them, both ways, always (a table is its grid): no size of their own. */
export const HUGS = new Set<CardType>(['table'])
/** True while a card that fits its content is being resized by hand (so its height isn't put back meanwhile). */
export const resizingRef = { current: false }
/** Whether a card sizes itself to its content right now. */
export const fitsContent = (n: { type?: string; data: CardData }) => AUTO_HEIGHT.has(n.type as CardType) && !n.data.sized

const keepsSize = (c: BoardCard) => !!c.sized && !(c.type === 'snippets' && c.h < SNIPPETS_MIN_H)

export const toNode = (c: BoardCard): CardNode => ({
  id: c.id,
  type: c.type,
  position: { x: c.x, y: c.y },
  data: { ref: c.ref, ...(c.folded ? { folded: true, openH: c.h } : {}), ...(c.locked ? { locked: true } : {}), ...(c.color ? { color: c.color } : {}), ...(keepsSize(c) ? { sized: true } : {}), ...(c.space && c.space !== 'main' ? { space: c.space } : {}), ...(c.tucked ? { tucked: true } : {}), ...(c.veiled ? { veiled: true } : {}), ...(c.agents ? { agents: c.agents } : {}), ...(c.title ? { title: c.title } : {}), ...(c.inside ? { inside: c.inside } : {}) },
  width: HUGS.has(c.type) ? undefined : c.w,
  height: c.folded ? foldedH(c.type, c.ref) : HUGS.has(c.type) || (AUTO_HEIGHT.has(c.type) && !keepsSize(c)) ? undefined : c.h,
  dragHandle: '.card-drag',
  ...(c.locked ? { draggable: false, deletable: false } : {}),
  ...(c.type === 'section' ? { zIndex: SECTION_Z } : {}),
})

export const fromNode = (n: CardNode): BoardCard => ({
  id: n.id,
  type: n.type as CardType,
  ref: n.data.ref,
  x: Math.round(n.position.x),
  y: Math.round(n.position.y),
  w: Math.round(n.width ?? n.measured?.width ?? SIZES[n.type as CardType].w),
  h: Math.round(n.data.folded ? (n.data.openH ?? SIZES[n.type as CardType].h) : (n.height ?? n.measured?.height ?? SIZES[n.type as CardType].h)),
  ...(n.data.folded ? { folded: true } : {}),
  ...(n.data.locked ? { locked: true } : {}),
  ...(n.data.color ? { color: n.data.color } : {}),
  ...(n.data.sized ? { sized: true } : {}),
  ...(n.data.space && n.data.space !== 'main' ? { space: n.data.space } : {}),
  ...(n.data.tucked ? { tucked: true } : {}),
  ...(n.data.veiled ? { veiled: true } : {}),
  ...(n.data.agents ? { agents: n.data.agents } : {}),
  ...(n.type === 'section' && n.data.title ? { title: n.data.title } : {}),
  ...(n.data.inside ? { inside: n.data.inside } : {}),
})

// ---- arrows ---------------------------------------------------------------------------------------------------
// An arrow from one card to another is a React Flow edge. React Flow leaves out an edge whose card is hidden, so an
// arrow shows only while both its cards are on the board.
export type LinkData = { label?: string; dash?: boolean; heads?: 'both' | 'none'; fromSide?: BoardLink['fromSide']; toSide?: BoardLink['toSide'] }
export type LinkEdge = Edge<LinkData, 'arrow'>

export const toEdge = (l: BoardLink): LinkEdge => ({
  id: l.id,
  type: 'arrow',
  source: l.from,
  target: l.to,
  data: { ...(l.label ? { label: l.label } : {}), ...(l.dash ? { dash: true } : {}), ...(l.heads ? { heads: l.heads } : {}), ...(l.fromSide ? { fromSide: l.fromSide } : {}), ...(l.toSide ? { toSide: l.toSide } : {}) },
})

export const fromEdge = (e: Edge): BoardLink => {
  const d = (e.data || {}) as LinkData
  return {
    id: e.id,
    from: e.source,
    to: e.target,
    ...(d.fromSide ? { fromSide: d.fromSide } : {}),
    ...(d.toSide ? { toSide: d.toSide } : {}),
    ...(d.label?.trim() ? { label: d.label.trim() } : {}),
    ...(d.dash ? { dash: true } : {}),
    ...(d.heads ? { heads: d.heads } : {}),
  }
}

// ---- sections -------------------------------------------------------------------------------------------------
// A section is an area on the board with a title, drawn behind the cards. Nothing ties a card to it: the cards whose
// middle is inside it are in it, so dropping a card in puts it there and dragging it out takes it out. Dragging the
// section by its title takes what's in it along.
/** Below every card, selected or not (React Flow lifts a selected node by 1000). */
export const SECTION_Z = -5000
export const isSection = (n: { type?: string }) => n.type === 'section'
const boxOf = (n: CardNode) => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? SIZES[n.type as CardType]?.w ?? 0, h: n.height ?? n.measured?.height ?? SIZES[n.type as CardType]?.h ?? 0 })
/** Whether a card (or a smaller section) is in a section: its middle is inside it. */
export function inSection(section: CardNode, n: CardNode) {
  if (n.id === section.id || n.hidden) return false
  const s = boxOf(section)
  const b = boxOf(n)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  // a section isn't in one smaller than itself
  if (isSection(n) && b.w * b.h >= s.w * s.h) return false
  return cx > s.x && cx < s.x + s.w && cy > s.y && cy < s.y + s.h
}
/** What a section holds now: the cards (and smaller sections) whose middle is in it. */
export const contentsOf = (section: CardNode, nodes: CardNode[]) => nodes.filter(n => inSection(section, n))
/** The section a card is in: the smallest one holding it. */
export function sectionOf(n: CardNode, nodes: CardNode[]) {
  const holding = nodes.filter(s => isSection(s) && !s.hidden && inSection(s, n))
  return holding.sort((a, b) => boxOf(a).w * boxOf(a).h - boxOf(b).w * boxOf(b).h)[0]
}

/** Off the board right now: in another space, tucked away at the top edge, or inside a folded or tucked section. */
export const offBoard = (c: { space?: string; tucked?: boolean; inside?: string }, space: string) => (c.space || 'main') !== space || !!c.tucked || !!c.inside

// A section folded (just its bar) or tucked away holds what was in it: each of those cards says which section
// ("inside"), hidden, where it was. They come back when the section opens or comes back. A section in a section that
// goes is held the same way, and its own cards stay with it.
/** The cards a section holds while it's folded or tucked, and the ones they hold in turn. */
export function heldBy(id: string, nodes: CardNode[]): CardNode[] {
  const out: CardNode[] = []
  let ids = new Set([id])
  for (let i = 0; i < 6 && ids.size; i++) {
    const next = nodes.filter(n => n.data.inside && ids.has(n.data.inside))
    out.push(...next)
    ids = new Set(next.map(n => n.id))
  }
  return out
}
/** Lets go of cards whose section is gone, open again or back: they're on the board again (if in this space). */
export function settle(ns: CardNode[], space: string): CardNode[] {
  let out = ns
  for (let i = 0; i < 6; i++) {
    const byId = new Map(out.map(n => [n.id, n]))
    let changed = false
    out = out.map(n => {
      if (!n.data.inside) return n
      const s = byId.get(n.data.inside)
      if (s && (s.data.folded || s.data.tucked || s.data.inside)) return n
      changed = true
      const { inside: _i, ...data } = n.data
      return { ...n, data, hidden: offBoard({ space: data.space, tucked: data.tucked }, space) }
    })
    if (!changed) break
  }
  return out
}
/** Whether some card is held by a section that no longer holds it (settle would change something). */
export const unsettled = (ns: CardNode[]) => {
  const byId = new Map(ns.map(n => [n.id, n]))
  return ns.some(n => {
    if (!n.data.inside) return false
    const s = byId.get(n.data.inside)
    return !s || !(s.data.folded || s.data.tucked || s.data.inside)
  })
}

/** The space a card is in. */
export const spaceOf = (n: { data: CardData }) => n.data.space || 'main'

/** The same card folded to its header, or opened back to its height. */
export function foldNode(n: CardNode, fold: boolean): CardNode {
  if (!!n.data.folded === fold) return n
  if (fold) return { ...n, height: foldedH(n.type, n.data.ref), data: { ...n.data, folded: true, openH: n.height ?? n.measured?.height ?? SIZES[n.type as CardType].h } }
  const { folded, openH, ...data } = n.data
  return { ...n, height: fitsContent({ type: n.type, data }) || HUGS.has(n.type as CardType) ? undefined : (openH ?? SIZES[n.type as CardType].h), data }
}

/** The same card locked in place (no moving by hand or by Tidy, no resizing, no Delete key), or free again. */
export function lockNode(n: CardNode, locked: boolean): CardNode {
  const { locked: _was, ...data } = n.data
  return { ...n, draggable: !locked, deletable: !locked, data: locked ? { ...data, locked: true } : data }
}

type Box = { x: number; y: number; w: number; h: number }
/** The nearest spot to pos where a card of this size touches none of these cards, in rings around it. */
export function freeSpot(pos: { x: number; y: number }, size: { w: number; h: number }, nodes: CardNode[]) {
  const GAP = 28
  const boxes: Box[] = nodes.map(n => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? 400, h: n.height ?? n.measured?.height ?? 300 }))
  const clear = (p: { x: number; y: number }) =>
    boxes.every(b => p.x + size.w + GAP <= b.x || b.x + b.w + GAP <= p.x || p.y + size.h + GAP <= b.y || b.y + b.h + GAP <= p.y)
  if (clear(pos)) return pos
  const step = 120
  for (let ring = 1; ring <= 40; ring++) {
    const spots: { x: number; y: number; d: number }[] = []
    for (let i = -ring; i <= ring; i++)
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) spots.push({ x: pos.x + dx * step, y: pos.y + dy * step, d: Math.hypot(dx, dy) })
    spots.sort((a, b) => a.d - b.d)
    const found = spots.find(clear)
    if (found) return { x: found.x, y: found.y }
  }
  return pos
}

/** Something that opens full screen: a kept file or page, or a note. */
export type Shown = { type: 'item' | 'note'; ref: string }
/** Full screen: one thing, or two side by side (beside, on the right) to compare. */
export type Expanded = (Shown & { beside?: Shown }) | null
/** Where a new card goes: beside another card (near), at a point on the board (at, where something was dropped), or else the middle. */
export type PlaceOpts = { near?: string; at?: { x: number; y: number }; size?: { w: number; h: number } }
/** Something from Quick access: a pin or an often-opened thing. */
export type QuickThing = { kind: Pin['kind'] | 'item' | 'text'; target: string; title: string }
/** A button in the toast: Undo, mostly. */
/** ms: how long it stays (default 5 s with a button) */
export type ToastAction = { label: string; run: () => void; ms?: number }
/** How the board behaves (Settings). */
/** The theme the page was last drawn in (until the settings arrive). */
function savedTheme(): Theme {
  try {
    const t = localStorage.getItem('cockpit.theme')
    return t === 'dark' || t === 'light' || t === 'system' ? t : 'system'
  } catch {
    return 'system'
  }
}

export type Prefs = { stickyColor: StickyColor; singleKeys: boolean; tidyGap: number; changelog: string; editor: Editor; theme: Theme; extras: Extras }
const DEFAULT_PREFS: Prefs = { stickyColor: 'ink', singleKeys: true, tidyGap: 24, changelog: '', editor: 'notepad', theme: savedTheme(), extras: { dictionary: false, tables: false, journal: false } }

interface Ctx {
  addCard: (type: CardType, ref: string, opts?: PlaceOpts) => string
  /** Takes a card off the board (Undo in the toast brings it back). quiet: no toast, for when the card's thing is gone anyway. */
  removeCard: (id: string, opts?: { quiet?: boolean }) => void
  /** Cards React Flow is about to take off (the Delete key): kept for Undo first. */
  removing: (nodes: CardNode[]) => void
  /** Points a card at something else (with show, brings it into view and selects it). */
  retarget: (id: string, ref: string, show?: boolean) => void
  /** Puts a file, link, folder or written content on the board; resolves to the card's id (none if it failed). */
  showItem: (body: Record<string, unknown>, opts?: PlaceOpts) => Promise<string | undefined>
  /** A pasted or dropped image (the browser has its bytes, not a path): kept as a file, shown as a card. */
  showImage: (file: File, opts?: PlaceOpts) => Promise<string | undefined>
  /** Keeps a link or a short note on the Later list (and puts the list on the board if it isn't there). */
  saveLater: (body: { url?: string; path?: string; text?: string; title?: string }) => Promise<void>
  /** Moves a kept thing on the Later list: to check, reading, done, or off the list (null). */
  setLater: (id: string, later: ShownEntry['later'] | null) => Promise<void>
  /** Changes the words of a note kept on Later. */
  setLaterText: (id: string, text: string) => Promise<void>
  /** Names a kept thing by hand (a form whose page has no useful title, say). */
  renameItem: (id: string, title: string) => Promise<void>
  /** A new sticky note on the board, ready to type in (with some words already, if given). */
  /** Resolves to the new card's id (none if it failed). */
  newSticky: (text?: string, opts?: PlaceOpts) => Promise<string | undefined>
  setColor: (id: string, color: StickyColor) => void
  /** Locks cards in place, or frees them. */
  setLocked: (ids: string[], locked: boolean) => void
  /** Keeps the layout as it is now, so the next change to it can be undone. */
  remember: () => void
  undo: () => void
  redo: () => void
  /** Focus: one card in the middle, every other card folded onto a shelf at its left. Again: all back as it was. */
  focusing: boolean
  /** Focus on a card, or several side by side (the selected ones if none are named); again: everything back. */
  toggleFocus: (id?: string | string[]) => void
  /** Two cards full screen side by side, the one further left on the left. Only files, pages and notes open full screen. */
  compareCards: (ids: string[], inOrder?: boolean) => void
  /** Packs every card (but locked ones) from the top-left of the screen, sizes and order kept. */
  tidy: () => void
  /** The keyboard shortcuts list. */
  keysOpen: boolean
  setKeysOpen: (open: boolean) => void
  expand: (e: Expanded) => void
  expanded: Expanded
  toast: (text: string, action?: ToastAction) => void
  toastText: string
  toastAction: ToastAction | null
  copy: (text: string, what?: string) => Promise<void>
  /** Opens a web link through Windows, so the default browser (or a browser picker) chooses where it goes. */
  openLink: (url: string) => void
  palette: boolean
  setPalette: (open: boolean, seed?: string) => void
  paletteSeed: string
  outputsOpen: boolean
  setOutputsOpen: (open: boolean) => void
  /** Pinned: what is opened often, in a panel from the left. */
  pinnedOpen: boolean
  setPinnedOpen: (open: boolean, auto?: boolean) => void
  /** Quick access stays open beside the board until closed by hand. */
  quickKept: boolean
  setQuickKept: (on: boolean) => void
  pinned: PinnedList
  pin: (body: PinInput) => Promise<void>
  openPin: (p: Pin, how?: 'default' | 'reveal') => Promise<void>
  /** Opens something from Often opened the way it is usually opened (in Cockpit or outside). */
  openOften: (o: Often, how?: 'usual' | 'outside') => Promise<void>
  /** Reads a pin full screen in Cockpit instead of its own program. */
  readPin: (p: QuickThing) => Promise<void>
  /** A card for a pin (or an often-opened thing), where it was dropped or in a free spot. */
  putOnBoard: (p: QuickThing, at?: { x: number; y: number }) => Promise<unknown>
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  prefs: Prefs
  reloadPrefs: () => void
  /** What's new: the changelog, full screen. */
  openChangelog: () => Promise<void>
  /** Send feedback: a new GitHub issue with the version and Windows build filled in. */
  sendFeedback: () => void
  outputs: OutputGroup[]
  unseenOutputs: number
  reloadOutputs: () => void
  items: ShownEntry[]
  notes: NotesList | null
  trackers: Tracker[]
  versions: Record<string, number>
  persist: () => void
  /** Spaces: boards of their own; the one shown now. */
  spaces: Space[]
  space: string
  switchSpace: (id: string) => void
  /** Makes a space (named, or "Space 2") and goes to it; returns its id. */
  newSpace: (name?: string) => string
  renameSpace: (id: string, name: string) => void
  /** Removes a space; its cards go to Main. */
  deleteSpace: (id: string) => void
  /** Sends cards to another space (out of view here); Undo brings them back. */
  moveToSpace: (ids: string[], space: string) => void
  /** Comments on cards, by card id. */
  comments: Record<string, CardComment[]>
  addComment: (card: string, text: string, by?: 'you' | 'Claude') => Promise<void>
  removeComment: (id: string) => Promise<void>
  /** Tucks cards away: tabs at the top edge of the screen, off the board, until brought back. */
  tuck: (ids: string[]) => void
  /** Brings a tucked card back to where it was. */
  untuck: (id: string) => void
  /** Hides (blurs) cards' contents, or shows them again: for sharing the screen. */
  setVeiled: (ids: string[], veiled: boolean) => void
  /** Shares cards with agents, makes them private, or puts them back to their space's say (null). */
  setCardAgents: (ids: string[], mark: AgentMark | null) => void
  /** The same for a whole space. */
  setSpaceAgents: (id: string, mark: AgentMark | null) => void
  /** Draws an arrow from one card to another (not a second one between the same two); returns its id. */
  addLink: (from: string, to: string, data?: LinkData) => string | undefined
  /** Changes an arrow: its label, dashes, heads, or which way it points (reverse). */
  setLink: (id: string, change: Partial<LinkData> | 'reverse') => void
  removeLink: (id: string) => void
  /** Takes several cards off the board at once (locked ones stay); one Undo brings them back. */
  removeCards: (ids: string[]) => void
  /** A new section around these cards, or at a spot, or in the middle of the screen; returns its id. */
  addSection: (opts?: { around?: string[]; at?: { x: number; y: number }; title?: string }) => string
  setSectionTitle: (id: string, title: string) => void
  /** Makes a section just big enough for what's in it; false when it holds nothing. */
  fitSection: (id: string) => boolean
  /** Folds a section to its bar (what's in it hidden, where it was) or opens it again. */
  foldSection: (id: string, fold: boolean) => void
  /** What's in a section: the cards on the board in it, and the ones it holds while folded. */
  sectionCards: (id: string) => CardNode[]
}

const BoardCtx = createContext<Ctx | null>(null)

export function useBoard() {
  const c = useContext(BoardCtx)
  if (!c) throw new Error('useBoard outside BoardProvider')
  return c
}

export function BoardProvider({ children, initial }: { children: ReactNode; initial: Board }) {
  const rf = useReactFlow<CardNode>()
  const [spaces, setSpacesState] = useState<Space[]>(initial.spaces?.length ? initial.spaces : [{ id: 'main', name: 'Main' }])
  const [space, setSpaceState] = useState(initial.space || 'main')
  const spacesRef = useRef(spaces)
  const spaceRef = useRef(space)
  const setSpaces = (next: Space[]) => {
    spacesRef.current = next
    setSpacesState(next)
  }
  const setSpace = (id: string) => {
    spaceRef.current = id
    setSpaceState(id)
  }
  const [expanded, setExpanded] = useState<Expanded>(null)
  const [toastState, setToastState] = useState<{ text: string; action: ToastAction | null }>({ text: '', action: null })
  const [palette, setPaletteOpen] = useState(false)
  const [paletteSeed, setPaletteSeed] = useState('')
  const [outputsOpen, setOutputsOpen] = useState(false)
  const [pinnedOpen, setPinnedOpenState] = useState(false)
  // Quick access kept open: it stays beside the board until closed by hand (remembered on this PC)
  const [quickKept, setQuickKeptState] = useState(() => {
    try {
      return localStorage.getItem('cockpit.quickKept') === '1'
    } catch {
      return false
    }
  })
  const quickKeptRef = useRef(quickKept)
  quickKeptRef.current = quickKept
  const setQuickKept = useCallback((on: boolean) => {
    setQuickKeptState(on)
    try {
      localStorage.setItem('cockpit.quickKept', on ? '1' : '0')
    } catch {
      // private window: for this visit only
    }
  }, [])
  /** Opens or closes Quick access; something opened from it (auto) leaves it open when it's kept open. */
  const setPinnedOpen = useCallback((open: boolean, auto?: boolean) => {
    if (!open && auto && quickKeptRef.current) return
    setPinnedOpenState(open)
  }, [])
  useEffect(() => {
    if (quickKept) setPinnedOpenState(true)
  }, [quickKept])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  useEffect(() => void (settingsOpen && track('settings.open')), [settingsOpen])
  useEffect(() => void (keysOpen && track('keys.open')), [keysOpen])
  useEffect(() => void (outputsOpen && track('outputs.open')), [outputsOpen])
  const [versions, setVersions] = useState<Record<string, number>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The cards and arrows as saved (set below, with undo). */
  const layoutRef = useRef<() => { cards: BoardCard[]; links: BoardLink[] }>(() => ({ cards: [], links: [] }))
  const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const outputs = useData(() => get<OutputGroup[]>('/api/outputs'), [], { refreshEvery: 60_000 })
  const items = useData(() => get<ShownEntry[]>('/api/shown'), [], { refreshOn: ['shown'] })
  const notes = useData(() => get<NotesList>('/api/notes'), [], { refreshOn: ['notes'] })
  const trackers = useData(() => get<Tracker[]>('/api/trackers'), [], { refreshEvery: 300_000, refreshOn: ['trackers'] })
  const pinned = useData(() => get<PinnedList>('/api/pinned'), [], { refreshOn: ['pinned'] })
  const config = useData(() => get<Config>('/api/config'), [])
  const prefs = useMemo<Prefs>(
    () => (config.data ? { stickyColor: config.data.stickyColor, singleKeys: config.data.singleKeys, tidyGap: config.data.tidyGap, changelog: config.data.changelog, editor: config.data.editor || 'notepad', theme: config.data.theme || 'system', extras: { dictionary: !!config.data.extras?.dictionary, tables: !!config.data.extras?.tables, journal: !!config.data.extras?.journal } } : DEFAULT_PREFS),
    [config.data],
  )
  const prefsRef = useRef(prefs)
  useTheme(prefs.theme)
  prefsRef.current = prefs
  useEvent('outputs', () => outputs.reload())

  const toast = useCallback((text: string, action?: ToastAction) => {
    setToastState({ text, action: action ?? null })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    // with a button in it, it stays long enough to reach
    toastTimer.current = setTimeout(() => setToastState({ text: '', action: null }), action ? (action.ms ?? 5000) : 2600)
  }, [])
  const clearToast = useCallback(() => setToastState({ text: '', action: null }), [])

  // Cockpit's board tools (experimental): an agent's call is run here; a removal waits for the person's Allow
  useEffect(() => {
    startAgentBridge(
      (text, button = 'Allow') =>
        new Promise<boolean>(resolve => {
          let answered = false
          toast(text, { label: button, ms: 20_000, run: () => ((answered = true), resolve(true)) })
          setTimeout(() => !answered && resolve(false), 20_000)
        }),
    )
  }, [toast])

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const viewport = rf.getViewport()
      // each space keeps where its view was
      const spacesNow = spacesRef.current.map(x => (x.id === spaceRef.current ? { ...x, viewport } : x))
      const { cards, links } = layoutRef.current()
      const body: Board = { cards, viewport, spaces: spacesNow, space: spaceRef.current, links }
      put('/api/board', body).catch(() => toast("Couldn't save the board's layout"))
    }, 600)
  }, [rf, toast])

  /** Cards glide to where they're put (Tidy, Undo) instead of jumping; dragging stays instant. */
  const glide = useCallback(() => {
    const el = document.querySelector('.board')
    el?.classList.add('is-arranging')
    if (glideTimer.current) clearTimeout(glideTimer.current)
    glideTimer.current = setTimeout(() => el?.classList.remove('is-arranging'), 460)
  }, [])

  /** A sticky note or a table taken off the board while still empty is just a blank file: it goes (the server checks
   * it's empty). A table waits out the toast's Undo first. */
  const discardIfEmpty = useCallback(
    (ref: string, type: CardType = 'note') => {
      setTimeout(
        () => {
          if (rf.getNodes().some(n => n.type === type && n.data.ref === ref)) return // brought back meanwhile
          post(type === 'table' ? '/api/tables/discard' : '/api/notes/discard', { path: ref }).catch(() => {}) // refused when it has writing in it: kept
        },
        type === 'table' ? 6000 : 1500,
      )
    },
    [rf],
  )
  const discardable = (n: CardNode) => isSticky(n.type, n.data.ref) || n.type === 'table'

  // ---- undo -----------------------------------------------------------------------------------------------------
  // The whole layout (every card with its place, size, fold and lock, and the arrows between them) before each
  // change; Ctrl+Z puts it back.
  type Layout = { cards: BoardCard[]; links: BoardLink[] }
  const past = useRef<Layout[]>([])
  const future = useRef<Layout[]>([])
  const layoutNow = useCallback((): Layout => {
    const cards = rf.getNodes().map(fromNode)
    const ids = new Set(cards.map(c => c.id))
    // an arrow whose card was taken off goes with it (Undo brings both back)
    return { cards, links: rf.getEdges().filter(e => ids.has(e.source) && ids.has(e.target)).map(fromEdge) }
  }, [rf])
  layoutRef.current = layoutNow
  const remember = useCallback(() => {
    const now = layoutNow()
    const last = past.current[past.current.length - 1]
    if (last && JSON.stringify(last) === JSON.stringify(now)) return
    past.current.push(now)
    if (past.current.length > 60) past.current.shift()
    future.current = []
  }, [layoutNow])
  const apply = useCallback(
    (layout: Layout) => {
      const nodes = rf.getNodes()
      const picked = new Set(nodes.filter(n => n.selected).map(n => n.id))
      const kept = new Set(layout.cards.map(c => c.id))
      for (const n of nodes) if (!kept.has(n.id) && discardable(n)) discardIfEmpty(n.data.ref, n.type as CardType)
      glide()
      rf.setNodes(layout.cards.map(c => ({ ...toNode(c), hidden: offBoard(c, spaceRef.current), selected: picked.has(c.id) })))
      rf.setEdges(layout.links.map(toEdge))
      persist()
    },
    [rf, glide, persist, discardIfEmpty],
  )
  const focusSavedRef = useRef<{ focus: string | string[] } | null>(null)
  /** The cards in focus (one, or several side by side). */
  const inFocus = (id: string) => [focusSavedRef.current?.focus ?? []].flat().includes(id)
  const undo = useCallback(() => {
    track('board.undo')
    if (focusSavedRef.current) return toast('Bring everything back first')
    const prev = past.current.pop()
    if (!prev) return toast('Nothing to undo')
    future.current.push(layoutNow())
    apply(prev)
    clearToast()
  }, [apply, layoutNow, toast, clearToast])
  const redo = useCallback(() => {
    if (focusSavedRef.current) return toast('Bring everything back first')
    const next = future.current.pop()
    if (!next) return toast('Nothing to redo')
    past.current.push(layoutNow())
    apply(next)
  }, [apply, layoutNow, toast])
  // for buttons made before the latest undo existed (a toast's Undo)
  const undoRef = useRef(undo)
  undoRef.current = undo

  const focus = useCallback(
    (id: string) => {
      // asked for by name (the dock, the + box): a folded card opens up again
      rf.setNodes(ns => ns.map(n => (n.id === id ? { ...foldNode(n, false), selected: true, data: { ...foldNode(n, false).data, pulse: Date.now() } } : { ...n, selected: false })))
      requestAnimationFrame(() => rf.fitView({ nodes: [{ id }], duration: 320, padding: 0.25, maxZoom: 1, minZoom: Math.min(rf.getZoom(), 1) }))
    },
    [rf],
  )

  // ---- tucked away, contents hidden ---------------------------------------------------------------------------
  const tuck = useCallback(
    (ids: string[]) => {
      const set = new Set(ids)
      if (!set.size) return
      const here = rf.getNodes().filter(n => !n.hidden)
      // a section tucked takes what's in it along: one tab, and they come back with it
      const held = new Map<string, string>()
      const bySize = here.filter(isSection).sort((a, b) => boxOf(a).w * boxOf(a).h - boxOf(b).w * boxOf(b).h)
      for (const s of bySize.filter(s => set.has(s.id)))
        for (const n of contentsOf(s, here))
          if (!held.has(n.id)) {
            held.set(n.id, s.id)
            set.delete(n.id)
          }
      // the last cards out of a section take it with them (no empty box left behind)
      let along = 0
      for (const s of bySize.filter(s => !set.has(s.id) && !held.has(s.id))) {
        const inS = contentsOf(s, here)
        if (!inS.length || !inS.every(n => set.has(n.id) || held.has(n.id))) continue
        set.add(s.id)
        along++
        for (const n of inS)
          if (set.has(n.id)) {
            set.delete(n.id)
            held.set(n.id, s.id)
          }
      }
      remember()
      rf.setNodes(ns =>
        ns.map(n =>
          set.has(n.id)
            ? { ...n, hidden: true, selected: false, data: { ...n.data, tucked: true } }
            : held.has(n.id)
            ? { ...n, hidden: true, selected: false, data: { ...n.data, inside: held.get(n.id) } }
            : n,
        ),
      )
      persist()
      const sections = [...set].filter(id => isSection(rf.getNode(id) ?? {}))
      const words =
        set.size === 1 && sections.length === 1
          ? along
            ? 'Tucked away at the top, with its section'
            : 'Section tucked away at the top, with what was in it'
          : set.size === 1
          ? 'Tucked away at the top'
          : `${set.size} tucked away at the top`
      toast(words, { label: 'Undo', run: () => undoRef.current() })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, remember, persist, toast],
  )
  const untuck = useCallback(
    (id: string) => {
      const n = rf.getNode(id)
      if (!n) return
      remember()
      // a card held by a section (folded or tucked) comes out with the section, opened
      const out = new Set<string>()
      for (let x: CardNode | undefined = n; x?.data.inside; ) {
        x = rf.getNode(x.data.inside)
        if (x) out.add(x.id)
      }
      const { tucked: _t, ...data } = n.data
      rf.setNodes(ns =>
        settle(
          ns.map(x => {
            if (x.id === id) return { ...x, hidden: false, selected: true, data: { ...data, pulse: Date.now() } }
            if (!out.has(x.id)) return { ...x, selected: false }
            const { tucked: _xt, ...d } = foldNode(x, false).data
            return { ...foldNode(x, false), hidden: offBoard({ ...d }, spaceRef.current), selected: false, data: d }
          }),
          spaceRef.current,
        ),
      )
      persist()
      // back where it was; the view goes to it only if that's out of sight
      requestAnimationFrame(() => {
        const m = rf.getNode(id)
        if (!m) return
        const w = m.measured?.width ?? m.width ?? 400
        const h = m.measured?.height ?? m.height ?? 300
        const a = rf.flowToScreenPosition(m.position)
        const z = rf.getZoom()
        const seen = a.x < innerWidth && a.y < innerHeight && a.x + w * z > 0 && a.y + h * z > 0
        if (!seen) rf.setCenter(m.position.x + w / 2, m.position.y + h / 2, { zoom: z, duration: 320 })
      })
    },
    [rf, remember, persist],
  )
  const setCardAgents = useCallback(
    (ids: string[], mark: AgentMark | null) => {
      const set = new Set(ids)
      rf.setNodes(ns =>
        ns.map(n => {
          if (!set.has(n.id)) return n
          const { agents: _a, ...data } = n.data
          return { ...n, data: mark ? { ...data, agents: mark } : data }
        }),
      )
      persist()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf],
  )
  const setSpaceAgents = useCallback(
    (id: string, mark: AgentMark | null) => {
      setSpaces(
        spacesRef.current.map(x => {
          if (x.id !== id) return x
          const { agents: _a, ...rest } = x
          return mark ? { ...rest, agents: mark } : rest
        }),
      )
      persist()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const setVeiled = useCallback(
    (ids: string[], veiled: boolean) => {
      const set = new Set(ids)
      rf.setNodes(ns =>
        ns.map(n => {
          if (!set.has(n.id)) return n
          const { veiled: _v, ...data } = n.data
          return { ...n, data: veiled ? { ...data, veiled: true } : data }
        }),
      )
      persist()
    },
    [rf, persist],
  )

  const addCard = useCallback(
    (type: CardType, ref: string, opts: PlaceOpts = {}) => {
      track(`card.${type}`)
      const existing = rf.getNodes().find(n => n.type === type && n.data.ref === ref)
      // already here: shown; in another space: it comes to this one, to a free spot
      const moving = existing && spaceOf(existing) !== spaceRef.current ? existing : null
      if (existing && !moving) {
        // tucked away: it comes back out
        if (existing.data.tucked || existing.data.inside) untuck(existing.id)
        else focus(existing.id)
        return existing.id
      }
      remember()
      const size = moving
        ? { w: moving.width ?? moving.measured?.width ?? sizeFor(type, ref).w, h: moving.height ?? moving.measured?.height ?? sizeFor(type, ref).h }
        : (opts.size ?? sizeFor(type, ref))
      const near = opts.near ? rf.getNode(opts.near) : undefined
      let pos = opts.at
        ? { x: opts.at.x - size.w / 2, y: opts.at.y - 20 }
        : near
        ? { x: near.position.x + (near.width ?? near.measured?.width ?? 400) + 28, y: near.position.y }
        : (() => {
            const c = rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 })
            return { x: c.x - size.w / 2, y: c.y - size.h / 2 }
          })()
      // a new card goes where nothing else is: the nearest free spot to where it was meant to go, in rings
      // around it, so it never lands on top of a card already there
      // (a section isn't in the way: a card can go in one)
      pos = freeSpot(pos, size, rf.getNodes().filter(n => !n.hidden && n.id !== moving?.id && !isSection(n)))
      const here = spaceRef.current === 'main' ? {} : { space: spaceRef.current }
      const id = moving ? moving.id : `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      if (moving) {
        const { space: _from, tucked: _t, ...data } = moving.data
        rf.setNodes(ns => ns.map(n => (n.id === id ? { ...n, position: pos, hidden: false, selected: true, data: { ...data, ...here, pulse: Date.now() } } : { ...n, selected: false })))
      } else
        rf.setNodes(ns => [
          ...ns.map(n => ({ ...n, selected: false })),
          { id, type, position: pos, data: { ref, pulse: Date.now(), born: Date.now(), ...here }, width: HUGS.has(type) ? undefined : size.w, height: AUTO_HEIGHT.has(type) || HUGS.has(type) ? undefined : size.h, selected: true, dragHandle: '.card-drag' },
        ])
      // dropped somewhere on purpose: stay where the user is looking
      if (!opts.at) requestAnimationFrame(() => rf.fitView({ nodes: [{ id }], duration: 320, padding: 0.25, maxZoom: 1, minZoom: Math.min(rf.getZoom(), 1) }))
      persist()
      return id
    },
    [rf, focus, persist, remember, untuck],
  )

  const toggleFocusRef = useRef<(id?: string) => void>(() => {})

  const removing = useCallback(
    (nodes: CardNode[]) => {
      if (!nodes.length) return
      remember()
      if (focusSavedRef.current && nodes.some(n => inFocus(n.id))) toggleFocusRef.current()
      for (const n of nodes) if (discardable(n)) discardIfEmpty(n.data.ref, n.type as CardType)
      toast(nodes.length === 1 ? 'Taken off the board' : `${nodes.length} cards taken off the board`, { label: 'Undo', run: () => undoRef.current() })
    },
    [remember, discardIfEmpty, toast],
  )

  const removeCard = useCallback(
    (id: string, opts: { quiet?: boolean } = {}) => {
      const n = rf.getNode(id)
      if (!n) return
      if (opts.quiet) {
        remember()
        if (inFocus(id)) toggleFocusRef.current()
      } else removing([n])
      rf.setNodes(ns => ns.filter(x => x.id !== id))
      persist()
    },
    [rf, persist, remember, removing],
  )

  /** A new section: around these cards (with room round them), or at a spot (where the board was right-clicked), or
   * in the middle of the screen. Returns its id. */
  const addSection = useCallback(
    (opts: { around?: string[]; at?: { x: number; y: number }; title?: string } = {}) => {
      track('board.section')
      const around = (opts.around || []).map(id => rf.getNode(id)).filter((n): n is CardNode => !!n && !n.hidden)
      const PAD = 40
      let box: { x: number; y: number; w: number; h: number }
      if (around.length) {
        const bs = around.map(boxOf)
        const x0 = Math.min(...bs.map(b => b.x))
        const y0 = Math.min(...bs.map(b => b.y))
        const x1 = Math.max(...bs.map(b => b.x + b.w))
        const y1 = Math.max(...bs.map(b => b.y + b.h))
        box = { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 }
      } else {
        const { w, h } = SIZES.section
        const c = opts.at ?? rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 })
        box = { x: c.x - w / 2, y: c.y - 40, w, h }
      }
      remember()
      const id = `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const here = spaceRef.current === 'main' ? {} : { space: spaceRef.current }
      const title = opts.title?.trim()
      rf.setNodes(ns => [
        { id, type: 'section', position: { x: box.x, y: box.y }, width: Math.round(box.w), height: Math.round(box.h), zIndex: SECTION_Z, dragHandle: '.card-drag', selected: true, data: { ref: id, born: Date.now(), ...(title ? { title } : {}), ...here } },
        ...ns.map(n => (n.selected ? { ...n, selected: false } : n)),
      ])
      persist()
      return id
    },
    [rf, remember, persist],
  )

  /** A section made just big enough for what's in it, with room round it. False when it holds nothing. */
  const fitSection = useCallback(
    (id: string) => {
      const s = rf.getNode(id)
      if (!s) return false
      const cs = contentsOf(s, rf.getNodes())
      if (!cs.length) return false
      const PAD = 40
      const b = cs.map(boxOf)
      const x0 = Math.min(...b.map(r => r.x)) - PAD
      const y0 = Math.min(...b.map(r => r.y)) - PAD
      const x1 = Math.max(...b.map(r => r.x + r.w)) + PAD
      const y1 = Math.max(...b.map(r => r.y + r.h)) + PAD
      remember()
      rf.setNodes(ns => ns.map(n => (n.id === id ? { ...n, position: { x: x0, y: y0 }, width: Math.round(x1 - x0), height: Math.round(y1 - y0) } : n)))
      persist()
      return true
    },
    [rf, remember, persist],
  )

  const sectionCards = useCallback(
    (id: string) => {
      const s = rf.getNode(id)
      if (!s) return []
      const all = rf.getNodes()
      return [...contentsOf(s, all), ...heldBy(id, all)]
    },
    [rf],
  )

  /** A section folded to its bar: what's in it is held, hidden where it was, until it opens again. */
  const foldSection = useCallback(
    (id: string, fold: boolean) => {
      const s = rf.getNode(id)
      if (!s || !isSection(s) || !!s.data.folded === fold) return
      track(fold ? 'section.fold' : 'section.unfold')
      remember()
      const inS = fold ? new Set(contentsOf(s, rf.getNodes()).map(n => n.id)) : new Set<string>()
      rf.setNodes(ns =>
        settle(
          ns.map(n => (n.id === id ? foldNode(n, fold) : inS.has(n.id) ? { ...n, hidden: true, selected: false, data: { ...n.data, inside: id } } : n)),
          spaceRef.current,
        ),
      )
      persist()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, remember, persist],
  )
  // a section taken off (Delete, Undo, a removal) lets go of what it held
  const isUnsettled = useStore(st => unsettled(st.nodes as CardNode[]))
  useEffect(() => {
    if (isUnsettled) rf.setNodes(ns => settle(ns, spaceRef.current))
  }, [isUnsettled, rf])

  const setSectionTitle = useCallback(
    (id: string, title: string) => {
      remember()
      rf.setNodes(ns =>
        ns.map(n => {
          if (n.id !== id) return n
          const { title: _was, ...data } = n.data
          return { ...n, data: title.trim() ? { ...data, title: title.trim().slice(0, 80) } : data }
        }),
      )
      persist()
    },
    [rf, remember, persist],
  )

  /** Takes several cards off at once: one Undo brings them all back. */
  const removeCards = useCallback(
    (ids: string[]) => {
      const set = new Set(ids)
      const nodes = rf.getNodes().filter(n => set.has(n.id) && !n.data.locked)
      if (!nodes.length) return
      removing(nodes)
      const gone = new Set(nodes.map(n => n.id))
      rf.setNodes(ns => ns.filter(x => !gone.has(x.id)))
      persist()
    },
    [rf, persist, removing],
  )

  const retarget = useCallback(
    (id: string, ref: string, show?: boolean) => {
      rf.setNodes(ns => ns.map(n => (n.id === id ? { ...n, data: { ...n.data, ref } } : n)))
      if (show) focus(id)
      persist()
    },
    [rf, persist, focus],
  )

  const setLocked = useCallback(
    (ids: string[], locked: boolean) => {
      if (!ids.length) return
      if (locked) track('board.lock')
      remember()
      rf.setNodes(ns => ns.map(n => (ids.includes(n.id) ? lockNode(n, locked) : n)))
      persist()
      toast(locked ? (ids.length === 1 ? 'Locked in place: Tidy leaves it where it is' : `${ids.length} cards locked in place`) : 'Unlocked')
    },
    [rf, persist, remember, toast],
  )

  const setColor = useCallback(
    (id: string, color: StickyColor) => {
      rf.setNodes(ns => ns.map(n => (n.id === id ? { ...n, data: { ...n.data, color } } : n)))
      persist()
    },
    [rf, persist],
  )

  const addLink = useCallback(
    (from: string, to: string, data: LinkData = {}) => {
      // (a card added a moment ago may not be in React Flow's store yet; an arrow to a card that never arrives is
      // dropped when the board is saved)
      if (from === to) return undefined
      const same = rf.getEdges().find(e => (e.source === from && e.target === to) || (e.source === to && e.target === from))
      if (same) return same.id
      track('board.arrow')
      remember()
      const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      rf.setEdges(es => [...es, toEdge({ id, from, to, ...data })])
      persist()
      return id
    },
    [rf, remember, persist],
  )

  const setLink = useCallback(
    (id: string, change: Partial<LinkData> | 'reverse') => {
      remember()
      rf.setEdges(es =>
        es.map(e => {
          if (e.id !== id) return e
          if (change === 'reverse') {
            const { fromSide, toSide, ...d } = (e.data || {}) as LinkData
            return { ...e, source: e.target, target: e.source, data: { ...d, ...(toSide ? { fromSide: toSide } : {}), ...(fromSide ? { toSide: fromSide } : {}) } }
          }
          const data: LinkData = { ...(e.data as LinkData), ...change }
          for (const k of Object.keys(data) as (keyof LinkData)[]) if (data[k] === undefined || data[k] === '' || data[k] === false) delete data[k]
          return { ...e, data }
        }),
      )
      persist()
    },
    [rf, remember, persist],
  )

  const removeLink = useCallback(
    (id: string) => {
      remember()
      rf.setEdges(es => es.filter(e => e.id !== id))
      persist()
      toast('Arrow removed', { label: 'Undo', run: () => undoRef.current() })
    },
    [rf, remember, persist, toast],
  )

  const showItem = useCallback(
    async (body: Record<string, unknown>, opts: PlaceOpts = {}) => {
      if (body.url) toast('Reading the page…')
      try {
        const e = await post<ShownEntry & { folder?: string }>('/api/shown', body)
        if (e.folder) return addCard('folder', e.folder, opts)
        const id = addCard('item', e.id, opts)
        items.reload()
        if (e.readError) toast("Couldn't read that page here; it opens in the browser from its card")
        else if (body.url) clearToast()
        return id
      } catch (err: any) {
        toast(err.message)
        return undefined
      }
    },
    [addCard, items, toast, clearToast],
  )

  const showImage = useCallback(
    async (file: File, opts: PlaceOpts = {}) => {
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
          r.onerror = () => reject(new Error("Couldn't read that image"))
          r.readAsDataURL(file)
        })
        const name = file.name && !/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name) ? file.name.replace(/\.[a-z0-9]+$/i, '') : undefined
        const e = await post<ShownEntry>('/api/shown/image', { data, type: file.type, name })
        const id = addCard('item', e.id, opts)
        items.reload()
        return id
      } catch (err: any) {
        toast(err.message)
        return undefined
      }
    },
    [addCard, items, toast],
  )

  const newSticky = useCallback(
    async (text = '', opts: PlaceOpts = {}) => {
      try {
        const r = await post<{ path: string }>('/api/notes/new', { kind: 'sticky', text })
        return addCard('note', r.path, opts)
      } catch (err: any) {
        toast(err.message)
      }
    },
    [addCard, toast],
  )

  const saveLater = useCallback(
    async (body: { url?: string; path?: string; text?: string; title?: string }) => {
      try {
        await post<ShownEntry>('/api/later', body)
        items.reload()
        if (!rf.getNodes().some(n => n.type === 'later')) addCard('later', 'later')
        toast('Saved to Later')
      } catch (err: any) {
        toast(err.message)
      }
    },
    [addCard, items, rf, toast],
  )

  const setLater = useCallback(
    async (id: string, later: ShownEntry['later'] | null) => {
      if (later === 'done') track('later.done')
      try {
        await post(`/api/shown/${id}`, { later })
        items.reload()
      } catch (err: any) {
        toast(err.message)
      }
    },
    [items, toast],
  )

  const setLaterText = useCallback(
    async (id: string, text: string) => {
      try {
        await post(`/api/shown/${id}`, { text })
        items.reload()
      } catch (err: any) {
        toast(err.message)
      }
    },
    [items, toast],
  )

  // ---- focus and tidy ----------------------------------------------------------------------------------------
  // The layout before Focus is kept in memory and in this browser's storage, so a reload mid-focus can still put
  // everything back.
  type Snap = Record<string, { x: number; y: number; w: number; h: number; folded: boolean; openH?: number }>
  const FOCUS_KEY = 'cockpit.focus'
  const focusSaved = useRef<{ focus: string | string[]; cards: Snap } | null>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null')
      } catch {
        return null
      }
    })(),
  )
  focusSavedRef.current = focusSaved.current
  const [focusing, setFocusing] = useState(!!focusSaved.current)
  const sizeOf = (n: CardNode) => ({ w: n.width ?? n.measured?.width ?? SIZES[n.type as CardType].w, h: n.height ?? n.measured?.height ?? SIZES[n.type as CardType].h })

  const toggleFocus = useCallback(
    (id?: string | string[]) => {
      const saved = focusSaved.current
      if (saved) {
        const focused = [saved.focus].flat()
        rf.setNodes(ns =>
          ns.map(n => {
            const s = saved.cards[n.id]
            if (!s) return n
            const { folded, openH, ...data } = n.data
            const moved = { ...n, position: { x: s.x, y: s.y } }
            if (focused.includes(n.id)) return moved // a focused card keeps any resizing done while focused
            if (s.folded) return { ...moved, width: s.w, height: foldedH(n.type, n.data.ref), data: { ...data, folded: true, openH: s.openH } }
            // a card as tall as its content stays that way (a fixed height would cut it off)
            return { ...moved, width: s.w, height: fitsContent({ type: n.type, data }) ? undefined : s.h, data }
          }),
        )
        focusSaved.current = null
        focusSavedRef.current = null
        try {
          localStorage.removeItem(FOCUS_KEY)
        } catch {
          // only in memory
        }
        setFocusing(false)
        glide()
        persist()
        requestAnimationFrame(() => rf.fitView({ duration: 320, padding: 0.15, maxZoom: 1 }))
        return
      }
      // which cards: the ones named; or, from a card's menu with several selected, all of those; or the selection
      const picked = rf.getNodes().filter(n => n.selected && !n.hidden)
      const ids = Array.isArray(id) ? id : id ? (picked.length > 1 && picked.some(n => n.id === id) ? picked.map(n => n.id) : [id]) : picked.map(n => n.id)
      const targets = ids.map(i => rf.getNode(i)).filter((n): n is CardNode => !!n && !n.hidden)
      if (!targets.length) return toast('Select a card first')
      // side by side, left to right as they are on the board (or in the order named), from the first one's place
      if (!Array.isArray(id)) targets.sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      const target = targets[0]
      const nodes = rf.getNodes().filter(n => !n.hidden)
      const cards: Snap = Object.fromEntries(
        nodes.map(n => [n.id, { x: n.position.x, y: n.position.y, ...sizeOf(n), folded: !!n.data.folded, ...(n.data.openH ? { openH: n.data.openH } : {}) }]),
      )
      focusSaved.current = { focus: targets.length > 1 ? targets.map(n => n.id) : target.id, cards }
      focusSavedRef.current = focusSaved.current
      try {
        localStorage.setItem(FOCUS_KEY, JSON.stringify(focusSaved.current))
      } catch {
        // only in memory
      }
      const SHELF_W = 280
      const shelfX = target.position.x - SHELF_W - 64
      // locked cards stay where they are
      const focused = new Set(targets.map(n => n.id))
      // (sections stay where they are, behind)
      const others = nodes.filter(n => !focused.has(n.id) && !n.data.locked && !isSection(n)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      const spot = new Map(others.map((n, i) => [n.id, { x: shelfX, y: target.position.y + i * (FOLDED_H + 10) }]))
      // the focused cards in a row, tops lined up, a gap between them
      const row = new Map<string, { x: number; y: number }>()
      let x = target.position.x
      for (const n of targets) {
        row.set(n.id, { x, y: target.position.y })
        x += sizeOf(n).w + 32
      }
      glide()
      rf.setNodes(ns =>
        ns.map(n =>
          row.has(n.id)
            ? { ...foldNode(n, false), position: row.get(n.id)!, selected: true }
            : spot.has(n.id)
              ? { ...foldNode(n, true), width: SHELF_W, position: spot.get(n.id)!, selected: false }
              : n,
        ),
      )
      setFocusing(true)
      persist()
      requestAnimationFrame(() => rf.fitView({ nodes: targets.map(n => ({ id: n.id })), duration: 320, padding: 0.12, maxZoom: 1 }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, persist, toast, glide],
  )
  toggleFocusRef.current = toggleFocus

  // Tidy, the way design tools do it (Figma's Tidy up): nothing is resized and nothing zooms. Cards are packed from
  // the top-left of the screen as it is now, in the order they're read on the board, each at the highest spot it
  // fits; locked cards stay put and the rest flow around them. Undo puts everything back.
  const tidy = useCallback(() => {
    track('board.tidy')
    if (focusSaved.current) return toast('Bring everything back first, then tidy')
    const nodes = rf.getNodes().filter(n => !n.hidden)
    // sections, and the cards in them, stay as they are (someone arranged them); the rest flow around them
    const sections = nodes.filter(isSection)
    const kept = (n: CardNode) => !!n.data.locked || isSection(n) || sections.some(s => inSection(s, n))
    const free = nodes.filter(n => !kept(n))
    if (!free.length) return toast(nodes.length ? 'Every card is locked in place' : 'Nothing on the board yet')
    remember()
    const box = (n: CardNode) => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n) })
    const { zoom } = rf.getViewport()
    const margin = 28
    const topLeft = rf.screenToFlowPosition({ x: margin, y: margin })
    const spots = pack(free.map(box), nodes.filter(kept).map(box), { x: topLeft.x, y: topLeft.y, w: (innerWidth - margin * 2) / zoom }, prefsRef.current.tidyGap)
    glide()
    rf.setNodes(ns => ns.map(n => (spots.has(n.id) ? { ...n, position: spots.get(n.id)! } : n)))
    persist()
    toast('Tidied', { label: 'Undo', run: () => undoRef.current() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf, persist, toast, remember, glide])

  // ---- comments -------------------------------------------------------------------------------------------------
  const commentsData = useData(() => get<{ cards: Record<string, CardComment[]> }>('/api/comments'), [], { refreshOn: ['comments'] })
  const addComment = useCallback(
    async (card: string, text: string, by: 'you' | 'Claude' = 'you') => {
      try {
        await post('/api/comments', { card, text, by })
        commentsData.reload()
      } catch (err: any) {
        toast(err.message)
        throw err
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  )
  const removeComment = useCallback(
    async (id: string) => {
      await post(`/api/comments/${id}/remove`).catch((err: any) => toast(err.message))
      commentsData.reload()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  )

  // ---- spaces ---------------------------------------------------------------------------------------------------
  // Boards of their own. Cards of other spaces stay on the board, hidden; each space keeps where its view was.
  const switchSpace = useCallback(
    (id: string) => {
      if (id === spaceRef.current) return
      const target = spacesRef.current.find(x => x.id === id)
      if (!target) return
      if (focusSavedRef.current) return toast('Bring everything back first')
      const viewport = rf.getViewport()
      setSpaces(spacesRef.current.map(x => (x.id === spaceRef.current ? { ...x, viewport } : x)))
      setSpace(id)
      rf.setNodes(ns => ns.map(n => ({ ...n, hidden: offBoard({ space: spaceOf(n), tucked: n.data.tucked, inside: n.data.inside }, id), selected: false })))
      requestAnimationFrame(() => {
        if (target.viewport) rf.setViewport(target.viewport)
        else if (rf.getNodes().some(n => spaceOf(n) === id)) rf.fitView({ padding: 0.15, maxZoom: 1 })
        else rf.setViewport({ x: 0, y: 0, zoom: 1 })
      })
      persist()
      toast(target.name)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, persist, toast],
  )

  const newSpace = useCallback(
    (name?: string) => {
      const list = spacesRef.current
      if (list.length >= 20) {
        toast('20 spaces is the most')
        return spaceRef.current
      }
      const label = (name || '').trim().slice(0, 40) || `Space ${list.length + 1}`
      const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'space'
      let id = base
      for (let i = 2; list.some(x => x.id === id) || id === 'main'; i++) id = `${base}-${i}`
      setSpaces([...list, { id, name: label }])
      switchSpace(id)
      return id
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchSpace, toast],
  )

  const renameSpace = useCallback(
    (id: string, name: string) => {
      const label = name.trim().slice(0, 40)
      if (!label) return
      setSpaces(spacesRef.current.map(x => (x.id === id ? { ...x, name: label } : x)))
      persist()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persist],
  )

  const deleteSpace = useCallback(
    (id: string) => {
      if (id === 'main') return toast("Main can't be removed")
      const gone = spacesRef.current.find(x => x.id === id)
      if (!gone) return
      if (spaceRef.current === id) switchSpace('main')
      setSpaces(spacesRef.current.filter(x => x.id !== id))
      let moved = 0
      rf.setNodes(ns =>
        ns.map(n => {
          if (spaceOf(n) !== id) return n
          moved++
          const { space: _gone, ...data } = n.data
          return { ...n, data, hidden: offBoard({ tucked: data.tucked, inside: data.inside }, spaceRef.current) }
        }),
      )
      persist()
      toast(moved ? `Removed ${gone.name}; its cards are in Main` : `Removed ${gone.name}`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, persist, toast, switchSpace],
  )

  const moveToSpace = useCallback(
    (ids: string[], to: string) => {
      const target = spacesRef.current.find(x => x.id === to)
      if (!target || !ids.length) return
      const set = new Set(ids)
      remember()
      // they land in view there: around the middle of where that space was last looked at, in free spots
      const vp = to === spaceRef.current ? rf.getViewport() : (target.viewport ?? { x: innerWidth / 2, y: innerHeight / 2, zoom: 1 })
      const middle = { x: (innerWidth / 2 - vp.x) / vp.zoom, y: (innerHeight / 2 - vp.y) / vp.zoom }
      const there = rf.getNodes().filter(n => spaceOf(n) === to && !set.has(n.id))
      const spots = new Map<string, { x: number; y: number }>()
      for (const n of rf.getNodes().filter(n => set.has(n.id))) {
        const size = { w: n.width ?? n.measured?.width ?? 400, h: n.height ?? n.measured?.height ?? 300 }
        const pos = freeSpot({ x: middle.x - size.w / 2, y: middle.y - size.h / 2 }, size, there)
        spots.set(n.id, pos)
        there.push({ ...n, position: pos })
      }
      // what a folded or tucked section holds goes with it, as it was in it
      const all = rf.getNodes()
      const shift = new Map<string, { dx: number; dy: number }>()
      for (const id of set) {
        const n = all.find(x => x.id === id)
        const at = spots.get(id)
        if (!n || !at || !isSection(n)) continue
        for (const h of heldBy(id, all)) if (!set.has(h.id)) shift.set(h.id, { dx: at.x - n.position.x, dy: at.y - n.position.y })
      }
      rf.setNodes(ns =>
        settle(
          ns.map(n => {
            const by = shift.get(n.id)
            if (by) {
              const { space: _from, ...data } = n.data
              return { ...n, position: { x: n.position.x + by.dx, y: n.position.y + by.dy }, data: to === 'main' ? data : { ...data, space: to } }
            }
            if (!set.has(n.id)) return n
            const { space: _from, tucked: _t, ...data } = n.data
            return { ...n, position: spots.get(n.id) ?? n.position, data: to === 'main' ? data : { ...data, space: to }, hidden: to !== spaceRef.current || !!data.inside, selected: false }
          }),
          spaceRef.current,
        ),
      )
      persist()
      toast(ids.length === 1 ? `Moved to ${target.name}` : `${ids.length} cards moved to ${target.name}`, { label: 'Undo', run: () => undoRef.current() })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, persist, toast, remember],
  )

  const renameItem = useCallback(
    async (id: string, title: string) => {
      if (!title.trim()) return
      try {
        await post(`/api/shown/${id}`, { title })
        items.reload()
      } catch (err: any) {
        toast(err.message)
      }
    },
    [items, toast],
  )

  const copy = useCallback(
    async (text: string, what = 'Copied') => {
      try {
        await navigator.clipboard.writeText(text)
        toast(what)
      } catch {
        toast('The browser blocked copying')
      }
    },
    [toast],
  )

  const openLink = useCallback((url: string) => {
    post('/api/open-url', { url }).catch(() => window.open(url, '_blank', 'noopener'))
  }, [])

  const setPalette = useCallback((open: boolean, seed = '') => {
    if (open) track('palette.open')
    setPaletteSeed(seed)
    setPaletteOpen(open)
  }, [])

  // Something a chat showed (or the tray's Cockpit button sent) comes onto the board by itself.
  // A folder sent from Explorer (Send to > Cockpit) comes as a folder card.
  useEvent('opened', (d: { id?: string; folder?: string }) => {
    if (d.folder) return void addCard('folder', d.folder)
    if (!d.id) return
    addCard('item', d.id)
    items.reload()
  })
  useEvent('notice', (d: { text: string }) => toast(d.text))
  // Claude left something to copy: its card comes up
  useEvent('snippets', (d: { added?: { title: string; from: string }[] }) => {
    if (!d.added?.length) return
    addCard('snippets', 'snippets')
    toast(d.added.length === 1 ? `Claude left "${d.added[0].title}" in Snippets` : `Claude left ${d.added.length} things in Snippets`)
  })

  // Files on the board refresh as they change on disk: one check for all of them.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const ids = [...new Set(rf.getNodes().filter(n => n.type === 'item').map(n => n.data.ref))]
      if (!ids.length) return
      try {
        const m = await get<Record<string, number>>(`/api/shown/meta?ids=${ids.join(',')}`)
        setVersions(v => {
          const changed = Object.entries(m).some(([k, t]) => v[k] !== undefined && v[k] !== t) || Object.keys(m).some(k => v[k] === undefined)
          return changed ? { ...v, ...m } : v
        })
      } catch {
        // server away
      }
    }, 2500)
    return () => clearInterval(t)
  }, [rf])

  const pin = useCallback(
    async (body: PinInput) => {
      try {
        const p = await post<Pin & { already?: boolean }>('/api/pinned', body)
        pinned.reload()
        toast(p.already ? `${p.title} is already pinned` : `Pinned ${p.title}`)
      } catch (e: any) {
        toast(e.message)
      }
    },
    [toast, pinned],
  )

  const openPin = useCallback(
    async (p: Pin, how: 'default' | 'reveal' = 'default') => {
      try {
        const r = await post<Pin & { note?: string }>(`/api/pinned/${p.id}/open`, { how })
        if (r.note) {
          setPinnedOpen(false, true)
          setExpanded({ type: 'note', ref: r.note })
        } else toast(how === 'reveal' ? `Showing ${p.title} in Explorer` : `Opening ${p.title}`)
      } catch (e: any) {
        toast(e.message)
      }
    },
    [toast],
  )

  // Full screen, counted: what is kept being read in Cockpit shows up in Quick access by itself
  const expand = useCallback((e: Expanded) => {
    setExpanded(e)
    if (e) track(e.beside ? 'item.compare' : 'item.fullscreen')
    if (e) post('/api/usage', e.type === 'note' ? { note: e.ref } : { id: e.ref }).catch(() => {})
  }, [])

  const compareCards = useCallback(
    (ids: string[], inOrder?: boolean) => {
      const cards = ids.map(id => rf.getNode(id) as CardNode | undefined).filter((n): n is CardNode => !!n)
      if (cards.length !== 2) return toast('Pick two cards to compare')
      const odd = cards.find(n => n.type !== 'item' && n.type !== 'note')
      if (odd) return toast('Only files, pages and notes open side by side')
      const [a, b] = inOrder ? cards : [...cards].sort((x, y) => x.position.x - y.position.x)
      if (a.type === b.type && a.data.ref === b.data.ref) return toast('Those two cards show the same thing')
      expand({ type: a.type as Shown['type'], ref: a.data.ref, beside: { type: b.type as Shown['type'], ref: b.data.ref } })
    },
    [rf, toast, expand],
  )

  /** Reads a pin full screen in Cockpit (a file Cockpit can show, a page, a note) instead of its own program. */
  const readPin = useCallback(
    async (p: QuickThing) => {
      setPinnedOpen(false, true)
      if (p.kind === 'note') return expand({ type: 'note', ref: p.target })
      if (p.kind === 'link') toast('Reading the page…')
      try {
        const e = await post<ShownEntry>('/api/shown', p.kind === 'link' ? { url: p.target, title: p.title } : { path: p.target, title: p.title })
        items.reload()
        clearToast()
        expand({ type: 'item', ref: e.id })
      } catch (err: any) {
        toast(err.message)
      }
    },
    [expand, items, toast, clearToast],
  )

  /** A card for something from Quick access, put where it was dropped on the board (or in a free spot). */
  const putOnBoard = useCallback(
    async (p: QuickThing, at?: { x: number; y: number }) => {
      if (p.kind === 'folder') return void addCard('folder', p.target, { at })
      if (p.kind === 'item') return void addCard('item', p.target, { at })
      if (p.kind === 'text') return showItem({ content: p.target, format: 'markdown', title: p.title }, { at })
      if (p.kind === 'note') return void addCard('note', p.target, { at })
      await showItem(p.kind === 'link' ? { url: p.target, title: p.title } : { path: p.target, title: p.title }, { at })
    },
    [addCard, showItem, toast],
  )

  const openOften = useCallback(
    async (o: Often, how: 'usual' | 'outside' = 'usual') => {
      try {
        const r = await post<{ expand?: Expanded; opened?: boolean }>('/api/usage/open', { key: o.key, how })
        if (r.expand) {
          setPinnedOpen(false, true)
          setExpanded(r.expand)
          post('/api/usage', r.expand.type === 'note' ? { note: r.expand.ref } : { id: r.expand.ref }).catch(() => {})
        } else toast(`Opening ${o.title}`)
      } catch (e: any) {
        toast(e.message)
      }
    },
    [toast],
  )

  const openChangelog = useCallback(async () => {
    try {
      const path = prefsRef.current.changelog || (await get<Config>('/api/config')).changelog
      const e = await post<ShownEntry>('/api/shown', { path, title: "What's new in Cockpit" })
      items.reload()
      expand({ type: 'item', ref: e.id })
    } catch (err: any) {
      toast(err.message)
    }
  }, [expand, items, toast])

  const sendFeedback = useCallback(() => {
    const c = config.data
    if (!c?.repository) return toast('No project address to send feedback to')
    track('feedback.open')
    const q = new URLSearchParams({ template: 'feedback.yml', version: c.version, windows: c.windows })
    openLink(`${c.repository}/issues/new?${q}`)
  }, [config.data, toast, openLink])

  const value = useMemo<Ctx>(
    () => ({
      addCard, removeCard, removeCards, addSection, fitSection, foldSection, sectionCards, setSectionTitle, removing, retarget, showItem, saveLater, setLater, setLaterText, renameItem, newSticky, setColor, setLocked, remember, undo, redo,
      keysOpen, setKeysOpen, focusing, toggleFocus, compareCards, tidy, expand, expanded, toast, toastText: toastState.text, toastAction: toastState.action, copy, openLink, palette, setPalette, paletteSeed,
      outputsOpen, setOutputsOpen, settingsOpen, setSettingsOpen, prefs, reloadPrefs: config.reload, openChangelog, sendFeedback,
      pinnedOpen, setPinnedOpen, quickKept, setQuickKept, pinned: pinned.data || { items: [], groups: [], often: [] }, pin, openPin, openOften, readPin, putOnBoard,
      outputs: outputs.data || [], unseenOutputs: (outputs.data || []).filter(g => !g.seen).length, reloadOutputs: outputs.reload,
      showImage, items: items.data || [], notes: notes.data, trackers: trackers.data || [], versions, persist,
      spaces, space, switchSpace, newSpace, renameSpace, deleteSpace, moveToSpace,
      comments: commentsData.data?.cards || {}, addComment, removeComment, tuck, untuck, setVeiled, setCardAgents, setSpaceAgents, addLink, setLink, removeLink,
    }),
    [addCard, removeCard, removeCards, addSection, fitSection, foldSection, sectionCards, setSectionTitle, removing, retarget, showItem, saveLater, setLater, setLaterText, renameItem, newSticky, setColor, setLocked, remember, undo, redo, keysOpen, focusing, toggleFocus, compareCards, tidy, expanded, toast, toastState, copy, openLink, palette, setPalette, paletteSeed, outputsOpen, settingsOpen, prefs, config.reload, openChangelog, sendFeedback, pinnedOpen, setPinnedOpen, quickKept, setQuickKept, pinned.data, pin, openPin, openOften, readPin, putOnBoard, expand, outputs.data, outputs.reload, items.data, notes.data, trackers.data, versions, persist, showImage, spaces, space, switchSpace, newSpace, renameSpace, deleteSpace, moveToSpace, commentsData.data, addComment, removeComment, tuck, untuck, setVeiled, setCardAgents, setSpaceAgents, addLink, setLink, removeLink],
  )

  return <BoardCtx.Provider value={value}>{children}</BoardCtx.Provider>
}
