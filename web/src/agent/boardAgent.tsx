// The board as UI SDK components, so an agent (Claude Code, through Cockpit's board tools) can read it and use it.
// Nothing here draws anything: each is an invisible component whose value is the data and whose actions do what a
// click would.
// - "Board": the spaces, what the user has selected and has in view; make spaces, sticky notes, journal lines, cards.
// - One component per card, named by its title: so query({ text: "Post ideas" }) finds just that card. Its value says
//   what it is, where (space, selected, in view), a peek at its content and its comments; its actions are the card's.
// - "Later" and "Snippets": the lists themselves.
// Notes are files: a card gives the path, so an agent reads and edits the note where it is, and the board follows.
// Removing anything waits for the person (the bridge's allow). Experimental (spike/ui-sdk-today).
import { Fragment, useMemo } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { definePrimitive } from '@ui-sdk/core'
import { createParts } from '@ui-sdk/react/primitive'
import { foldNode, isSticky, spaceOf, useBoard, type CardNode } from '../board'
import { get, post, type Snippet, type StickyColor } from '../api'
import { useData } from '../lib'
import { summary } from '../cards/OutputsCard'

const words = (s: unknown) => String(s ?? '').trim()
const PEEK = 400

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

type BoardValue = { space: string; spaces: { name: string; cards: number }[]; selected: string[]; inView: string[] }
type BoardOptions = {
  value?: BoardValue
  onSwitchSpace?: (space: string) => void
  onNewSpace?: (name: string) => void
  onRenameSpace?: (space: string, name: string) => void
  onAddSticky?: (text: string) => void
  onJot?: (text: string) => void
  onShow?: (target: string) => void
}

const boardPrimitive = definePrimitive({
  name: 'board',
  options: { value: 'value', onSwitchSpace: 'action', onNewSpace: 'action', onRenameSpace: 'action', onAddSticky: 'action', onJot: 'action', onShow: 'action' },
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
    const text = (t: unknown, what = 'text') => {
      const w = words(t)
      if (!w) throw new Error(`Give the ${what}.`)
      return w
    }
    return {
      switchSpace: (s: string) => call('onSwitchSpace')(space(s)),
      newSpace: (name: string) => call('onNewSpace')(text(name, 'name')),
      renameSpace: (s: string, name: string) => call('onRenameSpace')(space(s), text(name, 'new name')),
      addSticky: (t: string) => call('onAddSticky')(text(t, 'note')),
      jot: (t: string) => call('onJot')(text(t, 'thought')),
      show: (target: string) => call('onShow')(text(target, 'path or link')),
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['switchSpace', 'newSpace', 'renameSpace', 'addSticky', 'jot', 'show'] },
})
const { Root: BoardRoot } = createParts(boardPrimitive, { root: 'div' })

// ---- a card --------------------------------------------------------------------------------------------------

export type CardValue = {
  kind: string
  space: string
  selected?: boolean
  inView?: boolean
  folded?: boolean
  color?: string
  file?: string
  url?: string
  /** the first lines of what it shows */
  peek?: string
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
}
const COLORS: Record<string, StickyColor> = { yellow: 'yellow', green: 'green', pink: 'pink', orange: 'orange', charcoal: 'ink', ink: 'ink', dark: 'ink', black: 'ink' }

