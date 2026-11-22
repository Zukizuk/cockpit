// The board's state and the actions every part of Cockpit uses: put something on the board (or bring it into view
// if it's already there), expand it full screen, open it in its own program, and a few things everything reads
// (Claude's outputs, the library, notes, trackers). React Flow owns the cards' positions and sizes; they are
// saved to the server a moment after they stop changing. Every change to the layout (a move, a resize, Tidy, a
// card added or taken off) can be undone with Ctrl+Z.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import { useTheme, type Theme } from './theme'
import { get, post, put, track, type Board, type BoardCard, type CardType, type Config, type Editor, type NotesList, type OutputGroup, type Often, type Pin, type PinInput, type PinnedList, type ShownEntry, type StickyColor, type Tracker } from './api'
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
  return { w: 260, h: 150 }
}

/** Snippets is never made shorter than its header and the box to paste into. */
export const SNIPPETS_MIN_H = 160

/** A folded card is just its header: the title line and what it's about. */
export const FOLDED_H = 46

/** openH: the height a folded card goes back to when it's unfolded. */
export type CardData = { ref: string; pulse?: number; born?: number; folded?: boolean; openH?: number; locked?: boolean; color?: StickyColor; sized?: boolean }
export type CardNode = Node<CardData, CardType>

/** Cards as tall as what's in them (up to a limit, then they scroll), until a height is dragged by hand (sized). */
export const AUTO_HEIGHT = new Set<CardType>(['snippets'])
/** True while a card that fits its content is being resized by hand (so its height isn't put back meanwhile). */
export const resizingRef = { current: false }
/** Whether a card sizes itself to its content right now. */
export const fitsContent = (n: { type?: string; data: CardData }) => AUTO_HEIGHT.has(n.type as CardType) && !n.data.sized

const keepsSize = (c: BoardCard) => !!c.sized && !(c.type === 'snippets' && c.h < SNIPPETS_MIN_H)

export const toNode = (c: BoardCard): CardNode => ({
  id: c.id,
  type: c.type,
  position: { x: c.x, y: c.y },
  data: { ref: c.ref, ...(c.folded ? { folded: true, openH: c.h } : {}), ...(c.locked ? { locked: true } : {}), ...(c.color ? { color: c.color } : {}), ...(keepsSize(c) ? { sized: true } : {}) },
  width: c.w,
  height: c.folded ? FOLDED_H : AUTO_HEIGHT.has(c.type) && !keepsSize(c) ? undefined : c.h,
  dragHandle: '.card-drag',
  ...(c.locked ? { draggable: false, deletable: false } : {}),
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
})

/** The same card folded to its header, or opened back to its height. */
export function foldNode(n: CardNode, fold: boolean): CardNode {
  if (!!n.data.folded === fold) return n
  if (fold) return { ...n, height: FOLDED_H, data: { ...n.data, folded: true, openH: n.height ?? n.measured?.height ?? SIZES[n.type as CardType].h } }
  const { folded, openH, ...data } = n.data
  return { ...n, height: fitsContent({ type: n.type, data }) ? undefined : (openH ?? SIZES[n.type as CardType].h), data }
}

/** The same card locked in place (no moving by hand or by Tidy, no resizing, no Delete key), or free again. */
export function lockNode(n: CardNode, locked: boolean): CardNode {
  const { locked: _was, ...data } = n.data
  return { ...n, draggable: !locked, deletable: !locked, data: locked ? { ...data, locked: true } : data }
}

export type Expanded = { type: 'item' | 'note'; ref: string } | null
/** Where a new card goes: beside another card (near), at a point on the board (at, where something was dropped), or else the middle. */
export type PlaceOpts = { near?: string; at?: { x: number; y: number }; size?: { w: number; h: number } }
/** Something from Quick access: a pin or an often-opened thing. */
export type QuickThing = { kind: Pin['kind'] | 'item' | 'text'; target: string; title: string }
/** A button in the toast: Undo, mostly. */
export type ToastAction = { label: string; run: () => void }
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

export type Prefs = { stickyColor: StickyColor; singleKeys: boolean; tidyGap: number; changelog: string; editor: Editor; theme: Theme }
const DEFAULT_PREFS: Prefs = { stickyColor: 'ink', singleKeys: true, tidyGap: 24, changelog: '', editor: 'notepad', theme: savedTheme() }

