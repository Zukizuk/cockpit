// Draws Cockpit's icon as PNGs and an SVG, with no image libraries: shapes are sampled 4×4 per pixel for smooth
// edges and written with zlib. The icon (chosen 16 Nov): three cards laid out freely on a charcoal tile, the front
// one with a warm dot. The board, in one glance.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons')
fs.mkdirSync(out, { recursive: true })

const RING = [0x2c, 0x2c, 0x2c]
const TILE = [0x14, 0x14, 0x14]
const CARD = [0xf2, 0xf2, 0xf2]
const WARM = [0xf2, 0xb8, 0x4b]
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// in a 512 box, as in the design sketch
const CARDS = [
  { type: 'rect', x: 104, y: 132, w: 168, h: 200, r: 30, c: mix(TILE, CARD, 0.35) },
  { type: 'rect', x: 214, y: 104, w: 196, h: 150, r: 30, c: mix(TILE, CARD, 0.6) },
  { type: 'rect', x: 170, y: 270, w: 210, h: 140, r: 30, c: CARD },
  { type: 'circle', x: 344, y: 306, r: 16, c: WARM },
]

/** Background shapes, then the cards (pulled towards the middle on a maskable icon, which gets cropped round). */
function shapesFor(maskable) {
  const k = maskable ? 0.82 : 1
  const at = v => 256 + (v - 256) * k
  const cards = CARDS.map(s => (s.type === 'rect' ? { ...s, x: at(s.x), y: at(s.y), w: s.w * k, h: s.h * k, r: s.r * k } : { ...s, x: at(s.x), y: at(s.y), r: s.r * k }))
  const bg = maskable
    ? [{ type: 'rect', x: 0, y: 0, w: 512, h: 512, r: 0, c: TILE }]
    : [
        { type: 'rect', x: 13, y: 13, w: 486, h: 486, r: 115, c: RING },
        { type: 'rect', x: 19, y: 19, w: 474, h: 474, r: 109, c: TILE },
      ]
  return [...bg, ...cards]
}

function inShape(u, v, s) {
  if (s.type === 'circle') return (u - s.x) ** 2 + (v - s.y) ** 2 <= s.r * s.r
  if (u < s.x || v < s.y || u > s.x + s.w || v > s.y + s.h) return false
  const dx = Math.max(s.x + s.r - u, 0, u - (s.x + s.w - s.r))
  const dy = Math.max(s.y + s.r - v, 0, v - (s.y + s.h - s.r))
  return dx * dx + dy * dy <= s.r * s.r
}

const render = (size, maskable) => png(size, size, pixels(size, maskable))

/** The icon as RGBA pixels, straight (not premultiplied) alpha. */
function pixels(size, maskable) {
  const shapes = shapesFor(maskable)
  const px = Buffer.alloc(size * size * 4)
  const S = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = ((x + (sx + 0.5) / S) / size) * 512
          const v = ((y + (sy + 0.5) / S) / size) * 512
          let c = null
          for (const s of shapes) if (inShape(u, v, s)) c = s.c
          if (!c) continue
          r += c[0]; g += c[1]; b += c[2]; a += 255
        }
      }
      const i = (y * size + x) * 4
      // colours are summed only where covered: divide by covered samples, keep coverage as alpha
      const k = a ? 255 / a : 0
      px[i] = Math.round(r * k)
      px[i + 1] = Math.round(g * k)
      px[i + 2] = Math.round(b * k)
      px[i + 3] = Math.round(a / (S * S))
    }
  }
  return px
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** A Windows .ico with each size drawn on its own (not scaled down): 32-bit bitmaps below 256, a PNG at 256. */
function ico(sizes) {
  const images = sizes.map(size => {
    const px = pixels(size, false)
    if (size >= 256) return png(size, size, px)
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(size, 4)
    header.writeInt32LE(size * 2, 8) // colour rows plus the mask's
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    const bgra = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = (y * size + x) * 4
        const d = ((size - 1 - y) * size + x) * 4 // bottom-up
        bgra[d] = px[s + 2]; bgra[d + 1] = px[s + 1]; bgra[d + 2] = px[s]; bgra[d + 3] = px[s + 3]
      }
    }
    const mask = Buffer.alloc((Math.ceil(size / 32) * 4) * size) // all zero: alpha does the work
    return Buffer.concat([header, bgra, mask])
  })
  const dir = Buffer.alloc(6 + 16 * sizes.length)
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(sizes.length, 4)
  let offset = dir.length
  sizes.forEach((size, i) => {
    const e = 6 + 16 * i
    dir[e] = size >= 256 ? 0 : size
    dir[e + 1] = size >= 256 ? 0 : size
    dir.writeUInt16LE(1, e + 4) // planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(images[i].length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([dir, ...images])
}

function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function svg() {
  const hex = c => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
  const el = s =>
    s.type === 'circle'
      ? `  <circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${hex(s.c)}"/>`
      : `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${hex(s.c)}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n${shapesFor(false).map(el).join('\n')}\n</svg>\n`
}

fs.writeFileSync(path.join(out, 'icon-32.png'), render(32, false))
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, false))
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, false))
fs.writeFileSync(path.join(out, 'maskable-512.png'), render(512, true))
fs.writeFileSync(path.join(out, 'favicon.svg'), svg())
// shortcuts, Setup and Settings > Apps: Windows picks the size it needs, so each one is drawn sharp
fs.writeFileSync(path.join(out, 'cockpit.ico'), ico([16, 20, 24, 32, 40, 48, 64, 256]))
console.log(`icons written to ${out}`)