const cardPrimitive = definePrimitive({
  name: 'card',
  options: { value: 'value', spaces: 'value', onComment: 'action', onFold: 'action', onFocus: 'action', onMoveToSpace: 'action', onRename: 'action', onColor: 'action', onRemove: 'action' },
  state: (options: CardOptions) => ({ value: options.value ?? { kind: 'card', space: 'Main' } }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const v = () => context.store.get().value as CardValue
    const call = <K extends keyof CardOptions>(key: K) => {
      const fn = context.options()[key]
      if (typeof fn !== 'function') throw new Error(`A ${v().kind} card can't do that.`)
      return fn as Extract<NonNullable<CardOptions[K]>, (...a: never[]) => unknown>
    }
    return {
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
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['comment', 'fold', 'unfold', 'focus', 'moveToSpace', 'rename', 'setColor', 'remove'] },
})
const { Root: CardRoot } = createParts(cardPrimitive, { root: 'div' })

// ---- Later -------------------------------------------------------------------------------------------------

type LaterItem = { id: string; title: string; url?: string; state: string }
type LaterOptions = { value?: LaterItem[]; onAdd?: (t: string) => void; onSetState?: (id: string, state: string) => void; onRemove?: (id: string) => void }
const STATES: Record<string, string> = { check: 'todo', 'to check': 'todo', todo: 'todo', reading: 'reading', done: 'done' }

const laterPrimitive = definePrimitive({
  name: 'later-list',
  options: { value: 'value', onAdd: 'action', onSetState: 'action', onRemove: 'action' },
  state: (options: LaterOptions) => ({ value: options.value ?? [] }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const list = () => context.store.get().value as LaterItem[]
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
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['add', 'setState', 'remove'] },
})
const { Root: LaterRoot } = createParts(laterPrimitive, { root: 'div' })

// ---- Snippets ----------------------------------------------------------------------------------------------

type SnippetItem = { id: string; title: string; secret: boolean; text?: string }
type SnippetOptions = { value?: SnippetItem[]; onAdd?: (text: string, title: string) => void; onRemove?: (id: string) => void }

const snippetPrimitive = definePrimitive({
  name: 'snippet-list',
  options: { value: 'value', onAdd: 'action', onRemove: 'action' },
  state: (options: SnippetOptions) => ({ value: options.value ?? [] }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const list = () => context.store.get().value as SnippetItem[]
    const call = <K extends keyof SnippetOptions>(key: K) => context.options()[key] as NonNullable<SnippetOptions[K]>
    return {
      add: (text: string, title?: string) => {
        const t = String(text ?? '')
        if (!t.trim()) throw new Error('Give the text to keep.')
        call('onAdd')(t, words(title))
      },
      remove: (which: string) => call('onRemove')(pick(list(), which, x => x.id, x => x.title, 'snippet').id),
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['add', 'remove'] },
})
const { Root: SnippetRoot } = createParts(snippetPrimitive, { root: 'div' })

// ---- on the page -------------------------------------------------------------------------------------------

const KIND: Record<string, string> = { item: 'file or link', note: 'note', outputs: 'Claude outputs', tasks: 'today', tracker: 'tracker', command: 'command', later: 'later', snippets: 'snippets', folder: 'folder' }
type Row = [id: string, type: string, ref: string, space: string, folded: boolean, selected: boolean, inView: boolean, color: string]
type Built = { id: string; type: string; ref: string; title: string; value: CardValue }

export function BoardAgent() {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  // the cards, as a string, so this only redraws when one is added, taken off, moved, folded, selected, or comes into
  // or goes out of view
  const cardsKey = useStore(s => {
    const [tx, ty, z] = s.transform
    const view = { x0: -tx / z, y0: -ty / z, x1: (s.width - tx) / z, y1: (s.height - ty) / z }
    return JSON.stringify(
      s.nodes.map(n => {
        const d = n.data as CardNode['data']
        const w = n.measured?.width ?? n.width ?? 0
        const h = n.measured?.height ?? n.height ?? 0
        const seen = !n.hidden && n.position.x < view.x1 && n.position.x + w > view.x0 && n.position.y < view.y1 && n.position.y + h > view.y0
        return [n.id, n.type, d.ref, spaceOf(n as CardNode), !!d.folded, !!n.selected, seen, d.color || ''] as Row
      }),
    )
  })
  const snippets = useData(() => get<Snippet[]>('/api/snippets'), [], { refreshOn: ['snippets'] })
  const notes = board.notes
  const sep = notes?.root.includes('\\') ? '\\' : '/'
  const spaceName = (id: string) => board.spaces.find(s => s.id === id)?.name ?? 'Main'
  const spaceId = (name: string) => board.spaces.find(s => s.name === name)?.id ?? 'main'
  const said = (t: string) => board.toast(t)

  const cards: Built[] = useMemo(() => {
    const spaceOfId = (id: string) => board.spaces.find(s => s.id === id)?.name ?? 'Main'
    return (JSON.parse(cardsKey) as Row[]).map(([id, type, ref, space, folded, selected, inView, color]) => {
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
        title = /^journal\//.test(ref) ? `Journal ${ref.slice(8, 18)}` : n?.title || n?.excerpt?.split('\n')[0] || 'Sticky note'
        if (notes) file = notes.root + sep + ref.split('/').join(sep)
        peek = n?.excerpt
      } else if (type === 'folder') {
        title = ref.split(/[\\/]/).filter(Boolean).pop() || ref
        file = ref
      } else if (type === 'outputs') {
        const g = board.outputs.find(x => x.id === ref)
        title = g ? `Claude: ${summary(g)}` : 'Claude outputs'
        if (g) peek = g.items.map(i => `${i.kind}: ${i.label}`).join('\n')
      } else if (type === 'tracker') title = `Tracker: ${ref}`
      // the lists themselves are "Today's tasks", "Later" and "Snippets": their cards are named apart
      else if (type === 'tasks') title = 'Today card'
      else if (type === 'later') title = 'Later card'
      else if (type === 'snippets') title = 'Snippets card'
      const thread = board.comments[id]
      const sticky = isSticky(type, ref)
      const value: CardValue = {
        kind: sticky ? 'sticky note' : KIND[type] ?? type,
        space: spaceOfId(space),
        ...(selected ? { selected: true } : {}),
        ...(inView ? { inView: true } : {}),
        ...(folded ? { folded: true } : {}),
        ...(sticky ? { color: color === 'ink' || !color ? 'charcoal' : color } : {}),
        ...(file ? { file } : {}),
        ...(url ? { url } : {}),
        ...(peek ? { peek: peek.length > PEEK ? `${peek.slice(0, PEEK)}…` : peek } : {}),
        ...(thread?.length ? { comments: thread.slice(-10).map(c => ({ by: c.by, text: c.text })) } : {}),
      }
      return { id, type, ref, title, value }
    })
  }, [cardsKey, board.spaces, board.space, board.items, board.outputs, board.comments, notes, sep])

  const boardValue: BoardValue = useMemo(
    () => ({
      space: spaceName(board.space),
      spaces: board.spaces.map(s => ({ name: s.name, cards: cards.filter(c => c.value.space === s.name).length })),
      selected: cards.filter(c => c.value.selected).map(c => c.title),
      inView: cards.filter(c => c.value.inView).map(c => c.title),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, board.spaces, board.space],
  )
  const spaceNames = useMemo(() => board.spaces.map(s => s.name), [board.spaces])

  const later: LaterItem[] = useMemo(
    () => board.items.filter(e => e.later).map(e => ({ id: e.id, title: e.title, ...(e.url ? { url: e.url } : {}), state: e.later === 'todo' ? 'to check' : e.later! })),
    [board.items],
  )
  const snippetList: SnippetItem[] = useMemo(
    () => (snippets.data || []).map(s => ({ id: s.id, title: s.title, secret: s.secret, ...(s.secret ? {} : { text: s.preview }) })),
    [snippets.data],
  )

  const fold = (id: string, f: boolean) => {
    board.remember()
    rf.setNodes(ns => ns.map(n => (n.id === id ? foldNode(n, f) : n)))
    board.persist()
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
        onAddSticky={t => board.newSticky(t)}
        onJot={t => post('/api/notes/thought', { text: t }).then(() => said("Claude added to today's journal"), (e: Error) => said(e.message))}
        onShow={t => (/^https?:\/\//i.test(t) ? board.showItem({ url: t }) : board.showItem({ path: t }))}
      />
      {cards.map(c => (
        <Fragment key={c.id}>
          <CardRoot
            aria-label={c.title}
            className="sr-only"
            value={c.value}
            spaces={spaceNames}
            onComment={t => {
              board.addComment(c.id, t, 'Claude').catch(() => {})
              said(`Claude commented on ${c.title}`)
            }}
            onFold={f => fold(c.id, f)}
            onFocus={() => focus(c.id)}
            onMoveToSpace={s => board.moveToSpace([c.id], spaceId(s))}
            onRename={
              c.type === 'note'
                ? t =>
                    post('/api/notes/title', { path: c.ref, title: t }).then(
                      () => said(t ? `Claude named the note "${t}"` : "Claude took the note's title off"),
                      (e: Error) => said(e.message),
                    )
                : undefined
            }
            onColor={c.value.kind === 'sticky note' ? color => board.setColor(c.id, color) : undefined}
            onRemove={() => board.removeCard(c.id)}
          />
        </Fragment>
      ))}
      <LaterRoot
        aria-label="Later"
        className="sr-only"
        value={later}
        onAdd={t => board.saveLater(/^https?:\/\//i.test(t) ? { url: t } : { text: t })}
        onSetState={(id, s) => board.setLater(id, s as 'todo' | 'reading' | 'done')}
        onRemove={id => board.setLater(id, null)}
      />
      <SnippetRoot
        aria-label="Snippets"
        className="sr-only"
        value={snippetList}
        onAdd={(text, title) =>
          post('/api/snippets', { text, ...(title ? { title } : {}) }).then(() => (snippets.reload(), said('Claude left a snippet')), (e: Error) => said(e.message))
        }
        onRemove={id => post(`/api/snippets/${id}/remove`).then(() => snippets.reload(), (e: Error) => said(e.message))}
      />
    </>
  )
}
