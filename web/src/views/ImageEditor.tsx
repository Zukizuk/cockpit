// Drawing on an image on the board ("Draw on it" on an image card's menu, or in full screen): pen, highlighter,
// arrow, box, circle, text, blur (to hide a name or a number before sharing) and crop, in a few colours, with undo.
// Saved, the card shows the marked-up image; the image it started from is kept (see the server's shown.js), and
// "Back to the original" on the card's menu returns to it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Circle, Crop, Highlighter, Pencil, Redo2, Square, Type, Undo2, X, EyeOff, Check } from 'lucide-react'
import { get, post, type ShownRead } from '../api'
import { emit, onEvent } from '../lib'
import { useBoard } from '../board'
import { COLORS, baseSize, drawMark, exportPng, imageUrl, loadImage, norm, render, type ColorName, type Mark, type Pt, type Rect } from '../lib/markup'
import { cn } from '@/lib/utils'

type Tool = 'pen' | 'marker' | 'arrow' | 'box' | 'circle' | 'text' | 'blur' | 'crop'
const TOOLS: { tool: Tool; label: string; icon: typeof Pencil; key: string }[] = [
  { tool: 'pen', label: 'Pen', icon: Pencil, key: 'p' },
  { tool: 'marker', label: 'Highlighter', icon: Highlighter, key: 'h' },
  { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: 'a' },
  { tool: 'box', label: 'Box', icon: Square, key: 'b' },
  { tool: 'circle', label: 'Circle', icon: Circle, key: 'o' },
  { tool: 'text', label: 'Text', icon: Type, key: 't' },
  { tool: 'blur', label: 'Blur (hide a name or number)', icon: EyeOff, key: 'u' },
  { tool: 'crop', label: 'Crop', icon: Crop, key: 'c' },
]
type State = { marks: Mark[]; crop: Rect | null }

/** Opens the editor for an image card's entry. */
export const editImage = (id: string) => emit('image-edit', { id })

