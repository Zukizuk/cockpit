// Drawing on an image: the marks (pen, highlighter, arrow, box, circle, text, blur) and a crop, drawn over it in
// order. The editor (views/ImageEditor) draws them as they're made and saves the result; Claude's markUp on an image
// card draws its own the same way, with no editor open.

export type Pt = [x: number, y: number]
export type Mark =
  | { tool: 'pen' | 'marker'; color: string; size: number; points: Pt[] }
  | { tool: 'arrow'; color: string; size: number; from: Pt; to: Pt }
  | { tool: 'box' | 'circle' | 'blur'; color: string; size: number; x: number; y: number; w: number; h: number }
  | { tool: 'text'; color: string; size: number; x: number; y: number; text: string }
export type Rect = { x: number; y: number; w: number; h: number }

export const COLORS = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', white: '#ffffff', black: '#111111' } as const
export type ColorName = keyof typeof COLORS

/** A line width that reads at this image's size (a phone screenshot and a 4K one alike). */
export const baseSize = (w: number, h: number) => Math.max(2, Math.round(Math.max(w, h) / 320))

/** A rectangle the right way round, whichever corner the drag began at. */
export function norm(a: Pt, b: Pt): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }
}

function pixelate(ctx: CanvasRenderingContext2D, r: Rect) {
  const x = Math.max(0, Math.round(r.x))
  const y = Math.max(0, Math.round(r.y))
  const w = Math.min(ctx.canvas.width - x, Math.round(r.w))
  const h = Math.min(ctx.canvas.height - y, Math.round(r.h))
  if (w < 2 || h < 2) return
  // blocks big enough that writing can't be read back
  const block = Math.max(8, Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 90))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.ceil(w / block))
  small.height = Math.max(1, Math.ceil(h / block))
  const s = small.getContext('2d')!
  s.imageSmoothingEnabled = true
  s.drawImage(ctx.canvas, x, y, w, h, 0, 0, small.width, small.height)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
  ctx.restore()
}

/** One mark, on a canvas the size of the image. */
export function drawMark(ctx: CanvasRenderingContext2D, m: Mark) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = m.color
  ctx.fillStyle = m.color
  ctx.lineWidth = m.size
  if (m.tool === 'pen' || m.tool === 'marker') {
    if (m.tool === 'marker') {
      ctx.globalAlpha = 0.35
      ctx.lineWidth = m.size * 5
      ctx.lineCap = 'square'
    }
    ctx.beginPath()
    m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    if (m.points.length === 1) ctx.lineTo(m.points[0][0] + 0.1, m.points[0][1])
    ctx.stroke()
  } else if (m.tool === 'arrow') {
    const [x1, y1] = m.from
    const [x2, y2] = m.to
    const a = Math.atan2(y2 - y1, x2 - x1)
    const head = m.size * 4.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45))
    ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45))
    ctx.closePath()
    ctx.fill()
  } else if (m.tool === 'box') {
    ctx.strokeRect(m.x, m.y, m.w, m.h)
  } else if (m.tool === 'circle') {
    ctx.beginPath()
    ctx.ellipse(m.x + m.w / 2, m.y + m.h / 2, Math.max(1, m.w / 2), Math.max(1, m.h / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (m.tool === 'blur') {
    pixelate(ctx, m)
  } else if (m.tool === 'text') {
    const px = m.size * 7
    ctx.font = `600 ${px}px system-ui, "Segoe UI", sans-serif`
    ctx.textBaseline = 'top'
    // an outline in the opposite tone, so it reads on any background
    ctx.lineWidth = Math.max(2, px / 7)
    ctx.strokeStyle = m.color === COLORS.black ? '#ffffff' : '#000000'
    ctx.globalAlpha = 0.85
    m.text.split('\n').forEach((line, i) => ctx.strokeText(line, m.x, m.y + i * px * 1.2))
    ctx.globalAlpha = 1
    m.text.split('\n').forEach((line, i) => ctx.fillText(line, m.x, m.y + i * px * 1.2))
  }
  ctx.restore()
}

/** The image with its marks, on a canvas of the image's own size. */
export function render(canvas: HTMLCanvasElement, img: HTMLImageElement, marks: Mark[]) {
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  for (const m of marks) drawMark(ctx, m)
  return ctx
}

/** The finished image (cropped if there's a crop) as base64 PNG. */
export function exportPng(img: HTMLImageElement, marks: Mark[], crop: Rect | null) {
  const full = document.createElement('canvas')
  render(full, img, marks)
  if (!crop || crop.w < 4 || crop.h < 4) return full.toDataURL('image/png').replace(/^data:[^,]*,/, '')
  const out = document.createElement('canvas')
  out.width = Math.round(crop.w)
  out.height = Math.round(crop.h)
  out.getContext('2d')!.drawImage(full, Math.round(crop.x), Math.round(crop.y), out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/png').replace(/^data:[^,]*,/, '')
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Couldn't load the image"))
    img.src = src
  })
}

/** Where an image card's picture is served (as the viewer has it). */
export const imageUrl = (id: string, file: string, mtime = Date.now()) => `/api/shown/${id}/files/${encodeURIComponent(file.split(/[\\/]/).pop() || '')}?v=${Math.round(mtime)}`

/** Put a picture on the clipboard as PNG, to paste into a chat with an agent (a pasted picture's path is no use to it).
 * The write starts at once, while the click still counts, and the picture follows. */
export function copyImage(src: string) {
  const png = loadImage(src).then(
    img =>
      new Promise<Blob>((resolve, reject) => {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        c.getContext('2d')!.drawImage(img, 0, 0)
        c.toBlob(b => (b ? resolve(b) : reject(new Error("Couldn't copy the picture"))), 'image/png')
      }),
  )
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
