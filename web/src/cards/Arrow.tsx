// An arrow from one card to another. It leaves and reaches whichever sides of the two cards face each other, so it
// follows them as they move, in right-angle legs with rounded corners. Double-click it (or right-click: Add a label)
// to name it; right-click for dashes, heads, which way it points, and taking it off.
import { useEffect, useRef, useState } from 'react'
import { EdgeLabelRenderer, getSmoothStepPath, Position, useInternalNode, useStore, type EdgeProps, type InternalNode } from '@xyflow/react'
import type { Side } from '../api'
import { useBoard, type LinkData, type LinkEdge } from '../board'
import { onEvent } from '../lib'
import { cn } from '@/lib/utils'

const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

function box(n: InternalNode) {
  const { x, y } = n.internals.positionAbsolute
  const w = n.measured?.width ?? n.width ?? 0
  const h = n.measured?.height ?? n.height ?? 0
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}
type Box = ReturnType<typeof box>

/** The side of a that faces b: left or right when they sit more side by side than one above the other. */
function facing(a: Box, b: Box): Side {
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  const across = Math.abs(dx) / Math.max(1, a.w / 2 + b.w / 2)
  const down = Math.abs(dy) / Math.max(1, a.h / 2 + b.h / 2)
  if (across >= down) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/** Where an arrow meets a side: its middle, or, with several arrows on that side, spread along it (`at` of `of`). */
function point(b: Box, side: Side, at = 0, of = 1) {
  const along = side === 'top' || side === 'bottom' ? b.w : b.h
  const step = Math.min(28, along / (of + 1))
  const d = (at - (of - 1) / 2) * step
  if (side === 'top') return { x: b.cx + d, y: b.y }
  if (side === 'bottom') return { x: b.cx + d, y: b.y + b.h }
  if (side === 'left') return { x: b.x, y: b.cy + d }
  return { x: b.x + b.w, y: b.cy + d }
}

type Store = { edges: LinkEdge[]; nodeLookup: Map<string, InternalNode> }

/** The arrows that meet this card on this side, ordered along it by where their other card is, and this one's place
 * among them: so two arrows on one side don't start from the same point and run on top of each other. */
function placeOnSide(s: Store, self: string, card: string, side: Side): [number, number] {
  const here = s.nodeLookup.get(card)
  if (!here) return [0, 1]
  const H = box(here)
  const on: { id: string; key: number }[] = []
  for (const e of s.edges) {
    if (e.source !== card && e.target !== card) continue
    const other = s.nodeLookup.get(e.source === card ? e.target : e.source)
    if (!other || other.hidden || here.hidden) continue
    const O = box(other)
    const d = (e.data || {}) as LinkData
    const pinned = e.source === card ? d.fromSide : d.toSide
    if ((pinned ?? facing(H, O)) !== side) continue
    on.push({ id: e.id, key: side === 'top' || side === 'bottom' ? O.cx : O.cy })
  }
  on.sort((a, b) => a.key - b.key || a.id.localeCompare(b.id))
  const i = on.findIndex(x => x.id === self)
  return i < 0 ? [0, 1] : [i, on.length]
}

/** An arrowhead whose tip is at p, pointing into a card through its side. */
function head(p: { x: number; y: number }, side: Side) {
  const L = 11
  const W = 5.5
  const [dx, dy] = side === 'top' ? [0, 1] : side === 'bottom' ? [0, -1] : side === 'left' ? [1, 0] : [-1, 0]
  const bx = p.x - dx * L
  const by = p.y - dy * L
  return `M ${p.x} ${p.y} L ${bx - dy * W} ${by + dx * W} L ${bx + dy * W} ${by - dx * W} Z`
}

export function Arrow({ id, source, target, data, selected }: EdgeProps<LinkEdge>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const board = useBoard()
  const [editing, setEditing] = useState(false)
  useEffect(() => onEvent('arrow-label', (d: { id?: string }) => d.id === id && setEditing(true)), [id])
  const A = a && box(a)
  const B = b && box(b)
  const fromSide = A && B ? (data?.fromSide ?? facing(A, B)) : 'right'
  const toSide = A && B ? (data?.toSide ?? facing(B, A)) : 'left'
  // a string, so the arrow draws again only when its place on a side changes
  const places = useStore(s => [...placeOnSide(s as unknown as Store, id, source, fromSide), ...placeOnSide(s as unknown as Store, id, target, toSide)].join(','))
  if (!A || !B) return null
  const [fi, fn, ti, tn] = places.split(',').map(Number)
  const s = point(A, fromSide, fi, fn)
  const t = point(B, toSide, ti, tn)
  // (an arrow always leaves and reaches the middle of a side, or spreads around it with others there; it runs straight
  // when the two cards are in line, which dragging one near level with the other snaps them into: see snapToLinked)
  // the first and last legs stand 22 off each card, less when the cards are close (so it doesn't double back)
  const gap = Math.max(Math.abs(t.x - s.x), Math.abs(t.y - s.y))
  const offset = Math.max(4, Math.min(22, gap / 2 - 2))
  const [path, lx, ly] = getSmoothStepPath({ sourceX: s.x, sourceY: s.y, sourcePosition: POS[fromSide], targetX: t.x, targetY: t.y, targetPosition: POS[toSide], borderRadius: 14, offset })
  const heads = data?.heads
  const label = data?.label || ''
  return (
    <>
      {/* a wide invisible line to catch the pointer, then the line itself */}
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={18} />
      <path d={path} className={cn('arrow-line', data?.dash && 'is-dashed', selected && 'is-selected')} fill="none" />
      {heads !== 'none' && <path d={head(t, toSide)} className={cn('arrow-head', selected && 'is-selected')} />}
      {heads === 'both' && <path d={head(s, fromSide)} className={cn('arrow-head', selected && 'is-selected')} />}
      {(label || editing) && (
        <EdgeLabelRenderer>
          <div className={cn('arrow-label nodrag nopan', selected && 'is-selected')} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} onDoubleClick={() => setEditing(true)}>
            {editing ? (
              <LabelInput
                value={label}
                onDone={v => {
                  setEditing(false)
                  if (v !== null && v.trim() !== label) board.setLink(id, { label: v.trim() })
                }}
              />
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** The label being typed: Enter keeps it (empty takes it away), Esc leaves it as it was. */
function LabelInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const born = useRef(Date.now())
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  // a closing menu hands focus back to where it was a moment later, so take it again
  useEffect(() => {
    const grab = () => {
      if (ref.current && document.activeElement !== ref.current) {
        ref.current.focus()
        ref.current.select()
      }
    }
    grab()
    const timers = [60, 160, 320].map(ms => window.setTimeout(grab, ms))
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [])
  return (
    <input
      ref={ref}
      defaultValue={value}
      placeholder="Label"
      aria-label="Arrow label"
      maxLength={200}
      size={Math.max(6, value.length + 1)}
      onInput={e => (e.currentTarget.size = Math.max(6, e.currentTarget.value.length + 1))}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
      // just opened from a menu, focus may be handed back to it once more: take it again then
      onBlur={e => (Date.now() - born.current < 450 ? window.setTimeout(() => ref.current?.focus(), 0) : finish(e.currentTarget.value))}
    />
  )
}