export function ImageEditor() {
  const board = useBoard()
  const [id, setId] = useState<string | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [title, setTitle] = useState('')
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<ColorName>('red')
  const [state, setState] = useState<State>({ marks: [], crop: null })
  const [past, setPast] = useState<State[]>([])
  const [future, setFuture] = useState<State[]>([])
  const [draft, setDraft] = useState<Mark | null>(null)
  const [cropDraft, setCropDraft] = useState<Rect | null>(null)
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const start = useRef<Pt | null>(null)
  // the picture as big as fits the screen, its own shape kept (never bigger than it is)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [room, setRoom] = useState({ w: 800, h: 600 })
  useEffect(() => {
    if (!stage) return
    const ro = new ResizeObserver(() => setRoom({ w: stage.clientWidth, h: stage.clientHeight }))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stage])

  useEffect(
    () =>
      onEvent('image-edit', async (d: { id?: string }) => {
        if (!d.id) return
        try {
          const r = await get<ShownRead>(`/api/shown/${d.id}`)
          if (r.entry.format !== 'image') return board.toast('Only images can be drawn on')
          const i = await loadImage(imageUrl(r.entry.id, r.entry.path, r.mtime))
          setImg(i)
          setTitle(r.entry.title)
          setState({ marks: [], crop: null })
          setPast([])
          setFuture([])
          setDraft(null)
          setTyping(null)
          setTool('pen')
          setId(d.id)
        } catch (e: any) {
          board.toast(e.message)
        }
      }),
    [board],
  )

  const size = img ? baseSize(img.naturalWidth, img.naturalHeight) : 4
  const close = useCallback(() => {
    setId(null)
    setImg(null)
  }, [])
  const commit = (next: State) => {
    setPast(p => [...p, state])
    setFuture([])
    setState(next)
  }
  const undo = () => {
    if (!past.length) return
    setFuture(f => [state, ...f])
    setState(past[past.length - 1])
    setPast(p => p.slice(0, -1))
  }
  const redo = () => {
    if (!future.length) return
    setPast(p => [...p, state])
    setState(future[0])
    setFuture(f => f.slice(1))
  }

  // the picture with its marks (and the one being drawn)
  useEffect(() => {
    if (!img || !canvas.current) return
    const ctx = render(canvas.current, img, state.marks)
    if (draft) drawMark(ctx, draft)
  }, [img, state.marks, draft])

  const save = useCallback(async () => {
    if (!img || !id) return
    if (!state.marks.length && !state.crop) return close()
    setSaving(true)
    try {
      await post(`/api/shown/${id}/edit`, { data: exportPng(img, state.marks, state.crop) })
      emit('image-edited', { id })
      board.toast('Saved. "Back to the original" is on its menu')
      close()
    } catch (e: any) {
      board.toast(e.message)
    }
    setSaving(false)
  }, [img, id, state, board, close])

  // keys: Esc cancels (or the text being typed), Ctrl+Z / Ctrl+Y, Ctrl+Enter saves, a letter picks a tool
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (typing) return
      e.stopPropagation()
      if (e.key === 'Escape') return close()
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return void save()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        return redo()
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = TOOLS.find(x => x.key === e.key.toLowerCase())
      if (t) setTool(t.tool)
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  })

  if (!id || !img) return null

  // a point on the screen, in the image's own pixels
  const at = (e: React.PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * img.naturalWidth, ((e.clientY - r.top) / r.height) * img.naturalHeight]
  }
  const hex = COLORS[color]
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = at(e)
    if (tool === 'text') {
      if (typing?.text.trim()) commitText()
      setTyping({ x: p[0], y: p[1], text: '' })
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    start.current = p
    if (tool === 'pen' || tool === 'marker') setDraft({ tool, color: hex, size, points: [p] })
    if (tool === 'crop') setCropDraft({ x: p[0], y: p[1], w: 0, h: 0 })
  }
  const move = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const p = at(e)
    if (tool === 'pen' || tool === 'marker') setDraft(d => (d && 'points' in d ? { ...d, points: [...d.points, p] } : d))
    else if (tool === 'arrow') setDraft({ tool: 'arrow', color: hex, size, from: s, to: p })
    else if (tool === 'box' || tool === 'circle' || tool === 'blur') setDraft({ tool, color: hex, size, ...norm(s, p) })
    else if (tool === 'crop') setCropDraft(norm(s, p))
  }
  const up = () => {
    if (!start.current) return
    start.current = null
    if (tool === 'crop') {
      if (cropDraft && cropDraft.w > 8 && cropDraft.h > 8) commit({ ...state, crop: cropDraft })
      setCropDraft(null)
      return
    }
    const d = draft
    setDraft(null)
    if (!d) return
    // a click with nothing drawn is no mark (a dot with the pen is)
    if ('w' in d && (d.w < 4 || d.h < 4)) return
    if (d.tool === 'arrow' && Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) < 6) return
    commit({ ...state, marks: [...state.marks, d] })
  }
  function commitText() {
    if (!typing) return
    const text = typing.text.trim()
    setTyping(null)
    if (text) commit({ ...state, marks: [...state.marks, { tool: 'text', color: hex, size, x: typing.x, y: typing.y, text }] })
  }

  const crop = cropDraft ?? state.crop
  const pct = (r: Rect) => ({ left: `${(r.x / img.naturalWidth) * 100}%`, top: `${(r.y / img.naturalHeight) * 100}%`, width: `${(r.w / img.naturalWidth) * 100}%`, height: `${(r.h / img.naturalHeight) * 100}%` })

  return (
    <div className="img-editor" role="dialog" aria-label={`Draw on ${title}`}>
      <div className="img-editor-bar glass">
        <div className="img-editor-group" role="toolbar" aria-label="Tools">
          {TOOLS.map(t => (
            <button key={t.tool} type="button" className={cn('img-tool', tool === t.tool && 'is-on')} aria-pressed={tool === t.tool} aria-label={t.label} title={`${t.label} (${t.key.toUpperCase()})`} onClick={() => setTool(t.tool)}>
              <t.icon className="size-[16px]" strokeWidth={1.75} />
            </button>
          ))}
        </div>
        <span className="img-editor-sep" />
        <div className="img-editor-group" role="radiogroup" aria-label="Colour">
          {(Object.keys(COLORS) as ColorName[]).map(c => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} title={c} className={cn('img-swatch', color === c && 'is-on')} style={{ background: COLORS[c] }} onClick={() => setColor(c)} />
          ))}
        </div>
        <span className="img-editor-sep" />
        <button type="button" className="img-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}>
          <Undo2 className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button type="button" className="img-tool" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}>
          <Redo2 className="size-[16px]" strokeWidth={1.75} />
        </button>
        <span className="img-editor-fill" />
        <button type="button" className="img-btn" onClick={close}>
          <X className="size-[15px]" strokeWidth={1.75} />
          Cancel
        </button>
        <button type="button" className="img-btn is-primary" disabled={saving || (!state.marks.length && !state.crop)} onClick={save}>
          <Check className="size-[15px]" strokeWidth={2} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="img-editor-stage" ref={setStage}>
        <div className="img-editor-frame" style={(() => {
          const k = Math.min(1, room.w / img.naturalWidth, room.h / img.naturalHeight)
          return { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) }
        })()}>
          <canvas ref={canvas} className={cn('img-editor-canvas', `tool-${tool}`)} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          {/* the crop: what's outside it dimmed */}
          {crop && crop.w > 0 && <div className="img-crop" style={pct(crop)} />}
          {typing && (
            <textarea
              autoFocus
              className="img-text-input"
              style={{ left: `${(typing.x / img.naturalWidth) * 100}%`, top: `${(typing.y / img.naturalHeight) * 100}%`, color: hex }}
              value={typing.text}
              placeholder="Type, then Enter"
              aria-label="Text to add"
              onChange={e => setTyping(t => t && { ...t, text: e.target.value })}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Escape') setTyping(null)
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitText()
                }
              }}
              onBlur={commitText}
            />
          )}
        </div>
      </div>
    </div>
  )
}
