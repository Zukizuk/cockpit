// Tidy's packing (web/src/layout.ts), tested on its own: Node runs the TypeScript file as it is.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { pack, readingOrder } = await import('../web/src/layout.ts')

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const placed = (cards, spots) => cards.map(c => ({ ...c, ...spots.get(c.id) }))
const noneOverlap = boxes => boxes.every((a, i) => boxes.every((b, j) => i === j || !overlaps(a, b)))

test('layout: the board is read in rows, top to bottom, each left to right', () => {
  const cards = [
    { id: 'c', x: 900, y: 40, w: 100, h: 100 },
    { id: 'a', x: 0, y: 0, w: 100, h: 100 },
    { id: 'd', x: 0, y: 700, w: 100, h: 100 },
    { id: 'b', x: 500, y: 120, w: 100, h: 100 },
  ]
  assert.deepEqual(readingOrder(cards).map(c => c.id), ['a', 'b', 'c', 'd'])
})

test('layout: tidy packs from the top-left, keeps sizes and order, and nothing overlaps', () => {
  const cards = [
    { id: 'later', x: 300, y: 10, w: 440, h: 560 },
    { id: 'today', x: -200, y: 0, w: 420, h: 480 },
    { id: 'snip', x: 900, y: 30, w: 400, h: 200 },
    { id: 'note', x: 50, y: 900, w: 300, h: 280 },
    { id: 'item', x: 700, y: 950, w: 620, h: 700 },
  ]
  const spots = pack(cards, [], { x: 0, y: 0, w: 1400 }, 24)
  assert.deepEqual(spots.get('today'), { x: 0, y: 0 }, 'the first card read is top-left')
  assert.deepEqual(spots.get('later'), { x: 444, y: 0 }, 'the next one beside it, one gap away')
  assert.deepEqual(spots.get('snip'), { x: 908, y: 0 })
  assert.deepEqual(spots.get('note'), { x: 908, y: 224 }, 'a short card leaves room under it: the next fits there')
  assert.deepEqual(spots.get('item'), { x: 0, y: 584 }, 'the wide one goes where it fits highest (clear of the cards above it), then leftmost')
  assert.ok(noneOverlap(placed(cards, spots)))
})

test('layout: a locked card stays put and the others flow around it', () => {
  const locked = { id: 'pinned', x: 0, y: 0, w: 420, h: 300 }
  const cards = [
    { id: 'a', x: 0, y: 0, w: 400, h: 200 },
    { id: 'b', x: 500, y: 0, w: 400, h: 200 },
    { id: 'c', x: 0, y: 400, w: 400, h: 200 },
  ]
  const spots = pack(cards, [locked], { x: 0, y: 0, w: 1400 }, 24)
  const all = [...placed(cards, spots), locked]
  assert.ok(noneOverlap(all), 'nothing lands on the locked card')
  assert.deepEqual(spots.get('a'), { x: 444, y: 0 }, 'the first free spot is beside it')
})

test('layout: a card wider than the row still gets a place, and no gaps are lost on a narrow row', () => {
  const cards = [
    { id: 'wide', x: 0, y: 0, w: 900, h: 100 },
    { id: 'small', x: 0, y: 500, w: 200, h: 100 },
  ]
  const spots = pack(cards, [], { x: 10, y: 20, w: 500 }, 20)
  assert.deepEqual(spots.get('wide'), { x: 10, y: 20 })
  assert.deepEqual(spots.get('small'), { x: 10, y: 140 })
})
