// The rest of the board as UI SDK components, so an agent (Claude Code, through Cockpit's board tools) can read it and
// use it: the board itself (spaces, the cards on it, their comments), Later, and Snippets. Nothing here draws anything;
// each is an invisible component whose value is the data and whose actions do what a click would.
// Notes are files: their paths are in the board's value, so an agent reads and edits them where they are, and the
// board follows. Removing anything waits for the person (the bridge's allow). Experimental (spike/ui-sdk-today).
import { useMemo } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { definePrimitive } from '@ui-sdk/core'
import { createParts } from '@ui-sdk/react/primitive'
import { foldNode, spaceOf, useBoard, type CardNode } from '../board'
import { get, post, type Snippet } from '../api'
import { useData } from '../lib'
import { summary } from '../cards/OutputsCard'

const words = (s: unknown) => String(s ?? '').trim()

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

export type AgentCard = { card: string; kind: string; title: string; space: string; folded?: boolean; file?: string; url?: string; comments?: { by: string; text: string }[] }
type BoardValue = { space: string; spaces: string[]; cards: AgentCard[] }
type BoardOptions = {
  value?: BoardValue
  onSwitchSpace?: (space: string) => void
  onNewSpace?: (name: string) => void
  onRenameSpace?: (space: string, name: string) => void
  onMoveToSpace?: (card: string, space: string) => void
  onComment?: (card: string, text: string) => void
  onAddSticky?: (text: string) => void
  onJot?: (text: string) => void
  onShow?: (target: string) => void
  onFold?: (card: string, fold: boolean) => void
  onFocus?: (card: string) => void
  onRemove?: (card: string) => void
}

const boardPrimitive = definePrimitive({
  name: 'board',
  options: {
    value: 'value',
    onSwitchSpace: 'action',
    onNewSpace: 'action',
    onRenameSpace: 'action',
    onMoveToSpace: 'action',
    onComment: 'action',
    onAddSticky: 'action',
    onJot: 'action',
    onShow: 'action',
    onFold: 'action',
    onFocus: 'action',
    onRemove: 'action',
  },
  state: (options: BoardOptions) => ({ value: options.value ?? { space: 'Main', spaces: ['Main'], cards: [] } }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const v = () => context.store.get().value as BoardValue
    const call = <K extends keyof BoardOptions>(key: K) => {
      const fn = context.options()[key]
      if (typeof fn !== 'function') throw new Error('The board cannot do that here.')
      return fn as NonNullable<BoardOptions[K]>
    }
    const card = (which: string) => pick(v().cards, which, c => c.card, c => c.title, 'card').card
    const space = (which: string) => pick(v().spaces, which, s => s, s => s, 'space')
    const text = (t: unknown, what = 'text') => {
      const w = words(t)
      if (!w) throw new Error(`Give the ${what}.`)
      return w
    }
    return {
      switchSpace: (s: string) => call('onSwitchSpace')(space(s)),
      newSpace: (name: string) => call('onNewSpace')(text(name, 'name')),
      renameSpace: (s: string, name: string) => call('onRenameSpace')(space(s), text(name, 'new name')),
      moveToSpace: (c: string, s: string) => call('onMoveToSpace')(card(c), space(s)),
      comment: (c: string, t: string) => call('onComment')(card(c), text(t, 'comment')),
      addSticky: (t: string) => call('onAddSticky')(text(t, 'note')),
      jot: (t: string) => call('onJot')(text(t, 'thought')),
      show: (target: string) => call('onShow')(text(target, 'path or link')),
      fold: (c: string) => call('onFold')(card(c), true),
      unfold: (c: string) => call('onFold')(card(c), false),
      focus: (c: string) => call('onFocus')(card(c)),
      remove: (c: string) => call('onRemove')(card(c)),
    }
  },
  slots: slot => ({ root: slot({ attrs: () => ({ role: 'group' }) }) }),
  agent: { actions: ['switchSpace', 'newSpace', 'renameSpace', 'moveToSpace', 'comment', 'addSticky', 'jot', 'show', 'fold', 'unfold', 'focus', 'remove'] },
})
const { Root: BoardRoot } = createParts(boardPrimitive, { root: 'div' })

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

