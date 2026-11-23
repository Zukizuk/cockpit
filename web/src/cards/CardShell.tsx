// The frame every card on the board shares: a header to drag it by (double-click to expand), a body that scrolls
// and selects text without moving the card, resize handles, and the same actions on right-click and in "⋯".
// A sticky note gets a paper frame instead: a slim strip to drag it by, the rest is writing.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { NodeResizer, useNodeId, useNodesData, useReactFlow, useStore } from '@xyflow/react'
import { ChevronsDownUp, ChevronsUpDown, Focus, Lock, LockOpen, MoreHorizontal, Shrink, type LucideIcon, Layers, MessageSquare, Eye, EyeOff, ArrowUpToLine } from 'lucide-react'
import type { CardType, StickyColor } from '../api'
import { foldNode, minSize, resizingRef, useBoard, type CardNode } from '../board'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { CardComments } from './CardComments'
import { emit } from '../lib'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type CardAction = { label: string; icon: LucideIcon; run: () => void; danger?: boolean; gap?: boolean; hidden?: boolean; keys?: string; /** only in the right-click menu (about what was right-clicked) */ context?: boolean }

export function IconButton({ icon: Icon, label, onClick, active, className }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={e => {
            e.stopPropagation()
            onClick()
          }}
          className={cn(
            'icon-btn grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-(--ease-out) hover:bg-ink/[0.07] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]',
            active && 'bg-ink/10 text-foreground',
            className,
          )}
        >
          <Icon className="size-[15px]" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The papers a sticky note comes in (no blue or purple). */
export const STICKY_COLORS: { value: StickyColor; label: string }[] = [
  { value: 'yellow', label: 'Yellow' },
  { value: 'orange', label: 'Peach' },
  { value: 'pink', label: 'Pink' },
  { value: 'green', label: 'Mint' },
  { value: 'ink', label: 'Charcoal' },
]

interface Props {
  selected: boolean
  pulse?: number
  /** When the card was added: a card added just now eases in (not on page load). */
  born?: number
  icon: LucideIcon
  title: ReactNode
  subtitle?: ReactNode
  quick?: ReactNode
  actions: CardAction[]
  onExpand?: () => void
  bodyClassName?: string
  /** As tall as its content (up to a limit, then it scrolls), until a height is dragged by hand. */
  autoHeight?: boolean
  /** Exactly the size of its content, both ways (a table): no resize handles. */
  hug?: boolean
  /** No card around it: the content is the thing on the board, with a small label above it to drag it by (a table). */
  bare?: boolean
  /** Right-click on the card, before its menu opens (to say what was right-clicked). */
  onContext?: (e: React.MouseEvent) => void
  /** A sticky note: paper in this colour, a slim strip instead of a header. */
  sticky?: StickyColor
  /** Shown in the sticky strip (only when something needs saying, like "Not saved"). */
  stripText?: ReactNode
  children: ReactNode
}

export function CardShell({ selected, pulse, born, icon: Icon, title, subtitle, quick, actions, onExpand, bodyClassName, autoHeight, hug, bare, onContext, sticky, stripText, children }: Props) {
  const nodeId = useNodeId()
  const rf = useReactFlow<CardNode>()
  const board = useBoard()
  const node = useNodesData<CardNode>(nodeId || '')
  const folded = !!node?.data.folded
  const locked = !!node?.data.locked
  const veiled = !!node?.data.veiled
  // several cards picked (a drag on the board): their outline says so; resize corners only for one
  const manyPicked = useStore(s => s.nodes.reduce((k, n) => k + (n.selected ? 1 : 0), 0) > 1)
  const toggleVeil = () => nodeId && board.setVeiled([nodeId], !veiled)
  const min = minSize((node?.type || 'item') as CardType, node?.data.ref || '')
  // fits its content now (Snippets, until a height is dragged by hand)
  const fits = !!autoHeight && !node?.data.sized
  const startH = useRef(0)
  const setSized = (sized: boolean) =>
    rf.setNodes(ns =>
      ns.map(n => {
        if (n.id !== nodeId) return n
        const { sized: _was, ...data } = n.data
        return sized ? { ...n, height: n.height ?? n.measured?.height, data: { ...data, sized: true } } : { ...n, height: undefined, data }
      }),
    )
  // a card that fits its content keeps the height it's dragged to; a drag that only changed the width leaves it
  // fitting its content
  // Only a drag that really changed the height fixes it (a click on a handle, or a drag that only changed the width,
  // used to leave the card stuck at the height it had then, cutting it off as soon as it held more).
  const resizeStart = () => {
    board.remember()
    if (!fits) return
    resizingRef.current = true
    startH.current = (nodeId && rf.getNode(nodeId)?.measured?.height) || 0
    // a press on a handle that never becomes a drag gets no resize end: let go of it here
    addEventListener('pointerup', () => setTimeout(() => (resizingRef.current = false), 50), { once: true })
  }
  const resizeEnd = (_e: unknown, p: { height: number }) => {
    if (!resizingRef.current) return board.persist()
    resizingRef.current = false
    if (Math.abs(p.height - startH.current) >= 4) setSized(true)
    else rf.setNodes(ns => ns.map(n => (n.id === nodeId ? { ...n, height: undefined } : n)))
    board.persist()
  }
  const toggleFold = () => {
    board.remember()
    rf.setNodes(ns => ns.map(n => (n.id === nodeId ? foldNode(n, !folded) : n)))
    board.persist()
  }
  const toggleLock = () => nodeId && board.setLocked([nodeId], !locked)
  // what was right-clicked comes first; then the card's own
  const here = actions.filter(a => a.context && !a.hidden)
  const shown: CardAction[] = [
    ...here,
    { label: folded ? 'Unfold' : 'Fold to its title', icon: folded ? ChevronsUpDown : ChevronsDownUp, run: toggleFold, hidden: !!sticky, keys: 'F', gap: here.length > 0 },
    { label: board.focusing ? 'Bring everything back' : manyPicked && selected ? 'Focus on these cards' : 'Focus on this card', icon: Focus, run: () => board.toggleFocus(nodeId || undefined) },
    { label: locked ? 'Unlock' : 'Lock in place', icon: locked ? LockOpen : Lock, run: toggleLock, keys: 'Ctrl+Shift+L' },
    { label: 'Comment', icon: MessageSquare, run: () => setTimeout(() => emit('comments-open', { id: nodeId }), 60) },
    { label: veiled ? 'Show its contents' : 'Hide its contents', icon: veiled ? Eye : EyeOff, run: toggleVeil, keys: 'H' },
    { label: 'Tuck away at the top', icon: ArrowUpToLine, run: () => nodeId && board.tuck([nodeId]) },
    {
      label: 'Fit to contents',
      icon: Shrink,
      run: () => {
        board.remember()
        setSized(false)
        board.persist()
      },
      hidden: !autoHeight || fits || folded,
    },
    // other spaces: out of view here, there when you go to that space
    ...board.spaces
      .filter(x => x.id !== board.space)
      .slice(0, 8)
      .map((x, i): CardAction => ({ label: `Move to ${x.name}`, icon: Layers, run: () => void (nodeId && board.moveToSpace([nodeId], x.id)), gap: i === 0 })),
    {
      label: 'Move to a new space',
      icon: Layers,
      run: () => {
        if (!nodeId) return
        const here = board.space
        const to = board.newSpace()
        board.moveToSpace([nodeId], to)
        board.toast('Moved to a new space', { label: 'Go back', run: () => board.switchSpace(here) })
      },
      gap: board.spaces.length <= 1,
    },
    ...actions.filter(a => !a.context),
  ].filter(a => !a.hidden)
  const [flash, setFlash] = useState(false)
  const [isNew] = useState(() => !!born && Date.now() - born < 1500)
  useEffect(() => {
    if (!pulse || Date.now() - pulse > 1500) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 900)
    return () => clearTimeout(t)
  }, [pulse])

  const items = (
    Item: typeof ContextMenuItem | typeof DropdownMenuItem,
    Sep: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
    Keys: typeof ContextMenuShortcut | typeof DropdownMenuShortcut,
    context = false,
  ) => (
    <>
      {sticky && (
        <>
          <div className="sticky-swatches" role="group" aria-label="Colour">
            {STICKY_COLORS.map(c => (
              <Item
                key={c.value}
                aria-label={c.label}
                title={c.label}
                className={cn('sticky-swatch', `paper-${c.value}`, sticky === c.value && 'is-on')}
                onSelect={() => nodeId && board.setColor(nodeId, c.value)}
              />
            ))}
          </div>
          <Sep />
        </>
      )}
      {shown.filter(a => context || !a.context).map(a => (
        <Fragment key={a.label}>
          {a.gap && <Sep />}
          <Item variant={a.danger ? 'destructive' : 'default'} onSelect={() => a.run()}>
            <a.icon strokeWidth={1.75} />
            {a.label}
            {a.keys && <Keys>{a.keys}</Keys>}
          </Item>
        </Fragment>
      ))}
    </>
  )

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More"
          className="icon-btn grid size-7 place-items-center rounded-md text-muted-foreground transition-[background-color,color] duration-150 hover:bg-ink/[0.07] hover:text-foreground"
        >
          <MoreHorizontal className="size-4" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items(DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const lockBadge = locked && <IconButton icon={Lock} label="Locked in place. Click to unlock" onClick={toggleLock} className="lock-badge" />

  return (
    <>
      {/* the comments hang off the card's top-right corner, outside it */}
      {nodeId && <CardComments nodeId={nodeId} />}
      {locked || hug ? null : (
        <NodeResizer
          minWidth={min.w}
          minHeight={min.h}
          isVisible={selected && !folded && !manyPicked}
          lineClassName="rz-line"
          handleClassName="rz-handle"
          onResizeStart={resizeStart}
          onResizeEnd={resizeEnd}
        />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onContextMenuCapture={onContext}
            className={cn(
              'card',
              selected && 'is-selected',
              flash && 'is-flash',
              isNew && 'is-new',
              folded && 'is-folded',
              fits && 'is-auto',
              hug && 'is-hug',
              bare && 'is-bare',
              locked && 'is-locked',
              sticky && `is-sticky paper-${sticky}`,
              veiled && 'is-veiled',
            )}
          >
            {bare ? (
              <header className="card-head bare-label card-drag" onDoubleClick={folded ? toggleFold : undefined} title={folded ? 'Double-click to unfold' : 'Drag to move'}>
                <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                <div className="bare-title min-w-0">{title}</div>
                <div className="card-actions nodrag flex items-center">
                  <IconButton icon={veiled ? Eye : EyeOff} label={veiled ? 'Show its contents' : 'Hide its contents (H)'} onClick={toggleVeil} className={cn('veil-btn', veiled && 'veil-on')} />
                  {lockBadge}
                  {menu}
                </div>
              </header>
            ) : sticky ? (
              <header className="card-head sticky-strip card-drag" onDoubleClick={onExpand} title={onExpand ? 'Double-click to open full screen' : undefined}>
                <span className="sticky-strip-text">{stripText}</span>
                <div className="card-actions nodrag flex items-center gap-0.5">
                  <IconButton icon={veiled ? Eye : EyeOff} label={veiled ? 'Show its contents' : 'Hide its contents (H)'} onClick={toggleVeil} className={cn('veil-btn', veiled && 'veil-on')} />
                  {quick}
                  {lockBadge}
                  {menu}
                </div>
              </header>
            ) : (
              <header
                className="card-head card-drag"
                onDoubleClick={folded ? toggleFold : onExpand}
                title={folded ? 'Double-click to unfold' : onExpand ? 'Double-click to open full screen' : undefined}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13.5px] font-medium">{title}</div>
                  {subtitle && <div className="truncate text-[11.5px] text-muted-foreground">{subtitle}</div>}
                </div>
                <div className="card-actions nodrag flex items-center gap-0.5">
                  {!folded && quick}
                  <IconButton icon={veiled ? Eye : EyeOff} label={veiled ? 'Show its contents' : 'Hide its contents (H)'} onClick={toggleVeil} className={cn('veil-btn', veiled && 'veil-on')} />
                  {lockBadge}
                  <IconButton icon={folded ? ChevronsUpDown : ChevronsDownUp} label={folded ? 'Unfold' : 'Fold to its title'} onClick={toggleFold} />
                  {menu}
                </div>
              </header>
            )}
            {/* kept mounted while folded: a running command or a half-written note carries on */}
            <div className={cn('card-body nodrag nowheel nopan nokey', bodyClassName)} hidden={folded}>
              {children}
            </div>
            {/* contents hidden (sharing the screen): a click shows them again */}
            {veiled && !folded && (
              <button type="button" className="veil nodrag" onClick={toggleVeil} aria-label="Hidden. Click to show">
                <EyeOff className="size-4" strokeWidth={1.75} />
                <span>Hidden</span>
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">{items(ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, true)}</ContextMenuContent>
      </ContextMenu>
    </>
  )
}