interface Ctx {
  addCard: (type: CardType, ref: string, opts?: PlaceOpts) => string
  /** Takes a card off the board (Undo in the toast brings it back). quiet: no toast, for when the card's thing is gone anyway. */
  removeCard: (id: string, opts?: { quiet?: boolean }) => void
  /** Cards React Flow is about to take off (the Delete key): kept for Undo first. */
  removing: (nodes: CardNode[]) => void
  /** Points a card at something else (with show, brings it into view and selects it). */
  retarget: (id: string, ref: string, show?: boolean) => void
  showItem: (body: Record<string, unknown>, opts?: PlaceOpts) => Promise<void>
  /** Keeps a link or a short note on the Later list (and puts the list on the board if it isn't there). */
  saveLater: (body: { url?: string; path?: string; text?: string; title?: string }) => Promise<void>
  /** Moves a kept thing on the Later list: to check, reading, done, or off the list (null). */
  setLater: (id: string, later: ShownEntry['later'] | null) => Promise<void>
  /** Changes the words of a note kept on Later. */
  setLaterText: (id: string, text: string) => Promise<void>
  /** Names a kept thing by hand (a form whose page has no useful title, say). */
  renameItem: (id: string, title: string) => Promise<void>
  /** A new sticky note on the board, ready to type in (with some words already, if given). */
  newSticky: (text?: string, opts?: PlaceOpts) => Promise<void>
  setColor: (id: string, color: StickyColor) => void
  /** Locks cards in place, or frees them. */
  setLocked: (ids: string[], locked: boolean) => void
  /** Keeps the layout as it is now, so the next change to it can be undone. */
  remember: () => void
  undo: () => void
  redo: () => void
  /** Focus: one card in the middle, every other card folded onto a shelf at its left. Again: all back as it was. */
  focusing: boolean
  toggleFocus: (id?: string) => void
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
  putOnBoard: (p: QuickThing, at?: { x: number; y: number }) => Promise<void>
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
}

const BoardCtx = createContext<Ctx | null>(null)

export function useBoard() {
  const c = useContext(BoardCtx)
  if (!c) throw new Error('useBoard outside BoardProvider')
  return c
}

