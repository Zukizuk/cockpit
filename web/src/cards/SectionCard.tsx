// A section: an area on the board with a title, behind the cards. The cards whose middle is in it are in it: drop a
// card in and it's there, drag it out and it isn't. Drag the section by its title and what's in it comes along (see
// the board's drag in App). Inside, it's still the board: drag to select, paste, and a right-click there gives the
// section's menu with the board's "here" items under it (App). The section's menu (SectionMenuItems), on its title,
// its folded bar and inside it: colour, rename, fold, tuck, fit to what's in it, select what's in it, lock, move to
// another space, and take it off (what's in it stays, or goes too).
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { emit, onEvent } from '../lib'
import { NodeResizer, useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import { ArrowUpToLine, Package, BoxSelect, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Heading, Layers, Lock, LockOpen, Shrink, Trash2, X } from 'lucide-react'
import { track, type StickyColor } from '../api'
import { contentsOf, heldBy, useBoard, type CardNode } from '../board'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { STICKY_COLORS } from './CardShell'
import { TitleInput } from './NoteCard'
import { askPutAway } from '../views/Shelf'
import { cn } from '@/lib/utils'

/** How many cards are in a section, held ones too (for the menu's words and the folded bar). */
export const useSectionCount = (id: string) =>
  useStore(s => {
    const me = s.nodeLookup.get(id) as unknown as CardNode | undefined
    const all = [...s.nodeLookup.values()] as unknown as CardNode[]
    return me ? contentsOf(me, all).length + heldBy(id, all).filter(n => n.data.inside === id).length : 0
  })

type ItemProps = { children?: ReactNode; onSelect?: () => void; disabled?: boolean; variant?: 'default' | 'destructive'; className?: string; title?: string; 'aria-label'?: string }

/**
 * A section's menu items, in a context menu (its title, its folded bar) or a dropdown (a right-click inside it, on the
 * board): pass that menu's Item and Separator.
 */
export function SectionMenuItems({ id, Item, Separator }: { id: string; Item: ComponentType<ItemProps>; Separator: ComponentType }) {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  const count = useSectionCount(id)
  const data = useStore(s => (s.nodeLookup.get(id) as unknown as CardNode | undefined)?.data)
  if (!data) return null
  const locked = !!data.locked
  const folded = !!data.folded
  const inside = () => board.sectionCards(id)
  const fold = (f: boolean) => board.foldSection(id, f)
  const fit = () => void (board.fitSection(id) || board.toast('Nothing in it yet: drop cards in it'))
  const setColor = (color: StickyColor | null) => {
    rf.setNodes(ns =>
      ns.map(n => {
        if (n.id !== id) return n
        const { color: _was, ...rest } = n.data
        return { ...n, data: color ? { ...rest, color } : rest }
      }),
    )
    board.persist()
  }
  const these = count === 1 ? 'the card in it' : `the ${count} cards in it`
  return (
    <>
      <div className="sticky-swatches" role="group" aria-label="Colour">
        <Item aria-label="No colour" title="No colour" className={cn('sticky-swatch section-swatch-none', !data.color && 'is-on')} onSelect={() => setColor(null)} />
        {STICKY_COLORS.map(c => (
          <Item key={c.value} aria-label={c.label} title={c.label} className={cn('sticky-swatch', `paper-${c.value}`, data.color === c.value && 'is-on')} onSelect={() => setColor(c.value)} />
        ))}
      </div>
      <Separator />
      {/* (once the menu has closed: it would take the focus back from the title box) */}
      <Item onSelect={() => setTimeout(() => emit('note-rename', { id }), 60)}>
        <Heading strokeWidth={1.75} />
        {data.title ? 'Rename' : 'Give it a title'}
      </Item>
      <Item onSelect={() => fold(!folded)}>
        {folded ? <ChevronsUpDown strokeWidth={1.75} /> : <ChevronsDownUp strokeWidth={1.75} />}
        {folded ? 'Open it' : 'Fold it to its bar'}
      </Item>
      <Item onSelect={() => board.tuck([id])}>
        <ArrowUpToLine strokeWidth={1.75} />
        {count ? "Tuck it away at the top, with what's in it" : 'Tuck it away at the top'}
      </Item>
      <Item onSelect={() => askPutAway([id])}>
        <Package strokeWidth={1.75} />
        {count ? "Put it away on the shelf, with what's in it…" : 'Put it away on the shelf…'}
      </Item>
      <Separator />
      <Item onSelect={fit} disabled={!count || folded}>
        <Shrink strokeWidth={1.75} />
        Fit it to what's in it
      </Item>
      <Item
        onSelect={() => {
          const ids = new Set(inside().map(n => n.id))
          // once the menu has closed (closing, it hands the title the focus, which picked the section again)
          setTimeout(() => rf.setNodes(ns => ns.map(n => ({ ...n, selected: ids.has(n.id) }))), 120)
        }}
        disabled={!count || folded}
      >
        <BoxSelect strokeWidth={1.75} />
        Select what's in it
      </Item>
      <Separator />
      <Item onSelect={() => board.setLocked([id], !locked)}>
        {locked ? <LockOpen strokeWidth={1.75} /> : <Lock strokeWidth={1.75} />}
        {locked ? 'Unlock' : 'Lock in place'}
      </Item>
      {board.spaces
        .filter(x => x.id !== board.space)
        .slice(0, 8)
        .map(x => (
          <Item key={x.id} onSelect={() => board.moveToSpace([id, ...inside().filter(n => !n.data.inside).map(n => n.id)], x.id)}>
            <Layers strokeWidth={1.75} />
            Move to {x.name}, with what's in it
          </Item>
        ))}
      <Separator />
      <Item
        onSelect={() => {
          track('section.remove')
          if (locked) return board.toast('Unlock it first')
          board.removeCards([id])
        }}
      >
        <X strokeWidth={1.75} />
        Remove the section{count ? ' (its cards stay)' : ''}
      </Item>
      {count > 0 && (
        <Item variant="destructive" onSelect={() => (locked ? board.toast('Unlock it first') : board.removeCards([id, ...inside().map(n => n.id)]))}>
          <Trash2 strokeWidth={1.75} />
          Remove it and {these}
        </Item>
      )}
    </>
  )
}

export function SectionCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  // a section just made, with no title yet, opens with its title ready to type
  const [naming, setNaming] = useState(() => !!data.born && Date.now() - data.born < 2500 && !data.title)
  // F2 on the board, with it selected; Rename in its menu
  useEffect(() => onEvent('note-rename', (d: { id?: string }) => d.id === id && setNaming(true)), [id])
  // a card dragged over it, from outside: it lights up (let go, the card joins it)
  const [dropTarget, setDropTarget] = useState(false)
  useEffect(() => onEvent('section-drop', (d: { id?: string | null }) => setDropTarget(d.id === id)), [id])
  const locked = !!data.locked
  // folded: just a bar under its title, what's in it held out of sight where it was
  const folded = !!data.folded
  const count = useSectionCount(id)
  const fold = (f: boolean) => board.foldSection(id, f)
  // zoomed out, its title stays readable (up to 2.5 times bigger on the board), as a map keeps its place names
  const titleScale = useStore(s => Math.min(2.5, Math.max(1, 1 / s.transform[2])))
  const name = data.title || 'Section'
  const menu = (
    <ContextMenuContent className="min-w-64" aria-label="Section">
      <SectionMenuItems id={id} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
    </ContextMenuContent>
  )

  return (
    <>
      {!locked && !folded && (
        <NodeResizer
          minWidth={240}
          minHeight={160}
          isVisible={!!selected}
          lineClassName="rz-line"
          handleClassName="rz-handle"
          onResizeStart={() => board.remember()}
          onResizeEnd={() => board.persist()}
        />
      )}
      <div className={cn('section', data.color && `section-tint paper-${data.color}`, selected && 'is-selected', locked && 'is-locked', folded && 'is-folded', dropTarget && 'is-drop')}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn('section-title card-drag', !data.title && 'is-empty')}
              style={{ scale: titleScale }}
              title={locked ? 'Locked in place. Double-click to rename' : 'Drag to move it and what is in it. Double-click to rename'}
              onDoubleClick={() => setNaming(true)}
            >
              {locked && <Lock className="size-3 shrink-0" strokeWidth={2} />}
              {naming ? (
                <TitleInput
                  value={data.title || ''}
                  onDone={v => {
                    setNaming(false)
                    if (v !== null && v.trim() !== (data.title || '')) board.setSectionTitle(id, v)
                  }}
                />
              ) : (
                <span className="truncate">{name}</span>
              )}
              {/* at the end, out of the way of a grab at the title */}
              {!naming && (
                <button
                  type="button"
                  className="section-fold nodrag"
                  aria-label={folded ? 'Open the section' : 'Fold the section to its bar'}
                  title={folded ? 'Open it' : 'Fold it to its bar'}
                  onPointerDown={e => e.stopPropagation()}
                  onDoubleClick={e => e.stopPropagation()}
                  onClick={() => fold(!folded)}
                >
                  {folded ? <ChevronRight className="size-3.5" strokeWidth={2} /> : <ChevronDown className="size-3.5" strokeWidth={2} />}
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          {menu}
        </ContextMenu>
        {folded && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button type="button" className="section-bar nodrag" onClick={() => fold(false)} title="Open it">
                <span className="truncate">{count === 0 ? 'Nothing in it' : count === 1 ? '1 card in it' : `${count} cards in it`}</span>
                <span className="section-bar-open">Open</span>
              </button>
            </ContextMenuTrigger>
            {menu}
          </ContextMenu>
        )}
      </div>
    </>
  )
}
