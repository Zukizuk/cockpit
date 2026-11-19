// The free-form board: which cards are on it, where, how big, and whether one is locked in place (and a sticky
// note's colour). One file, ~/.cockpit/board.json, saved whole.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { newNote, setTitle } from './notes.js'

const TYPES = new Set(['item', 'note', 'outputs', 'tasks', 'tracker', 'command', 'later', 'snippets'])
const MAX_CARDS = 400
/** A sticky note's paper. */
export const COLORS = new Set(['yellow', 'green', 'pink', 'orange', 'ink'])
const file = () => path.join(DATA_DIR, 'board.json')
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d)

export function readBoard() {
  try {
    const b = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return { cards: Array.isArray(b.cards) ? b.cards : [], viewport: b.viewport || null }
  } catch {
    return { cards: [], viewport: null }
  }
}

/** The first time Cockpit opens (no board saved yet): a few sticky notes that say how it works, and Later. */
const WELCOME = [
  ['yellow', 'Welcome to Cockpit', 'A board for the links, files and notes you want in front of you. Everything stays on this PC.', 'Delete these notes whenever you like.'],
  ['green', 'Paste anything', 'Paste a link or a file path anywhere on the board. Links go to Later, to read when you have time.'],
  ['pink', 'Sticky notes', 'Press N for a new one, or select one and just type. Click the top of a note to give it a title.'],
  ['orange', 'Finding your way', 'Ctrl+K adds or finds anything. Right-click the board for more. Press ? for every shortcut.'],
].map(([color, title, ...paragraphs]) => ({ color, title, text: paragraphs.join('\n\n') }))

export function hasBoard() {
  return fs.existsSync(file())
}

/** Saves and returns the welcome board (called only when there's no board yet). */
export function welcomeBoard(cfg, now = new Date()) {
  const cards = WELCOME.map(({ color, title, text }, i) => {
    const ref = newNote(cfg, 'sticky', '', now, text)
    setTitle(cfg, ref, title)
    return { id: `welcome-${i + 1}`, type: 'note', ref, x: (i % 2) * 330, y: Math.floor(i / 2) * 310, w: 300, h: 280, color }
  })
  cards.push({ id: 'welcome-later', type: 'later', ref: 'later', x: 680, y: 0, w: 440, h: 590 })
  saveBoard({ cards, viewport: null })
  return readBoard()
}

export function saveBoard(body) {
  if (!Array.isArray(body?.cards)) throw new UserError('No cards')
  const cards = body.cards
    .filter(c => c && typeof c.id === 'string' && TYPES.has(c.type) && typeof c.ref === 'string')
    .slice(0, MAX_CARDS)
    .map(c => ({
      id: c.id.slice(0, 80),
      type: c.type,
      ref: c.ref.slice(0, 600),
      x: num(c.x, -1e6, 1e6, 0),
      y: num(c.y, -1e6, 1e6, 0),
      w: num(c.w, 200, 4000, 480),
      h: num(c.h, 120, 4000, 480),
      ...(c.folded === true ? { folded: true } : {}),
      ...(c.locked === true ? { locked: true } : {}),
      ...(typeof c.color === 'string' && COLORS.has(c.color) ? { color: c.color } : {}),
    }))
  const v = body.viewport
  const viewport = v ? { x: num(v.x, -1e7, 1e7, 0), y: num(v.y, -1e7, 1e7, 0), zoom: num(v.zoom, 0.1, 4, 1) } : null
  writeFileAtomic(file(), JSON.stringify({ cards, viewport }, null, 1) + '\n')
  return { ok: true, count: cards.length }
}