export function BoardProvider({ children }: { children: ReactNode }) {
  const rf = useReactFlow<CardNode>()
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
  const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const outputs = useData(() => get<OutputGroup[]>('/api/outputs'), [], { refreshEvery: 60_000 })
  const items = useData(() => get<ShownEntry[]>('/api/shown'), [], { refreshOn: ['shown'] })
  const notes = useData(() => get<NotesList>('/api/notes'), [], { refreshOn: ['notes'] })
  const trackers = useData(() => get<Tracker[]>('/api/trackers'), [], { refreshEvery: 300_000, refreshOn: ['trackers'] })
  const pinned = useData(() => get<PinnedList>('/api/pinned'), [], { refreshOn: ['pinned'] })
  const config = useData(() => get<Config>('/api/config'), [])
  const prefs = useMemo<Prefs>(
    () => (config.data ? { stickyColor: config.data.stickyColor, singleKeys: config.data.singleKeys, tidyGap: config.data.tidyGap, changelog: config.data.changelog, editor: config.data.editor || 'notepad', theme: config.data.theme || 'system' } : DEFAULT_PREFS),
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
    toastTimer.current = setTimeout(() => setToastState({ text: '', action: null }), action ? 5000 : 2600)
  }, [])
  const clearToast = useCallback(() => setToastState({ text: '', action: null }), [])

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const body: Board = { cards: rf.getNodes().map(fromNode), viewport: rf.getViewport() }
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

  /** A sticky note taken off the board while still empty is just a blank file: it goes (the server checks it's empty). */
  const discardIfEmpty = useCallback(
    (ref: string) => {
      setTimeout(() => {
        if (rf.getNodes().some(n => n.type === 'note' && n.data.ref === ref)) return // brought back meanwhile
        post('/api/notes/discard', { path: ref }).catch(() => {}) // refused when it has writing in it: kept
      }, 1500)
    },
    [rf],
  )

  // ---- undo -----------------------------------------------------------------------------------------------------
  // The whole layout (every card with its place, size, fold and lock) before each change; Ctrl+Z puts it back.
  const past = useRef<BoardCard[][]>([])
  const future = useRef<BoardCard[][]>([])
  const layoutNow = useCallback(() => rf.getNodes().map(fromNode), [rf])
  const remember = useCallback(() => {
    const now = layoutNow()
    const last = past.current[past.current.length - 1]
    if (last && JSON.stringify(last) === JSON.stringify(now)) return
    past.current.push(now)
    if (past.current.length > 60) past.current.shift()
    future.current = []
  }, [layoutNow])
  const apply = useCallback(
    (layout: BoardCard[]) => {
      const nodes = rf.getNodes()
      const picked = new Set(nodes.filter(n => n.selected).map(n => n.id))
      const kept = new Set(layout.map(c => c.id))
      for (const n of nodes) if (!kept.has(n.id) && isSticky(n.type, n.data.ref)) discardIfEmpty(n.data.ref)
      glide()
      rf.setNodes(layout.map(c => ({ ...toNode(c), selected: picked.has(c.id) })))
      persist()
    },
    [rf, glide, persist, discardIfEmpty],
  )
  const focusSavedRef = useRef<{ focus: string } | null>(null)
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

  const addCard = useCallback(
    (type: CardType, ref: string, opts: PlaceOpts = {}) => {
      track(`card.${type}`)
      const existing = rf.getNodes().find(n => n.type === type && n.data.ref === ref)
      if (existing) {
        focus(existing.id)
        return existing.id
      }
      remember()
      const size = opts.size ?? sizeFor(type, ref)
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
      const GAP = 28
      const boxes = rf.getNodes().map(n => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? 400, h: n.height ?? n.measured?.height ?? 300 }))
      const clear = (p: { x: number; y: number }) =>
        boxes.every(b => p.x + size.w + GAP <= b.x || b.x + b.w + GAP <= p.x || p.y + size.h + GAP <= b.y || b.y + b.h + GAP <= p.y)
      if (!clear(pos)) {
        const step = 120
        let found: { x: number; y: number } | null = null
        for (let ring = 1; ring <= 40 && !found; ring++) {
          const spots: { x: number; y: number; d: number }[] = []
          for (let i = -ring; i <= ring; i++)
            for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) spots.push({ x: pos.x + dx * step, y: pos.y + dy * step, d: Math.hypot(dx, dy) })
          spots.sort((a, b) => a.d - b.d)
          found = spots.find(clear) ?? null
        }
        if (found) pos = { x: found.x, y: found.y }
      }
      const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      rf.setNodes(ns => [
        ...ns.map(n => ({ ...n, selected: false })),
        { id, type, position: pos, data: { ref, pulse: Date.now(), born: Date.now() }, width: size.w, height: AUTO_HEIGHT.has(type) ? undefined : size.h, selected: true, dragHandle: '.card-drag' },
      ])
      // dropped somewhere on purpose: stay where the user is looking
      if (!opts.at) requestAnimationFrame(() => rf.fitView({ nodes: [{ id }], duration: 320, padding: 0.25, maxZoom: 1, minZoom: Math.min(rf.getZoom(), 1) }))
      persist()
      return id
    },
    [rf, focus, persist, remember],
  )

  const toggleFocusRef = useRef<(id?: string) => void>(() => {})

  const removing = useCallback(
    (nodes: CardNode[]) => {
      if (!nodes.length) return
      remember()
      if (focusSavedRef.current && nodes.some(n => n.id === focusSavedRef.current?.focus)) toggleFocusRef.current()
      for (const n of nodes) if (isSticky(n.type, n.data.ref)) discardIfEmpty(n.data.ref)
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
        if (focusSavedRef.current?.focus === id) toggleFocusRef.current()
      } else removing([n])
      rf.setNodes(ns => ns.filter(x => x.id !== id))
      persist()
    },
    [rf, persist, remember, removing],
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

  const showItem = useCallback(
    async (body: Record<string, unknown>, opts: PlaceOpts = {}) => {
      if (body.url) toast('Reading the page…')
      try {
        const e = await post<ShownEntry & { folder?: string }>('/api/shown', body)
        if (e.folder) return void addCard('folder', e.folder, opts)
        addCard('item', e.id, opts)
        items.reload()
        if (e.readError) toast("Couldn't read that page here; it opens in the browser from its card")
        else if (body.url) clearToast()
      } catch (err: any) {
        toast(err.message)
      }
    },
    [addCard, items, toast, clearToast],
  )

  const newSticky = useCallback(
    async (text = '', opts: PlaceOpts = {}) => {
      try {
        const r = await post<{ path: string }>('/api/notes/new', { kind: 'sticky', text })
        addCard('note', r.path, opts)
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
  const focusSaved = useRef<{ focus: string; cards: Snap } | null>(
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
    (id?: string) => {
      const saved = focusSaved.current
      if (saved) {
        rf.setNodes(ns =>
          ns.map(n => {
            const s = saved.cards[n.id]
            if (!s) return n
            const { folded, openH, ...data } = n.data
            const moved = { ...n, position: { x: s.x, y: s.y } }
            if (n.id === saved.focus) return moved // the focused card keeps any resizing done while focused
            if (s.folded) return { ...moved, width: s.w, height: FOLDED_H, data: { ...data, folded: true, openH: s.openH } }
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
      const target = rf.getNode(id ?? rf.getNodes().find(n => n.selected)?.id ?? '')
      if (!target) return toast('Select a card first')
      const nodes = rf.getNodes()
      const cards: Snap = Object.fromEntries(
        nodes.map(n => [n.id, { x: n.position.x, y: n.position.y, ...sizeOf(n), folded: !!n.data.folded, ...(n.data.openH ? { openH: n.data.openH } : {}) }]),
      )
      focusSaved.current = { focus: target.id, cards }
      focusSavedRef.current = focusSaved.current
      try {
        localStorage.setItem(FOCUS_KEY, JSON.stringify(focusSaved.current))
      } catch {
        // only in memory
      }
      const SHELF_W = 280
      const shelfX = target.position.x - SHELF_W - 64
      // locked cards stay where they are
      const others = nodes.filter(n => n.id !== target.id && !n.data.locked).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      const spot = new Map(others.map((n, i) => [n.id, { x: shelfX, y: target.position.y + i * (FOLDED_H + 10) }]))
      glide()
      rf.setNodes(ns =>
        ns.map(n =>
          n.id === target.id ? { ...foldNode(n, false), selected: true } : spot.has(n.id) ? { ...foldNode(n, true), width: SHELF_W, position: spot.get(n.id)!, selected: false } : n,
        ),
      )
      setFocusing(true)
      persist()
      requestAnimationFrame(() => rf.fitView({ nodes: [{ id: target.id }], duration: 320, padding: 0.12, maxZoom: 1 }))
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
    const nodes = rf.getNodes()
    const free = nodes.filter(n => !n.data.locked)
    if (!free.length) return toast(nodes.length ? 'Every card is locked in place' : 'Nothing on the board yet')
    remember()
    const box = (n: CardNode) => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n) })
    const { zoom } = rf.getViewport()
    const margin = 28
    const topLeft = rf.screenToFlowPosition({ x: margin, y: margin })
    const spots = pack(free.map(box), nodes.filter(n => n.data.locked).map(box), { x: topLeft.x, y: topLeft.y, w: (innerWidth - margin * 2) / zoom }, prefsRef.current.tidyGap)
    glide()
    rf.setNodes(ns => ns.map(n => (spots.has(n.id) ? { ...n, position: spots.get(n.id)! } : n)))
    persist()
    toast('Tidied', { label: 'Undo', run: () => undoRef.current() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf, persist, toast, remember, glide])

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
    if (e) track('item.fullscreen')
    if (e) post('/api/usage', e.type === 'note' ? { note: e.ref } : { id: e.ref }).catch(() => {})
  }, [])

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
      addCard, removeCard, removing, retarget, showItem, saveLater, setLater, setLaterText, renameItem, newSticky, setColor, setLocked, remember, undo, redo,
      keysOpen, setKeysOpen, focusing, toggleFocus, tidy, expand, expanded, toast, toastText: toastState.text, toastAction: toastState.action, copy, openLink, palette, setPalette, paletteSeed,
      outputsOpen, setOutputsOpen, settingsOpen, setSettingsOpen, prefs, reloadPrefs: config.reload, openChangelog, sendFeedback,
      pinnedOpen, setPinnedOpen, quickKept, setQuickKept, pinned: pinned.data || { items: [], groups: [], often: [] }, pin, openPin, openOften, readPin, putOnBoard,
      outputs: outputs.data || [], unseenOutputs: (outputs.data || []).filter(g => !g.seen).length, reloadOutputs: outputs.reload,
      items: items.data || [], notes: notes.data, trackers: trackers.data || [], versions, persist,
    }),
    [addCard, removeCard, removing, retarget, showItem, saveLater, setLater, setLaterText, renameItem, newSticky, setColor, setLocked, remember, undo, redo, keysOpen, focusing, toggleFocus, tidy, expanded, toast, toastState, copy, openLink, palette, setPalette, paletteSeed, outputsOpen, settingsOpen, prefs, config.reload, openChangelog, sendFeedback, pinnedOpen, setPinnedOpen, quickKept, setQuickKept, pinned.data, pin, openPin, openOften, readPin, putOnBoard, expand, outputs.data, outputs.reload, items.data, notes.data, trackers.data, versions, persist],
  )

  return <BoardCtx.Provider value={value}>{children}</BoardCtx.Provider>
}
