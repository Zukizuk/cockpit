// A section: an area on the board with a title, behind the cards. The cards whose middle is in it are in it: drop a
// card in and it's there, drag it out and it isn't. Drag the section by its title and what's in it comes along (see
// the board's drag in App). Inside, it's still the board: drag to select, right-click for the board's menu, paste.
// Its own menu is on its title: rename, colour, fit to what's in it, select what's in it, lock, move to another space,
// and take it off (what's in it stays, or goes too).
import { useEffect, useState } from 'react'
import { onEvent } from '../lib'
import { NodeResizer, useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import { BoxSelect, Heading, Layers, Lock, LockOpen, Shrink, Trash2, X } from 'lucide-react'
import { track, type StickyColor } from '../api'
import { contentsOf, useBoard, type CardNode } from '../board'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { STICKY_COLORS } from './CardShell'
import { TitleInput } from './NoteCard'
import { cn } from '@/lib/utils'

export function SectionCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  // a section just made, with no title yet, opens with its title ready to type
  const [naming, setNaming] = useState(() => !!data.born && Date.now() - data.born < 2500 && !data.title)
  // F2 on the board, with it selected
  useEffect(() => onEvent('note-rename', (d: { id?: string }) => d.id === id && setNaming(true)), [id])
  const locked = !!data.locked
  // how many cards are in it (for the menu's words)
  const count = useStore(s => {
    const me = s.nodeLookup.get(id) as unknown as CardNode | undefined
    return me ? contentsOf(me, [...s.nodeLookup.values()] as unknown as CardNode[]).length : 0
  })
  const inside = () => {
    const me = rf.getNode(id)
    return me ? contentsOf(me, rf.getNodes()) : []
  }
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
  // zoomed out, its title stays readable (up to 2.5 times bigger on the board), as a map keeps its place names
  const titleScale = useStore(s => Math.min(2.5, Math.max(1, 1 / s.transform[2])))
  const name = data.title || 'Section'
  const these = count === 1 ? 'the card in it' : `the ${count} cards in it`

  return (
    <>
      {!locked && (
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
      <div className={cn('section', data.color && `section-tint paper-${data.color}`, selected && 'is-selected', locked && 'is-locked')}>
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
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-64" aria-label="Section">
            <div className="sticky-swatches" role="group" aria-label="Colour">
              <ContextMenuItem aria-label="No colour" title="No colour" className={cn('sticky-swatch section-swatch-none', !data.color && 'is-on')} onSelect={() => setColor(null)} />
              {STICKY_COLORS.map(c => (
                <ContextMenuItem
                  key={c.value}
                  aria-label={c.label}
                  title={c.label}
                  className={cn('sticky-swatch', `paper-${c.value}`, data.color === c.value && 'is-on')}
                  onSelect={() => setColor(c.value)}
                />
              ))}
            </div>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setTimeout(() => setNaming(true), 60)}>
              <Heading strokeWidth={1.75} />
              {data.title ? 'Rename' : 'Give it a title'}
            </ContextMenuItem>
            <ContextMenuItem onSelect={fit} disabled={!count}>
              <Shrink strokeWidth={1.75} />
              Fit it to what's in it
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                const ids = new Set(inside().map(n => n.id))
                rf.setNodes(ns => ns.map(n => ({ ...n, selected: ids.has(n.id) })))
              }}
              disabled={!count}
            >
              <BoxSelect strokeWidth={1.75} />
              Select what's in it
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => board.setLocked([id], !locked)}>
              {locked ? <LockOpen strokeWidth={1.75} /> : <Lock strokeWidth={1.75} />}
              {locked ? 'Unlock' : 'Lock in place'}
            </ContextMenuItem>
            {board.spaces
              .filter(x => x.id !== board.space)
              .slice(0, 8)
              .map(x => (
                <ContextMenuItem key={x.id} onSelect={() => board.moveToSpace([id, ...inside().map(n => n.id)], x.id)}>
                  <Layers strokeWidth={1.75} />
                  Move to {x.name}, with what's in it
                </ContextMenuItem>
              ))}
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                track('section.remove')
                if (locked) return board.toast('Unlock it first')
                board.removeCards([id])
              }}
            >
              <X strokeWidth={1.75} />
              Remove the section{count ? ' (its cards stay)' : ''}
            </ContextMenuItem>
            {count > 0 && (
              <ContextMenuItem variant="destructive" onSelect={() => (locked ? board.toast('Unlock it first') : board.removeCards([id, ...inside().map(n => n.id)]))}>
                <Trash2 strokeWidth={1.75} />
                Remove it and {these}
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </>
  )
}
