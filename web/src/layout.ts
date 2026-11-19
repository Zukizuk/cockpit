// Tidy, as a pure function so it can be tested on its own. Cards are packed from the top-left of an area in the
// order they're read on the board (rows top to bottom, each left to right). Each goes to the highest free spot it
// fits, then the leftmost (a "skyline"), so cards of different heights stack into columns without gaps or
// overlaps. Sizes never change. Fixed boxes (locked cards) stay where they are and the rest flow around them.

export type Box = { id: string; x: number; y: number; w: number; h: number }
export type Spot = { x: number; y: number }

/** Cards whose tops are this close count as one row when reading the board. */
const ROW = 160

export function readingOrder<T extends Box>(cards: T[]): T[] {
  const byY = [...cards].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: T[][] = []
  for (const c of byY) {
    const row = rows[rows.length - 1]
    if (row && c.y < row[0].y + ROW) row.push(c)
    else rows.push([c])
  }
  return rows.flatMap(r => r.sort((a, b) => a.x - b.x))
}

type Seg = { x: number; w: number; y: number }

/** The skyline raised to y over [x0, x0 + w), the rest kept, neighbours at one height merged. */
function raise(sky: Seg[], x0: number, w: number, y: number): Seg[] {
  const left = sky[0].x
  const right = sky[sky.length - 1].x + sky[sky.length - 1].w
  const a = Math.max(left, x0)
  const b = Math.min(right, x0 + w)
  const out: Seg[] = []
  for (const s of sky) {
    const end = s.x + s.w
    if (end <= a || s.x >= b) {
      out.push(s)
      continue
    }
    if (s.x < a) out.push({ x: s.x, w: a - s.x, y: s.y })
    if (end > b) out.push({ x: b, w: end - b, y: s.y })
  }
  if (b > a) out.push({ x: a, w: b - a, y })
  out.sort((p, q) => p.x - q.x)
  const merged: Seg[] = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.y - s.y) < 0.5 && Math.abs(last.x + last.w - s.x) < 0.5) last.w += s.w
    else merged.push({ ...s })
  }
  return merged
}

/** The first y at or below `y` where a w×h box at x keeps `gap` clear of every fixed box. */
function clearOf(fixed: Box[], x: number, y: number, w: number, h: number, gap: number) {
  for (let guard = 0; guard < 200; guard++) {
    const hit = fixed.find(f => x < f.x + f.w + gap && f.x < x + w + gap && y < f.y + f.h + gap && f.y < y + h + gap)
    if (!hit) return y
    y = hit.y + hit.h + gap
  }
  return y
}

/**
 * Where each card goes. `area` is where packing starts (its top-left) and how wide a row may be; a card wider
 * than that still gets a row of its own.
 */
export function pack(cards: Box[], fixed: Box[], area: { x: number; y: number; w: number }, gap = 24): Map<string, Spot> {
  const spots = new Map<string, Spot>()
  const width = Math.max(area.w, ...cards.map(c => c.w), 1)
  let sky: Seg[] = [{ x: area.x, w: width, y: area.y }]
  for (const c of readingOrder(cards)) {
    let best: Spot | null = null
    // where a card may start: where the skyline steps, and just right of each locked card
    const xs = [...new Set([...sky.map(s => s.x), ...fixed.map(f => f.x + f.w + gap).filter(x => x > area.x && x < area.x + width)])]
    for (const x of xs) {
      if (x + c.w > area.x + width + 0.5) continue
      let y = area.y
      for (const t of sky) if (t.x < x + c.w - 0.5 && t.x + t.w > x + 0.5) y = Math.max(y, t.y)
      y = clearOf(fixed, x, y, c.w, c.h, gap)
      if (!best || y < best.y - 0.5 || (Math.abs(y - best.y) <= 0.5 && x < best.x)) best = { x, y }
    }
    const spot = best ?? { x: area.x, y: clearOf(fixed, area.x, Math.max(...sky.map(s => s.y)), c.w, c.h, gap) }
    spots.set(c.id, spot)
    sky = raise(sky, spot.x, c.w + gap, spot.y + c.h + gap)
  }
  return spots
}
