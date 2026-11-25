// The board as UI SDK components, so an agent (Claude Code, through Cockpit's board tools) can read it and use it.
// Nothing here draws anything: each is an invisible component whose value is the data and whose actions do what a
// click would.
// - "Board": the spaces, what the user has selected and has in view; make spaces, sticky notes, journal lines, cards.
// - One component per card, named by its title: so query({ text: "Post ideas" }) finds just that card. Its value says
//   what it is, where (space, selected, in view), a peek at its content and its comments; its actions are the card's.
// - "Later" and "Snippets": the lists themselves.
// Notes are files: a card gives the path, so an agent reads and edits the note where it is, and the board follows.
// Removing anything waits for the person (the bridge's allow). Experimental (spike/ui-sdk-today).
import { useEffect, useMemo } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { definePrimitive } from '@ui-sdk/core'
import { createParts } from '@ui-sdk/react/primitive'
import { contentsOf, foldNode, freeSpot, isSection, isSticky, sectionOf, spaceOf, useBoard, type CardNode, type LinkData } from '../board'
import { get, post, put, type Question, type Snippet, type StickyColor, type TableData } from '../api'
import { newTable, rowsFromText } from '../cards/TableCard'
import { useData } from '../lib'
import { summary } from '../cards/OutputsCard'
import { setVisible, useAgentView } from './view'
import { touchCard } from './presence'

const words = (s: unknown) => String(s ?? '').trim()
const PEEK = 2000

/** Something named by its id, or by words only it has (titles first). */
function pick<T>(list: T[], which: unknown, id: (t: T) => string, name: (t: T) => string, what: string): T {
  const q = words(which).toLowerCase()
  const all = () => list.map(t => `"${name(t)}"`).slice(0, 30).join(', ') || 'none'
  if (!q) throw new Error(`Name the ${what}. The ${what}s: ${all()}.`)
  const exact = list.find(t => id(t) === which || name(t).toLowerCase() === q)
  if (exact) return exact
  const some = list.filter(t => name(t).toLowerCase().includes(q))
  if (some.length === 1) return some[0]
  if (some.length > 1) throw new Error(`"${words(which)}" matches ${some.length} ${what}s: ${some.map(t => `"${name(t)}"`).join(', ')}. Use more of the words.`)
  throw new Error(`No ${what} "${words(which)}". The ${what}s: ${all()}.`)
}

// ---- the board -----------------------------------------------------------------------------------------------

type BoardValue = { space: string; spaces: { name: string; cards: number }[]; sections?: string[]; selected: string[]; inView: string[]; focus?: string[]; sharing?: string }
type BoardOptions = {
  value?: BoardValue
  onSwitchSpace?: (space: string) => void
  onNewSpace?: (name: string) => void
  onRenameSpace?: (space: string, name: string) => void
  onAddSticky?: (text: string, space?: string) => void
  onJot?: (text: string) => void
  onShow?: (target: string, space?: string) => void
  onAddTable?: (title: string, rows: string[][], space?: string) => void
  onTidy?: () => void
  onFocusOn?: (cards: string[]) => void
  onBringBack?: () => void
  onCompare?: (cards: string[]) => void
  onAddSection?: (title: string, cards: string[]) => void
  onFitSection?: (section: string) => void
  /** the sections in the space shown (for fitSection) */
  sectionNames?: string[]
}

/** Rows an agent gives: an array of arrays (the first is the header), or text (tab-separated, Markdown or CSV). */
function rowsOf(rows: unknown): string[][] {
  const out = typeof rows === 'string' ? rowsFromText(rows) : Array.isArray(rows) ? rows.map(r => (Array.isArray(r) ? r.map(c => String(c ?? '')) : [String(r ?? '')])) : []
  if (!out.length || !out.some(r => r.some(c => c.trim()))) throw new Error('Give the rows: an array of arrays of text, the first being the header (or tab-separated text).')
  return out
}