export function BoardAgent() {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  // the cards, as a string, so this only redraws when one is added, taken off, moved to a space or folded
  const cardsKey = useStore(s =>
    JSON.stringify(s.nodes.map(n => [n.id, n.type, (n.data as CardNode['data']).ref, spaceOf(n as CardNode), !!(n.data as CardNode['data']).folded])),
  )
  const snippets = useData(() => get<Snippet[]>('/api/snippets'), [], { refreshOn: ['snippets'] })
  const notes = board.notes
  const sep = notes?.root.includes('\\') ? '\\' : '/'

  const value: BoardValue = useMemo(() => {
    const spaceName = (id: string) => board.spaces.find(s => s.id === id)?.name ?? 'Main'
    const cards = (JSON.parse(cardsKey) as [string, string, string, string, boolean][]).map(([id, type, ref, space, folded]): AgentCard => {
      let title = KIND[type] ?? type
      let file: string | undefined
      let url: string | undefined
      if (type === 'item') {
        const e = board.items.find(x => x.id === ref)
        title = e?.title || 'File'
        if (e?.url) url = e.url
        else if (e?.path && e.kind === 'file') file = e.path
      } else if (type === 'note') {
        const n = notes?.notes.find(x => x.path === ref)
        title = /^journal\//.test(ref) ? `Journal ${ref.slice(8, 18)}` : n?.title || n?.excerpt?.split('\n')[0] || 'Sticky note'
        if (notes) file = notes.root + sep + ref.split('/').join(sep)
      } else if (type === 'folder') {
        title = ref.split(/[\\/]/).filter(Boolean).pop() || ref
        file = ref
      } else if (type === 'outputs') {
        const g = board.outputs.find(x => x.id === ref)
        title = g ? `Claude: ${summary(g)}` : 'Claude outputs'
      } else if (type === 'tracker') title = `Tracker: ${ref}`
      else if (type === 'tasks') title = 'Today'
      else if (type === 'later') title = 'Later'
      else if (type === 'snippets') title = 'Snippets'
      const thread = board.comments[id]
      return {
        card: id,
        kind: KIND[type] ?? type,
        title,
        space: spaceName(space),
        ...(folded ? { folded: true } : {}),
        ...(file ? { file } : {}),
        ...(url ? { url } : {}),
        ...(thread?.length ? { comments: thread.slice(-10).map(c => ({ by: c.by, text: c.text })) } : {}),
      }
    })
    return { space: spaceName(board.space), spaces: board.spaces.map(s => s.name), cards }
  }, [cardsKey, board.spaces, board.space, board.items, board.outputs, board.comments, notes, sep])

  const spaceId = (name: string) => board.spaces.find(s => s.name === name)?.id ?? 'main'
  const said = (t: string) => board.toast(t)
  const titleOf = (card: string) => value.cards.find(c => c.card === card)?.title ?? 'a card'

  const later: LaterItem[] = useMemo(
    () => board.items.filter(e => e.later).map(e => ({ id: e.id, title: e.title, ...(e.url ? { url: e.url } : {}), state: e.later === 'todo' ? 'to check' : e.later! })),
    [board.items],
  )
  const snippetList: SnippetItem[] = useMemo(
    () => (snippets.data || []).map(s => ({ id: s.id, title: s.title, secret: s.secret, ...(s.secret ? {} : { text: s.preview }) })),
    [snippets.data],
  )

  return (
    <>
      <BoardRoot
        aria-label="Board"
        className="sr-only"
        value={value}
        onSwitchSpace={s => board.switchSpace(spaceId(s))}
        onNewSpace={name => {
          board.newSpace(name)
          said(`Claude made the space "${name}"`)
        }}
        onRenameSpace={(s, name) => board.renameSpace(spaceId(s), name)}
        onMoveToSpace={(card, s) => board.moveToSpace([card], spaceId(s))}
        onComment={(card, t) => {
          board.addComment(card, t, 'Claude').catch(() => {})
          said(`Claude commented on ${titleOf(card)}`)
        }}
        onAddSticky={t => board.newSticky(t)}
        onJot={t => post('/api/notes/thought', { text: t }).then(() => said("Claude added to today's journal"), (e: Error) => said(e.message))}
        onShow={t => (/^https?:\/\//i.test(t) ? board.showItem({ url: t }) : board.showItem({ path: t }))}
        onFold={(card, fold) => {
          board.remember()
          rf.setNodes(ns => ns.map(n => (n.id === card ? foldNode(n, fold) : n)))
          board.persist()
        }}
        onFocus={card => {
          const n = rf.getNode(card)
          if (!n) return
          if (spaceOf(n) !== board.space) board.switchSpace(spaceOf(n))
          setTimeout(() => rf.fitView({ nodes: [{ id: card }], duration: 320, padding: 0.25, maxZoom: 1 }), 80)
        }}
        onRemove={card => board.removeCard(card)}
      />
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
