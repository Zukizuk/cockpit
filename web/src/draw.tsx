// Drawing on the board itself: freehand lines and boxes around and between the cards (pictures have their own editor,
// views/ImageEditor). The drawings live in flow coordinates, so they pan and zoom with the board, and each shows only in
// the space it was drawn in. Behind the cards (ViewportPortal, under the nodes); while draw mode is on, a clear sheet
// over the board takes the mouse, so a drag draws instead of moving a card.
import { useRef, useState } from 'react'
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import { Check, Eraser, Pencil, Square } from 'lucide-react'
import { useBoard } from './board'
import type { DrawColor, Drawing } from './api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Pt = [number, number]
type Tool = 'pen' | 'box' | 'eraser'

export const DRAW_COLORS: DrawColor[] = ['ink', 'red', 'orange', 'green', 'blue']
const WIDTH = 3 // flow pixels: 3 on screen at 100%, bigger or smaller with the board
const THIN = 2 // a stroke point closer than this to the last one adds nothing
const REACH = 6 // screen pixels the eraser reaches round the line

/** The colour as the theme has it (styles.css), so it reads on the dark board and the light one. */
const inkOf = (c: DrawColor) => `var(--draw-${c})`

/** The path of a stroke; one point is a dot (a zero-length line with round caps). */
const pathOf = (pts: Pt[]) => (pts.length === 1 ? `M${pts[0][0]} ${pts[0][1]}l0 0` : pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''))

function Shape({ d }: { d: Pick<Drawing, 'kind' | 'color' | 'points' | 'rect'> }) {
  const style = { stroke: inkOf(d.color) }
  if (d.kind === 'box' && d.rect) return <rect x={d.rect.x} y={d.rect.y} width={d.rect.w} height={d.rect.h} rx={8} style={style} />
  return d.points ? <path d={pathOf(d.points)} style={style} /> : null
}

const SHAPES = { fill: 'none', strokeWidth: WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round', overflow: 'visible' } as const

/** The drawings of the space shown, under the cards. Inside <ReactFlow>. */
export function Drawings() {
  const board = useBoard()
  const here = board.drawings.filter(d => d.space === board.space)
  if (!here.length) return null
  return (
    <ViewportPortal>
      {/* z-index -1: behind the arrows and the cards, inside the board's own layer */}
      <svg width={1} height={1} className="pointer-events-none absolute top-0 left-0" style={{ ...SHAPES, zIndex: -1 }} aria-hidden data-testid="drawings">
        {here.map(d => (
          <Shape key={d.id} d={d} />
        ))}
      </svg>
    </ViewportPortal>
  )
}

/** How far a point is from a segment. */
function nearSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Is the point on the drawing's line, give or take `reach` (flow pixels)? A box is its outline, not its inside. */
export function touches(d: Drawing, p: Pt, reach: number) {
  const slack = reach + WIDTH / 2
  if (d.kind === 'box' && d.rect) {
    const { x, y, w, h } = d.rect
    const inOuter = p[0] >= x - slack && p[0] <= x + w + slack && p[1] >= y - slack && p[1] <= y + h + slack
    const inInner = p[0] > x + slack && p[0] < x + w - slack && p[1] > y + slack && p[1] < y + h - slack
    return inOuter && !inInner
  }
  const pts = d.points ?? []
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= slack
  return pts.some((a, i) => i > 0 && nearSegment(p, pts[i - 1], a) <= slack)
}

/** A box from the corner where the drag began to where it is now, whichever way it went. */
const boxOf = (a: Pt, b: Pt) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) })

type Draft = { kind: 'pen'; points: Pt[] } | { kind: 'box'; from: Pt; to: Pt }

/** The sheet over the board while drawing, and the strip of tools. Always mounted, so the tool and colour are kept. */
export function DrawTools() {
  const board = useBoard()
  const rf = useReactFlow()
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<DrawColor>('ink')
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const rubbing = useRef(false)
  const [x, y, zoom] = useStore(s => s.transform)
  if (!board.drawing) return null

  const at = (e: React.PointerEvent): Pt => {
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]
  }
  const keep = (d: Draft | null) => {
    draftRef.current = d
    setDraft(d)
  }
  // the eraser takes every drawing under the pointer; one drag is one Undo
  const rub = (p: Pt) => {
    const hit = board.drawings.filter(d => d.space === board.space && touches(d, p, REACH / zoom)).map(d => d.id)
    if (!hit.length) return
    board.eraseDrawings(hit, rubbing.current)
    rubbing.current = true
  }

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    if (tool === 'eraser') {
      rubbing.current = false
      rub(p)
    } else keep(tool === 'pen' ? { kind: 'pen', points: [p] } : { kind: 'box', from: p, to: p })
  }
  const move = (e: React.PointerEvent) => {
    const p = at(e)
    if (tool === 'eraser') {
      if (e.buttons & 1) rub(p)
      return
    }
    const d = draftRef.current
    if (!d) return
    if (d.kind === 'box') return keep({ ...d, to: p })
    // a point barely moved from the last one adds nothing
    const last = d.points[d.points.length - 1]
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= THIN) keep({ kind: 'pen', points: [...d.points, p] })
  }
  const up = (e: React.PointerEvent) => {
    const d = draftRef.current
    keep(null)
    if (!d) return
    if (d.kind === 'pen') {
      // the end of the stroke is where the mouse was let go
      const end = at(e)
      const last = d.points[d.points.length - 1]
      board.addDrawing({ kind: 'pen', color, points: end[0] === last[0] && end[1] === last[1] ? d.points : [...d.points, end] })
    } else {
      const rect = boxOf(d.from, d.to)
      // a click with no drag isn't a box
      if (rect.w >= 3 || rect.h >= 3) board.addDrawing({ kind: 'box', color, rect })
    }
  }
  // the wheel still moves around the board (the sheet is over it, so it's passed on)
  const wheel = (e: React.WheelEvent) => rf.setViewport({ x: x - e.deltaX, y: y - e.deltaY, zoom })

  const tools: { id: Tool; label: string; icon: typeof Pencil }[] = [
    { id: 'pen', label: 'Pen', icon: Pencil },
    { id: 'box', label: 'Box', icon: Square },
    { id: 'eraser', label: 'Eraser', icon: Eraser },
  ]
  return (
    <>
      <div
        data-testid="draw-sheet"
        className="draw-sheet"
        style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => keep(null)}
        onWheel={wheel}
      >
        {draft && (
          <svg className="size-full" aria-hidden>
            <g transform={`translate(${x} ${y}) scale(${zoom})`} style={SHAPES}>
              <Shape d={draft.kind === 'pen' ? { kind: 'pen', color, points: draft.points } : { kind: 'box', color, rect: boxOf(draft.from, draft.to) }} />
            </g>
          </svg>
        )}
      </div>
      <div className="draw-strip glass" role="toolbar" aria-label="Draw">
        {tools.map(t => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <button type="button" aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} className={cn('corner-btn', tool === t.id && 'is-on')}>
                <t.icon className="size-[16px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {t.label}
            </TooltipContent>
          </Tooltip>
        ))}
        <span className="corner-sep" />
        {DRAW_COLORS.map(c => (
          <button key={c} type="button" aria-label={`Colour: ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn('draw-swatch', color === c && 'is-on')} style={{ background: inkOf(c) }} />
        ))}
        <span className="corner-sep" />
        <button type="button" onClick={() => board.setDrawing(false)} className="draw-done">
          <Check className="size-[15px]" strokeWidth={2} />
          Done
        </button>
      </div>
    </>
  )
}