const boardPrimitive = definePrimitive({
  name: 'board',
  options: { value: 'value', onSwitchSpace: 'action', onNewSpace: 'action', onRenameSpace: 'action', onAddSticky: 'action', onJot: 'action', onShow: 'action', onAddTable: 'action', onTidy: 'action', onFocusOn: 'action', onBringBack: 'action', onCompare: 'action', onAddSection: 'action', onFitSection: 'action', sectionNames: 'value' },
  state: (options: BoardOptions) => ({ value: options.value ?? { space: 'Main', spaces: [], selected: [], inView: [] } }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const v = () => context.store.get().value as BoardValue
    const call = <K extends keyof BoardOptions>(key: K) => {
      const fn = context.options()[key]
      if (typeof fn !== 'function') throw new Error('The board cannot do that here.')
      return fn as NonNullable<BoardOptions[K]>
    }
    const space = (which: string) => pick(v().spaces, which, s => s.name, s => s.name, 'space').name
    // another space to put it in (the user stays where they are); none: the one shown
    const into = (which: unknown) => (words(which) ? space(words(which)) : undefined)
    const text = (t: unknown, what = 'text') => {
      const w = words(t)
      if (!w) throw new Error(`Give the ${what}.`)
      return w
    }
    return {
      switchSpace: (s: string) => call('onSwitchSpace')(space(s)),
      newSpace: (name: string) => call('onNewSpace')(text(name, 'name')),
      renameSpace: (s: string, name: string) => call('onRenameSpace')(space(s), text(name, 'new name')),
      addSticky: (t: string, s?: string) => call('onAddSticky')(text(t, 'note'), into(s)),
      jot: (t: string) => {
        const fn = context.options().onJot
        if (typeof fn !== 'function') throw new Error('The journal is off: use addSticky instead, or ask the user to turn it on in Cockpit: Settings > Extras > Journal.')
        fn(text(t, 'thought'))
      },
      show: (target: string, s?: string) => call('onShow')(text(target, 'path or link'), into(s)),
      tidy: () => call('onTidy')(),
      focusOn: (...cards: unknown[]) => {
        const list = cards.flat().map(words).filter(Boolean)
        if (!list.length) throw new Error('Name the card or cards to focus on.')
        call('onFocusOn')(list)
      },
      bringBack: () => call('onBringBack')(),
      compare: (a: unknown, b: unknown) => {
        const list = [a, b].flat().map(words).filter(Boolean)
        if (list.length !== 2) throw new Error('Name the two cards to compare.')
        call('onCompare')(list)
      },
      // a section (a titled area) around these cards, in the space shown
      addSection: (title: string, ...cards: unknown[]) => {
        const list = cards.flat().map(words).filter(Boolean)
        if (!list.length) throw new Error('Name the cards to put in the section (an array of titles).')
        call('onAddSection')(words(title) || 'Section', list)
      },
      // a section made just big enough for what's in it
      fitSection: (section: string) => call('onFitSection')(pick(context.options().sectionNames || [], section, x => x, x => x, 'section')),
      addTable: (title: string, rows: unknown, s?: string) => {
        const fn = context.options().onAddTable
        if (typeof fn !== 'function') throw new Error('Tables are off. Ask the user to turn them on in Cockpit: Settings > Extras > Tables.')
        fn(words(title) || 'Table', rowsOf(rows), into(s))
      },
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['switchSpace', 'newSpace', 'renameSpace', 'addSticky', 'jot', 'show', 'addTable', 'tidy', 'focusOn', 'bringBack', 'compare', 'addSection', 'fitSection'] },
})
const { Root: BoardRoot } = createParts(boardPrimitive, { root: 'div' })

// ---- a card --------------------------------------------------------------------------------------------------

export type CardValue = {
  kind: string
  space: string
  selected?: boolean
  inView?: boolean
  folded?: boolean
  /** tucked away at the top edge of the screen */
  tucked?: boolean
  /** its contents hidden (blurred) on the board */
  hidden?: boolean
  color?: string
  /** shared with agents by the user */
  shared?: boolean
  /** a table: how many rows it has under the header */
  rowCount?: number
  /** how many comments it has (read() gives them) */
  comments?: number
  /** the section it's in (an area on the board with a title) */
  section?: string
  /** arrows to and from the other cards you can see: "→ Title" points to it, "← Title" from it, a label after a colon */
  arrows?: string[]
}
/** What read() gives: a card's contents, asked for one card at a time. */
export type CardContent = {
  title: string
  kind: string
  file?: string
  url?: string
  /** a note: all its text (up to 20,000 characters); a file or link: the start of what it shows */
  text?: string
  /** a table: its rows, the first being the header (up to 200) */
  rows?: string[][]
  comments?: { by: string; text: string }[]
}
type CardOptions = {
  value?: CardValue
  spaces?: string[]
  onComment?: (text: string) => void
  onFold?: (fold: boolean) => void
  onFocus?: () => void
  onMoveToSpace?: (space: string) => void
  onRename?: (title: string) => void
  onColor?: (color: StickyColor) => void
  onRemove?: () => void
  onTuck?: (tuck: boolean) => void
  onVeil?: (veil: boolean) => void
  onTable?: (change: TableChange) => Promise<void>
  onPlaceNextTo?: (other: string, side: Side) => void
  onWrite?: (change: { text: string; append: boolean }) => Promise<void>
  onRead?: () => CardContent
  onConnect?: (other: string, label: string) => void
  onMoveToSection?: (section: string) => void
  /** the sections it can go into (for moveToSection) */
  sections?: string[]
  onDisconnect?: (other: string) => void
  /** the other cards' titles (for placeNextTo) */
  others?: string[]
}
export type Side = 'right' | 'left' | 'below' | 'above'
const SIDES: Record<string, Side> = { right: 'right', left: 'left', below: 'below', under: 'below', beneath: 'below', above: 'above', over: 'above', top: 'above', bottom: 'below' }
export type TableChange = { setCell?: [row: unknown, column: unknown, text: string]; addRows?: string[][]; setRows?: string[][]; removeRow?: unknown }
const COLORS: Record<string, StickyColor> = { yellow: 'yellow', green: 'green', pink: 'pink', orange: 'orange', charcoal: 'ink', ink: 'ink', dark: 'ink', black: 'ink' }

const cardPrimitive = definePrimitive({
  name: 'card',
  options: { value: 'value', spaces: 'value', onComment: 'action', onFold: 'action', onFocus: 'action', onMoveToSpace: 'action', onRename: 'action', onColor: 'action', onRemove: 'action', onTuck: 'action', onVeil: 'action', onTable: 'action', onPlaceNextTo: 'action', onWrite: 'action', onRead: 'action', onConnect: 'action', onDisconnect: 'action', onMoveToSection: 'action', sections: 'value', others: 'value' },
  // pending and error: a change that takes a moment (a note, a table) reports how it went; UI SDK's act waits on them
  // (any error that isn't null counts as a failure, an empty one too)
  state: (options: CardOptions) => ({ value: options.value ?? { kind: 'card', space: 'Main' }, pending: false, error: null as string | null }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const v = () => context.store.get().value as CardValue
    const call = <K extends keyof CardOptions>(key: K) => {
      const fn = context.options()[key]
      if (typeof fn !== 'function') throw new Error(`A ${v().kind} card can't do that.`)
      return fn as Extract<NonNullable<CardOptions[K]>, (...a: never[]) => unknown>
    }
    const track = (p: Promise<void>) => {
      context.store.set({ pending: true, error: null })
      p.then(
        () => context.store.set({ pending: false }),
        (e: unknown) => context.store.set({ pending: false, error: e instanceof Error ? e.message : String(e) }),
      )
      return p
    }
    const api = {
      // its contents, for this one card (the overview has only titles and kinds)
      read: () => call('onRead')(),
      comment: (text: string) => {
        const t = words(text)
        if (!t) throw new Error('Give the comment.')
        call('onComment')(t)
      },
      fold: () => call('onFold')(true),
      unfold: () => call('onFold')(false),
      focus: () => call('onFocus')(),
      moveToSpace: (space: string) => call('onMoveToSpace')(pick(context.options().spaces || [], space, s => s, s => s, 'space')),
      rename: (title: string) => call('onRename')(words(title)),
      setColor: (color: string) => {
        const c = COLORS[words(color).toLowerCase()]
        if (!c) throw new Error('A sticky note is yellow, green, pink, orange or charcoal.')
        call('onColor')(c)
      },
      remove: () => call('onRemove')(),
      tuck: () => call('onTuck')(true),
      bringBack: () => call('onTuck')(false),
      hideContents: () => call('onVeil')(true),
      showContents: () => call('onVeil')(false),
      setCell: (row: unknown, column: unknown, text: string) => track(call('onTable')({ setCell: [row, column, String(text ?? '')] })),
      addRows: (rows: unknown) => track(call('onTable')({ addRows: rowsOf(rows) })),
      setRows: (rows: unknown) => track(call('onTable')({ setRows: rowsOf(rows) })),
      removeRow: (row: unknown) => track(call('onTable')({ removeRow: row })),
      // a note: add to its end, or write all of it anew (that waits for the user's Allow)
      append: (text: string) => track(call('onWrite')({ text: String(text ?? ''), append: true })),
      setText: (text: string) => track(call('onWrite')({ text: String(text ?? ''), append: false })),
      placeNextTo: (other: string, side?: string) => {
        const s = words(side) ? SIDES[words(side).toLowerCase()] : 'right'
        if (!s) throw new Error('A side is right, left, below or above.')
        call('onPlaceNextTo')(pick(context.options().others || [], other, x => x, x => x, 'card'), s)
      },
      // an arrow from this card to another (with a label, or a new label on the one already there); disconnect takes
      // the arrows between the two away (that waits for the user's Allow)
      connectTo: (other: string, label?: string) => call('onConnect')(pick(context.options().others || [], other, x => x, x => x, 'card'), words(label)),
      // into a section (a titled area): beside what's in it, the section growing to hold it
      moveToSection: (section: string) => call('onMoveToSection')(pick(context.options().sections || [], section, x => x, x => x, 'section')),
      disconnect: (other: string) => call('onDisconnect')(pick(context.options().others || [], other, x => x, x => x, 'card')),
    }
    // only what this kind of card does: an agent sees a note's, a table's or a sticky note's own actions, not all of
    // them on every card (UI SDK lists each function the api has)
    const o = context.options()
    const only: [boolean, (keyof typeof api)[]][] = [
      [!!o.onTable, ['setCell', 'addRows', 'setRows', 'removeRow']],
      [!!o.onWrite, ['append', 'setText']],
      [!!o.onColor, ['setColor']],
      [!!o.onRename, ['rename']],
    ]
    for (const [has, names] of only) if (!has) for (const n of names) delete (api as Partial<typeof api>)[n]
    return api
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['read', 'comment', 'fold', 'unfold', 'focus', 'moveToSpace', 'rename', 'setColor', 'tuck', 'bringBack', 'hideContents', 'showContents', 'setCell', 'addRows', 'setRows', 'removeRow', 'append', 'setText', 'placeNextTo', 'connectTo', 'disconnect', 'moveToSection', 'remove'] },
})
const { Root: CardRoot } = createParts(cardPrimitive, { root: 'div' })

// ---- Later -------------------------------------------------------------------------------------------------

type LaterItem = { id: string; title: string; url?: string; state: string }
type LaterOptions = { value?: { title: string; state: string }[]; items?: LaterItem[]; onAdd?: (t: string) => void; onSetState?: (id: string, state: string) => void; onRemove?: (id: string) => void }
const STATES: Record<string, string> = { check: 'todo', 'to check': 'todo', todo: 'todo', reading: 'reading', done: 'done' }

const laterPrimitive = definePrimitive({
  name: 'later-list',
  options: { value: 'value', items: 'value', onAdd: 'action', onSetState: 'action', onRemove: 'action' },
  state: (options: LaterOptions) => ({ value: options.value ?? [] }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const list = () => context.options().items ?? []
    const item = (which: string) => pick(list(), which, x => x.id, x => x.title, 'item').id
    const call = <K extends keyof LaterOptions>(key: K) => context.options()[key] as NonNullable<LaterOptions[K]>
    return {
      add: (linkOrNote: string) => {
        const t = words(linkOrNote)
        if (!t) throw new Error('Give a link or a note.')
        call('onAdd')(t)
      },
      setState: (which: string, state: string) => {
        const s = STATES[words(state).toLowerCase()]
        if (!s) throw new Error('A state is "to check", "reading" or "done".')
        call('onSetState')(item(which), s)
      },
      remove: (which: string) => call('onRemove')(item(which)),
      // the items with their links (the list itself shows titles and states only)
      read: () => list().map(({ title, url, state }) => ({ title, ...(url ? { url } : {}), state })),
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['read', 'add', 'setState', 'remove'] },
})
const { Root: LaterRoot } = createParts(laterPrimitive, { root: 'div' })

// ---- Questions ---------------------------------------------------------------------------------------------
// What an agent asks instead of stopping: the question with its best guess, which it carries on with; the person
// answers on the board when they like, and the agent reads the answers when it next looks.

type QuestionItem = { id: string; question: string; guess?: string; about?: string; answer?: string; state: 'open' | 'answered' }
type QuestionOptions = { value?: { question: string; state: string }[]; items?: QuestionItem[]; onAsk?: (question: string, guess: string, about: string) => void; onRemove?: (id: string) => void }

const questionPrimitive = definePrimitive({
  name: 'question-list',
  options: { value: 'value', items: 'value', onAsk: 'action', onRemove: 'action' },
  state: (options: QuestionOptions) => ({ value: options.value ?? [] }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const list = () => context.options().items ?? []
    const call = <K extends keyof QuestionOptions>(key: K) => context.options()[key] as NonNullable<QuestionOptions[K]>
    return {
      ask: (question: string, guess?: string, about?: string) => {
        const q = words(question)
        if (!q) throw new Error('Give the question.')
        call('onAsk')(q, words(guess), words(about))
      },
      // every question with your guess and the person's answer (an open one: your guess stands)
      read: () => list().map(({ id: _id, ...q }) => q),
      remove: (which: string) => call('onRemove')(pick(list(), which, x => x.id, x => x.question, 'question').id),
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['ask', 'read', 'remove'] },
})
const { Root: QuestionRoot } = createParts(questionPrimitive, { root: 'div' })

// ---- Snippets ----------------------------------------------------------------------------------------------

type SnippetItem = { id: string; title: string; secret: boolean; text?: string }
type SnippetOptions = { value?: { title: string; secret: boolean }[]; items?: SnippetItem[]; onAdd?: (text: string, title: string) => void; onRemove?: (id: string) => void }

const snippetPrimitive = definePrimitive({
  name: 'snippet-list',
  options: { value: 'value', items: 'value', onAdd: 'action', onRemove: 'action' },
  state: (options: SnippetOptions) => ({ value: options.value ?? [] }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const list = () => context.options().items ?? []
    const call = <K extends keyof SnippetOptions>(key: K) => context.options()[key] as NonNullable<SnippetOptions[K]>
    return {
      add: (text: string, title?: string) => {
        const t = String(text ?? '')
        if (!t.trim()) throw new Error('Give the text to keep.')
        call('onAdd')(t, words(title))
      },
      remove: (which: string) => call('onRemove')(pick(list(), which, x => x.id, x => x.title, 'snippet').id),
      // one snippet's text (a secret's is never given)
      read: (which: string) => {
        const sn = pick(list(), which, x => x.id, x => x.title, 'snippet')
        return sn.secret ? { title: sn.title, secret: true, text: '(a secret: its text is never shown)' } : { title: sn.title, text: sn.text ?? '' }
      },
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['read', 'add', 'remove'] },
})
const { Root: SnippetRoot } = createParts(snippetPrimitive, { root: 'div' })

// ---- on the page -------------------------------------------------------------------------------------------

const KIND: Record<string, string> = { item: 'file or link', note: 'note', outputs: 'Claude outputs', tasks: 'today', tracker: 'tracker', command: 'command', later: 'later', snippets: 'snippets', folder: 'folder', table: 'table', questions: 'questions' }
/** The title of the section a card is in ("Section" for one with no title), or '' for none. */
const sectionTitle = (n: CardNode, all: CardNode[]) => {
  const s = sectionOf(n, all)
  return s ? s.data.title || 'Section' : ''
}
type Row = [id: string, type: string, ref: string, space: string, folded: boolean, selected: boolean, inView: boolean, color: string, tucked: boolean, veiled: boolean, mark: string, section: string]
type Built = { id: string; type: string; ref: string; title: string; value: CardValue; content: Omit<CardContent, 'text'> & { peek?: string }; mark: string; spaceId: string }

export function BoardAgent() {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  // the cards, as a string, so this only redraws when one is added, taken off, moved, folded, selected, or comes into
  // or goes out of view
  const cardsKey = useStore(s => {
    const [tx, ty, z] = s.transform
    const view = { x0: -tx / z, y0: -ty / z, x1: (s.width - tx) / z, y1: (s.height - ty) / z }
    const all = s.nodes as CardNode[]
    return JSON.stringify(
      // a section isn't a card: each card says which section it's in
      all.filter(n => !isSection(n)).map(n => {
        const d = n.data as CardNode['data']
        const w = n.measured?.width ?? n.width ?? 0
        const h = n.measured?.height ?? n.height ?? 0
        const seen = !n.hidden && n.position.x < view.x1 && n.position.x + w > view.x0 && n.position.y < view.y1 && n.position.y + h > view.y0
        return [n.id, n.type, d.ref, spaceOf(n as CardNode), !!d.folded, !!n.selected, seen, d.color || '', !!d.tucked, !!d.veiled, d.agents || '', sectionTitle(n, all)] as Row
      }),
    )
  })
  const snippets = useData(() => get<Snippet[]>('/api/snippets'), [], { refreshOn: ['snippets'] })
  // the tables on the board, read so an agent sees their rows
  const tableRefs = useMemo(() => [...new Set((JSON.parse(cardsKey) as Row[]).filter(r => r[1] === 'table').map(r => r[2]))].sort(), [cardsKey])
  const tables = useData(
    () => Promise.all(tableRefs.map(p => get<TableData>(`/api/tables?p=${encodeURIComponent(p)}`).catch(() => null))),
    [tableRefs.join('|')],
    { refreshOn: ['tables'] },
  )
  const notes = board.notes
  const sep = notes?.root.includes('\\') ? '\\' : '/'
  const spaceName = (id: string) => board.spaces.find(s => s.id === id)?.name ?? 'Main'
  const spaceId = (name: string) => board.spaces.find(s => s.name === name)?.id ?? 'main'
  const said = (t: string) => board.toast(t)

  const cards: Built[] = useMemo(() => {
    const spaceOfId = (id: string) => board.spaces.find(s => s.id === id)?.name ?? 'Main'
    const built = (JSON.parse(cardsKey) as Row[]).map(([id, type, ref, space, folded, selected, inView, color, tucked, veiled, mark, section]) => {
      let title = KIND[type] ?? type
      let file: string | undefined
      let url: string | undefined
      let peek: string | undefined
      if (type === 'item') {
        const e = board.items.find(x => x.id === ref)
        title = e?.title || 'File'
        if (e?.url) url = e.url
        else if (e?.path && e.kind === 'file') file = e.path
        peek = e?.excerpt
      } else if (type === 'note') {
        const n = notes?.notes.find(x => x.path === ref)
        // a note with nothing in it and no title is named by its file (a time stamp): it's "Untitled" to an agent
        const stem = (ref.split('/').pop() || '').replace(/\.(md|markdown|txt)$/i, '')
        const own = n?.title && n.title !== stem ? n.title : n?.excerpt?.split('\n').find(l => l.trim())?.trim()
        title = /^journal\//.test(ref) ? `Journal ${ref.slice(8, 18)}` : own || (isSticky(type, ref) ? 'Untitled sticky note' : 'Untitled note')
        if (notes) file = notes.root + sep + ref.split('/').join(sep)
        peek = n?.excerpt
      } else if (type === 'folder') {
        title = ref.split(/[\\/]/).filter(Boolean).pop() || ref
        file = ref
      } else if (type === 'outputs') {
        const g = board.outputs.find(x => x.id === ref)
        title = g ? `Claude: ${summary(g)}` : 'Claude outputs'
        if (g) peek = g.items.map(i => `${i.kind}: ${i.label}`).join('\n')
      } else if (type === 'table') {
        const t = tables.data?.find(x => x?.path === ref)
        title = t?.title || ref.split('/').pop()?.replace(/\.csv$/i, '') || 'Table'
        if (notes) file = notes.root + sep + ref.split('/').join(sep)
      } else if (type === 'tracker') title = `Tracker: ${ref}`
      // the lists themselves are "Today's tasks", "Later" and "Snippets": their cards are named apart
      else if (type === 'tasks') title = 'Today card'
      else if (type === 'later') title = 'Later card'
      else if (type === 'snippets') title = 'Snippets card'
      else if (type === 'questions') title = 'Questions card'
      const thread = board.comments[id]
      const sticky = isSticky(type, ref)
      const value: CardValue = {
        kind: sticky ? 'sticky note' : KIND[type] ?? type,
        space: spaceOfId(space),
        ...(selected ? { selected: true } : {}),
        ...(inView ? { inView: true } : {}),
        ...(folded ? { folded: true } : {}),
        ...(tucked ? { tucked: true } : {}),
        ...(veiled ? { hidden: true } : {}),
        ...(sticky ? { color: color === 'ink' || !color ? 'charcoal' : color } : {}),
        ...(mark === 'shared' ? { shared: true } : {}),
        ...(section ? { section } : {}),
        ...(thread?.length ? { comments: thread.length } : {}),
      }
      const content: Built['content'] = {
        title,
        kind: value.kind,
        ...(file ? { file } : {}),
        ...(url ? { url } : {}),
        ...(peek ? { peek: peek.length > PEEK ? `${peek.slice(0, PEEK)}…` : peek } : {}),
        ...(thread?.length ? { comments: thread.slice(-20).map(c => ({ by: c.by, text: c.text })) } : {}),
      }
      if (type === 'table') {
        const t = tables.data?.find(x => x?.path === ref)
        if (t) {
          value.rowCount = Math.max(0, t.rows.length - 1)
          content.rows = t.rows.slice(0, 201)
        }
      }
      return { id, type, ref, title, value, content, mark, spaceId: space }
    })
    // two cards with one name (two untitled notes, two copies of a file): the second is "… (2)", so each can be named
    const seen = new Map<string, number>()
    return built.map(c => {
      const k = (seen.get(c.title) ?? 0) + 1
      seen.set(c.title, k)
      return k === 1 ? c : { ...c, title: `${c.title} (${k})`, content: { ...c.content, title: `${c.title} (${k})` } }
    })
  }, [cardsKey, board.spaces, board.space, board.items, board.outputs, board.comments, notes, sep, tables.data])

  // What the agent calling may see (Settings > Agents): with "what I share", the cards selected or shared, the cards in
  // a shared space, and those an agent made; with "everything", every card. A private card, or any card in a private
  // space, never. The rest are drawn inside data-agent-hidden: not listed, not found, not used.
  const { access } = useAgentView()
  const markOf = (spaceIdOf: string) => board.spaces.find(s => s.id === spaceIdOf)?.agents
  const sees = (c: Built) => {
    if (access === 'off' || c.mark === 'private' || markOf(c.spaceId) === 'private') return false
    return access === 'all' || c.mark === 'shared' || markOf(c.spaceId) === 'shared' || !!c.value.selected
  }
  const visible = useMemo(() => cards.filter(sees), [cards, access, board.spaces]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibleIds = useMemo(() => new Set(visible.map(c => c.id)), [visible])
  useEffect(() => setVisible(visibleIds, visible.map(c => c.title)), [visibleIds, visible])
  // the spaces it may name: not private; with "what I share", a shared one or one with a card it can see
  const openSpaces = useMemo(
    () => board.spaces.filter(s => s.agents !== 'private' && (access === 'all' || s.agents === 'shared' || visible.some(c => c.spaceId === s.id))),
    [board.spaces, access, visible],
  )
  // the notes it can see, read whole: it reads and writes them through the board, not the files (Settings > Agents
  // can fence the notes folder off from Claude Code)
  const noteRefs = useMemo(() => [...new Set(visible.filter(c => c.type === 'note').map(c => c.ref))].sort(), [visible])
  const noteTexts = useData(
    () => Promise.all(noteRefs.map(p => get<{ path: string; text: string }>(`/api/notes/file?p=${encodeURIComponent(p)}`).catch(() => null))),
    [noteRefs.join('|')],
    { refreshOn: ['notes'] },
  )
  const textOf = (ref: string) => {
    const t = noteTexts.data?.find(n => n?.path === ref)?.text
    return t === undefined ? undefined : t.length > 20_000 ? `${t.slice(0, 20_000)}…` : t
  }
  const writeNote = async (ref: string, title: string, { text, append }: { text: string; append: boolean }) => {
    const cur = await get<{ text: string; mtime: number }>(`/api/notes/file?p=${encodeURIComponent(ref)}`)
    const next = append ? `${cur.text.replace(/\s+$/, '')}${cur.text.trim() ? '\n\n' : ''}${text.trim()}\n` : text
    const r = await put<{ conflict?: boolean }>('/api/notes/file', { path: ref, text: next, baseMtime: cur.mtime })
    if (r.conflict) throw new Error('The note changed while you were writing; read it again and retry.')
    said(append ? `Claude added to ${title}` : `Claude rewrote ${title}`)
  }
  // read(): one card's contents. A note's whole text (read ahead while it's visible, so this can answer at once); a file
  // or link: where it is and the start of what it shows; a table: its rows; and the card's comments.
  const readCard = (c: Built): CardContent => {
    if (!visibleIds.has(c.id)) throw new Error("That card isn't shared with you.")
    const { peek, ...rest } = c.content
    if (c.type === 'note') {
      const text = textOf(c.ref)
      if (text === undefined) throw new Error('The note is still loading: read it again in a moment.')
      return { ...rest, text }
    }
    return { ...rest, ...(peek ? { text: peek } : {}) }
  }
  // a list (Today, Later, Snippets) is readable when its card is; with "everything", unless that card is private
  const listOpen = (type: string) => {
    const of = cards.filter(c => c.type === type)
    if (access === 'all') return !of.some(c => !sees(c))
    return of.some(c => visibleIds.has(c.id))
  }

  // the sections in the spaces it may see, by title ("Section" for one with none; a second of one name "… (2)")
  const sectionsKey = useStore(s => JSON.stringify((s.nodes as CardNode[]).filter(isSection).map(n => [n.id, n.data.title || 'Section', spaceOf(n)])))
  const sectionList = useMemo(() => {
    const open = new Set(openSpaces.map(s => s.id))
    const seen = new Map<string, number>()
    return (JSON.parse(sectionsKey) as [string, string, string][])
      .filter(([, , sp]) => open.has(sp))
      .map(([id, t, sp]) => {
        const k = (seen.get(t) ?? 0) + 1
        seen.set(t, k)
        return { id, name: k === 1 ? t : `${t} (${k})`, spaceId: sp }
      })
  }, [sectionsKey, openSpaces])
  const sectionNames = useMemo(() => sectionList.map(s => s.name), [sectionList])
  const boardValue: BoardValue = useMemo(
    () => ({
      space: openSpaces.some(s => s.id === board.space) ? spaceName(board.space) : '(not shared with you)',
      spaces: openSpaces.map(s => ({ name: s.name, cards: visible.filter(c => c.spaceId === s.id).length })),
      // the sections in the space shown (a card's moveToSection puts it in one)
      ...(sectionList.some(s => s.spaceId === board.space) ? { sections: sectionList.filter(s => s.spaceId === board.space).map(s => s.name) } : {}),
      selected: visible.filter(c => c.value.selected).map(c => c.title),
      inView: visible.filter(c => c.value.inView).map(c => c.title),
      ...(board.focusing ? { focus: visible.filter(c => c.value.selected).map(c => c.title) } : {}),
      ...(access === 'shared'
        ? { sharing: 'You see only what the user shares with agents: cards they select or share, shared spaces, and cards you made. If they mean something you cannot see, ask them to select it or share it (right-click a card: Share with agents).' }
        : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, openSpaces, sectionList, board.space, board.focusing, access],
  )
  // the arrows between the cards it can see, on each card's value: "→ Title" it points to, "← Title" from
  const edgesKey = useStore(s => s.edges.map(e => [e.id, e.source, e.target, (e.data as LinkData | undefined)?.label || ''].join('|')).join(';'))
  const values = useMemo(() => {
    const titleOf = new Map(visible.map(c => [c.id, c.title]))
    const arrows = new Map<string, string[]>()
    const add = (id: string, line: string) => arrows.set(id, [...(arrows.get(id) || []), line])
    for (const e of rf.getEdges()) {
      const from = titleOf.get(e.source)
      const to = titleOf.get(e.target)
      if (!from || !to) continue
      const label = (e.data as LinkData | undefined)?.label
      add(e.source, `→ "${to}"${label ? `: ${label}` : ''}`)
      add(e.target, `← "${from}"${label ? `: ${label}` : ''}`)
    }
    return new Map(cards.map(c => [c.id, arrows.has(c.id) ? { ...c.value, arrows: arrows.get(c.id) } : c.value]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, visible, edgesKey])
  const between = (a: string, b: string) => rf.getEdges().filter(e => (e.source === a && e.target === b) || (e.source === b && e.target === a))
  const connect = (c: Built, otherTitle: string, label: string) => {
    const other = visible.find(x => x.title === otherTitle && x.id !== c.id)
    if (!other) throw new Error(`No card "${otherTitle}" on the board.`)
    const there = between(c.id, other.id)[0]
    if (there) {
      if (!label) return
      board.setLink(there.id, { label })
      return said(`Claude labelled the arrow between ${c.title} and ${other.title}`)
    }
    board.addLink(c.id, other.id, label ? { label } : {})
    said(`Claude drew an arrow from ${c.title} to ${other.title}`)
  }
  const disconnect = (c: Built, otherTitle: string) => {
    const other = visible.find(x => x.title === otherTitle && x.id !== c.id)
    const there = other ? between(c.id, other.id) : []
    if (!other || !there.length) throw new Error(`No arrow between "${c.title}" and "${otherTitle}".`)
    for (const e of there) board.removeLink(e.id)
  }
  // a card into a section: beside what's in it (to the right of the rightmost, level with the top one), or at its
  // top-left when it's empty; the section grows to hold it. In the section's space. Undo puts it back.
  const moveToSection = (c: Built, name: string) => {
    const sec = sectionList.find(s => s.name === name)
    const s = sec && rf.getNode(sec.id)
    const n = rf.getNode(c.id)
    if (!s || !n) throw new Error(`No section "${name}".`)
    const size = (x: CardNode) => ({ w: x.measured?.width ?? x.width ?? 300, h: x.measured?.height ?? x.height ?? 280 })
    const sb = { x: s.position.x, y: s.position.y, ...size(s) }
    const inside = contentsOf(s, rf.getNodes()).filter(x => x.id !== c.id && !isSection(x))
    const PAD = 40
    const GAP = 28
    const pos = inside.length ? { x: Math.max(...inside.map(x => x.position.x + size(x).w)) + GAP, y: Math.min(...inside.map(x => x.position.y)) } : { x: sb.x + PAD, y: sb.y + PAD }
    const me = size(n)
    const there = spaceOf(s)
    board.remember()
    rf.setNodes(ns =>
      ns.map(x => {
        if (x.id === c.id) {
          const { space: _s, tucked: _t, ...data } = x.data
          return { ...x, position: pos, hidden: there !== board.space, data: there === 'main' ? data : { ...data, space: there } }
        }
        if (x.id === s.id) return { ...x, width: Math.round(Math.max(sb.x + sb.w, pos.x + me.w + PAD) - sb.x), height: Math.round(Math.max(sb.y + sb.h, pos.y + me.h + PAD) - sb.y) }
        return x
      }),
    )
    board.persist()
    // the view follows it, so the card doesn't vanish from where the person is looking (on the space they're on)
    if (there === board.space) setTimeout(() => rf.fitView({ nodes: [{ id: s.id }], duration: 320, padding: 0.15, maxZoom: 1 }), 60)
    said(`Claude put ${c.title} in the section "${name}"`)
  }
  const spaceNames = useMemo(() => openSpaces.map(s => s.name), [openSpaces])
  // every visible card's title, for "next to which card" (the same array while the cards stay the same)
  const allTitles = useMemo(() => visible.map(c => [c.id, c.title] as const), [visible])
  const titlesBut = (id: string) => allTitles.filter(([i]) => i !== id).map(([, t]) => t)

  const later: LaterItem[] = useMemo(
    () => board.items.filter(e => e.later).map(e => ({ id: e.id, title: e.title, ...(e.url ? { url: e.url } : {}), state: e.later === 'todo' ? 'to check' : e.later! })),
    [board.items],
  )
  // the questions it left (and the person's answers): readable when the Questions card is shared with it, or not on
  // the board at all
  const questions = useData(() => get<Question[]>('/api/questions'), [], { refreshOn: ['questions'] })
  const questionList: QuestionItem[] = useMemo(
    () =>
      (questions.data || []).map(q => ({
        id: q.id,
        question: q.question,
        ...(q.guess ? { guess: q.guess } : {}),
        ...(q.about ? { about: q.about } : {}),
        ...(q.answer ? { answer: q.answer } : {}),
        state: q.answeredAt ? 'answered' : 'open',
      })),
    [questions.data],
  )
  const questionsOpen = !cards.some(c => c.type === 'questions') || listOpen('questions')
  const snippetList: SnippetItem[] = useMemo(
    () => (snippets.data || []).map(s => ({ id: s.id, title: s.title, secret: s.secret, ...(s.secret ? {} : { text: s.preview }) })),
    [snippets.data],
  )

  const fold = (id: string, f: boolean) => {
    board.remember()
    rf.setNodes(ns => ns.map(n => (n.id === id ? foldNode(n, f) : n)))
    board.persist()
  }
  // a change Claude makes to a table: read it, change it, save it (the card reads it again)
  const changeTable = async (ref: string, title: string, ch: TableChange) => {
    const t = await get<TableData>(`/api/tables?p=${encodeURIComponent(ref)}`)
    let rows = t.rows.map(r => [...r])
    const head = rows[0] || []
    const col = (c: unknown) => {
      const n = Number(c)
      if (Number.isInteger(n) && n >= 1) return n - 1
      const i = head.findIndex(h => h.trim().toLowerCase() === words(c).toLowerCase())
      if (i < 0) throw new Error(`No column "${words(c)}". The columns: ${head.map(h => `"${h}"`).join(', ')} (or a number from 1).`)
      return i
    }
    const row = (r: unknown) => {
      const n = Number(r)
      if (Number.isInteger(n) && n >= 1) {
        if (n > rows.length - 1) throw new Error(`The table has ${rows.length - 1} rows (row 1 is the first under the header).`)
        return n
      }
      const i = rows.findIndex((x, k) => k > 0 && (x[0] || '').trim().toLowerCase() === words(r).toLowerCase())
      if (i < 0) throw new Error(`No row starting "${words(r)}". Name a row by its first cell, or by its number (1 is the first under the header).`)
      return i
    }
    let done = ''
    if (ch.setCell) {
      const [r, c, text] = ch.setCell
      const ri = row(r)
      const ci = col(c)
      while (rows[ri].length <= ci) rows.forEach(x => x.push(''))
      rows[ri][ci] = text
      done = `Claude filled in ${title}`
    } else if (ch.addRows) {
      rows.push(...ch.addRows)
      done = `Claude added ${ch.addRows.length === 1 ? 'a row' : `${ch.addRows.length} rows`} to ${title}`
    } else if (ch.setRows) {
      rows = ch.setRows
      done = `Claude rewrote ${title}`
    } else if (ch.removeRow !== undefined) {
      rows.splice(row(ch.removeRow), 1)
      done = `Claude took a row out of ${title}`
    }
    await put('/api/tables', { path: ref, rows, baseMtime: t.mtime, by: 'Claude' })
    said(done)
  }

  // made for another space: it goes there (the user's view stays where it is; the toast says where it went)
  const place = (id: string | undefined, space?: string) => {
    // what an agent makes is shared with agents: it can go on working with it
    if (id) board.setCardAgents([id], 'shared')
    if (id) touchCard(id, 'made')
    if (!id || !space || spaceId(space) === board.space) return
    board.moveToSpace([id], spaceId(space))
  }

  // a card beside another (a gap between them), in that card's space; if something is already there, the nearest free
  // spot. It can be undone (Ctrl+Z) like any move.
  const GAP = 28
  const placeNextTo = (id: string, title: string, otherTitle: string, side: Side) => {
    const other = visible.find(c => c.title === otherTitle && c.id !== id)
    const a = rf.getNode(id)
    const b = other && rf.getNode(other.id)
    if (!a || !b) throw new Error(`No card "${otherTitle}" on the board.`)
    const size = (n: CardNode) => ({ w: n.measured?.width ?? n.width ?? 400, h: n.measured?.height ?? n.height ?? 300 })
    const sa = size(a)
    const sb = size(b)
    const want =
      side === 'right' ? { x: b.position.x + sb.w + GAP, y: b.position.y }
      : side === 'left' ? { x: b.position.x - sa.w - GAP, y: b.position.y }
      : side === 'below' ? { x: b.position.x, y: b.position.y + sb.h + GAP }
      : { x: b.position.x, y: b.position.y - sa.h - GAP }
    const there = spaceOf(b)
    const pos = freeSpot(want, sa, rf.getNodes().filter(n => n.id !== id && spaceOf(n) === there && !n.data.tucked && !isSection(n)))
    board.remember()
    rf.setNodes(ns =>
      ns.map(n => {
        if (n.id !== id) return n
        const { space: _s, tucked: _t, ...data } = n.data
        return { ...n, position: pos, hidden: there !== board.space, data: there === 'main' ? data : { ...data, space: there } }
      }),
    )
    board.persist()
    const plain = (t: string) => t.replace(/ card$/, '')
    said(`Claude put ${plain(title)} ${side === 'right' || side === 'left' ? `to the ${side} of` : side} ${plain(otherTitle)}`)
  }

  const focus = (id: string) => {
    const n = rf.getNode(id)
    if (!n) return
    if (spaceOf(n) !== board.space) board.switchSpace(spaceOf(n))
    setTimeout(() => rf.fitView({ nodes: [{ id }], duration: 320, padding: 0.25, maxZoom: 1 }), 80)
  }

  return (
    <>
      <BoardRoot
        aria-label="Board"
        className="sr-only"
        value={boardValue}
        onSwitchSpace={s => board.switchSpace(spaceId(s))}
        onNewSpace={name => {
          board.newSpace(name)
          said(`Claude made the space "${name}"`)
        }}
        onRenameSpace={(s, name) => board.renameSpace(spaceId(s), name)}
        onAddSticky={(t, s) => void board.newSticky(t).then(id => place(id, s))}
        onJot={board.prefs.extras.journal ? t => post('/api/notes/thought', { text: t }).then(() => said("Claude added to today's journal"), (e: Error) => said(e.message)) : undefined}
        onTidy={() => board.tidy()}
        onFocusOn={titles => {
          // in the order named, side by side; a focus already on is put back first
          const ids = titles.map(t => pick(visible, t, c => c.id, c => c.title, 'card').id)
          const go = () => board.toggleFocus(ids)
          if (board.focusing) {
            board.toggleFocus()
            setTimeout(go, 400)
          } else go()
          said(ids.length > 1 ? `Claude put ${ids.length} cards in focus` : 'Claude put a card in focus')
        }}
        onBringBack={() => board.focusing && board.toggleFocus()}
        onCompare={titles => {
          // full screen, side by side, in the order named (the first on the left)
          const [a, b] = titles.map(t => pick(visible, t, c => c.id, c => c.title, 'card').id)
          board.compareCards([a, b], true)
          said('Claude put two cards side by side')
        }}
        onAddSection={(title, titles) => {
          const named = titles.map(t => pick(visible, t, c => c.id, c => c.title, 'card'))
          const away = named.filter(c => c.spaceId !== board.space)
          if (away.length) throw new Error(`${away.map(c => `"${c.title}"`).join(', ')} ${away.length === 1 ? 'is' : 'are'} in another space: switchSpace there first, or moveToSpace them here.`)
          touchCard(board.addSection({ around: named.map(c => c.id), title }), 'made')
          said(`Claude put ${named.length === 1 ? 'a card' : `${named.length} cards`} in the section "${title}"`)
        }}
        sectionNames={sectionNames}
        onFitSection={name => {
          const id = sectionList.find(s => s.name === name)?.id
          if (!id || !board.fitSection(id)) throw new Error(`The section "${name}" has nothing in it to fit to.`)
          said(`Claude fitted the section "${name}" to what's in it`)
        }}
        onShow={(t, s) => void (/^https?:\/\//i.test(t) ? board.showItem({ url: t }) : board.showItem({ path: t })).then(id => place(id, s))}
        onAddTable={
          board.prefs.extras.tables
            ? (title, rows, s) =>
                void newTable(board, { title, rows }).then(id => {
                  if (id && !s) said(`Claude made the table "${title}"`)
                  place(id, s)
                })
            : undefined
        }
      />
      {cards.map(c => (
        <div key={c.id} {...(visibleIds.has(c.id) ? {} : { 'data-agent-hidden': '' })}>
          <CardRoot
            aria-label={c.title}
            className="sr-only"
            value={values.get(c.id) ?? c.value}
            onRead={() => (touchCard(c.id, 'reading'), readCard(c))}
            onConnect={(other, label) => (touchCard(c.id, 'arranging'), connect(c, other, label))}
            onDisconnect={other => (touchCard(c.id, 'arranging'), disconnect(c, other))}
            sections={sectionNames}
            onMoveToSection={name => (touchCard(c.id, 'arranging'), moveToSection(c, name))}
            spaces={spaceNames}
            onComment={t => {
              touchCard(c.id, 'commenting')
              board.addComment(c.id, t, 'Claude').catch(() => {})
              said(`Claude commented on ${c.title}`)
            }}
            onFold={f => (touchCard(c.id, 'arranging'), fold(c.id, f))}
            onFocus={() => (touchCard(c.id, 'reading'), focus(c.id))}
            onMoveToSpace={s => board.moveToSpace([c.id], spaceId(s))}
            onRename={
              c.type === 'note'
                ? t =>
                    (touchCard(c.id, 'writing'), post('/api/notes/title', { path: c.ref, title: t })).then(
                      () => said(t ? `Claude named the note "${t}"` : "Claude took the note's title off"),
                      (e: Error) => said(e.message),
                    )
                : undefined
            }
            onColor={c.value.kind === 'sticky note' ? color => (touchCard(c.id, 'arranging'), board.setColor(c.id, color)) : undefined}
            onRemove={() => board.removeCard(c.id)}
            onTuck={t => (t ? board.tuck([c.id]) : board.untuck(c.id))}
            onVeil={v => board.setVeiled([c.id], v)}
            onTable={c.type === 'table' ? ch => (touchCard(c.id, 'writing'), changeTable(c.ref, c.title, ch)) : undefined}
            onWrite={c.type === 'note' ? ch => (touchCard(c.id, 'writing'), writeNote(c.ref, c.title, ch)) : undefined}
            others={titlesBut(c.id)}
            onPlaceNextTo={(other, side) => (touchCard(c.id, 'arranging'), placeNextTo(c.id, c.title, other, side))}
          />
        </div>
      ))}
      <LaterRoot
        aria-label={listOpen('later') ? 'Later list' : 'Later list (not shared with you: you can add to it, not read it)'}
        className="sr-only"
        value={listOpen('later') ? later.map(({ title, state }) => ({ title, state })) : []}
        items={listOpen('later') ? later : []}
        onAdd={t => board.saveLater(/^https?:\/\//i.test(t) ? { url: t } : { text: t })}
        onSetState={(id, s) => board.setLater(id, s as 'todo' | 'reading' | 'done')}
        onRemove={id => board.setLater(id, null)}
      />
      <QuestionRoot
        aria-label={questionsOpen ? 'Questions list' : 'Questions list (not shared with you: you can ask, not read the answers)'}
        className="sr-only"
        value={questionsOpen ? questionList.map(({ question, state }) => ({ question, state })) : []}
        items={questionsOpen ? questionList : []}
        onAsk={(question, guess, about) =>
          void post<{ id: string }>('/api/questions', { question, guess, about, by: 'Claude' }).then(
            () => {
              questions.reload()
              // the Questions card comes onto the board where the person is looking, if it isn't on it yet
              const card = rf.getNodes().find(n => n.type === 'questions')
              if (card) touchCard(card.id, 'writing')
              else place(board.addCard('questions', 'questions', { at: rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 3 }) }))
              said('Claude left you a question')
            },
            (e: Error) => said(e.message),
          )
        }
        onRemove={id => post(`/api/questions/${id}/remove`).then(() => questions.reload(), (e: Error) => said(e.message))}
      />
      <SnippetRoot
        aria-label={listOpen('snippets') ? 'Snippets list' : 'Snippets list (not shared with you: you can leave one, not read them)'}
        className="sr-only"
        value={listOpen('snippets') ? snippetList.map(({ title, secret }) => ({ title, secret })) : []}
        items={listOpen('snippets') ? snippetList : []}
        onAdd={(text, title) =>
          post('/api/snippets', { text, ...(title ? { title } : {}) }).then(() => (snippets.reload(), said('Claude left a snippet')), (e: Error) => said(e.message))
        }
        onRemove={id => post(`/api/snippets/${id}/remove`).then(() => snippets.reload(), (e: Error) => said(e.message))}
      />
    </>
  )
}
