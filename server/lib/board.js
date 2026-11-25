// The free-form board: which cards are on it, where, how big, and whether one is locked in place (and a sticky
// note's colour). One file, ~/.cockpit/board.json, saved whole.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { newNote, setTitle } from './notes.js'

// a section is an area on the board with a title; the cards whose middle is inside it are in it (nothing else ties
// them together)
const TYPES = new Set(['item', 'note', 'outputs', 'tasks', 'tracker', 'command', 'later', 'snippets', 'folder', 'table', 'section', 'questions'])
const MAX_CARDS = 400
/** A sticky note's paper. */
export const COLORS = new Set(['yellow', 'green', 'pink', 'orange', 'ink'])
const file = () => path.join(DATA_DIR, 'board.json')
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d)

// Spaces: the board can have several (Main, and any the user makes); each card belongs to one, and each space keeps
// where its view was. Cards of other spaces stay saved, out of view.
const MAIN = { id: 'main', name: 'Main' }
const MAX_SPACES = 20

const viewportOf = v => (v && typeof v === 'object' ? { x: num(v.x, -1e7, 1e7, 0), y: num(v.y, -1e7, 1e7, 0), zoom: num(v.zoom, 0.1, 4, 1) } : null)
/** A card or space marked for agents: shared with them, or private (never shown to them). */
const AGENT_MARKS = new Set(['shared', 'private'])
const spaceId = s => (typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s) ? s : 'main')

/** The spaces as saved, Main always first. */
function spacesOf(list) {
  const out = [{ ...MAIN }]
  for (const s of Array.isArray(list) ? list : []) {
    // an id that isn't one is left out (it would read as Main)
    if (spaceId(s?.id) !== s?.id) continue
    const id = s.id
    const name = String(s?.name || '').trim().slice(0, 40)
    const found = out.find(x => x.id === id)
    if (found) {
      if (id === 'main' && name) found.name = name
      if (s?.viewport) found.viewport = viewportOf(s.viewport)
      if (AGENT_MARKS.has(s?.agents)) found.agents = s.agents
      continue
    }
    if (out.length >= MAX_SPACES || !name) continue
    out.push({ id, name, ...(s?.viewport ? { viewport: viewportOf(s.viewport) } : {}), ...(AGENT_MARKS.has(s?.agents) ? { agents: s.agents } : {}) })
  }
  return out
}

// Arrows from one card to another. One whose card is gone goes too.
const MAX_LINKS = 800
const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const HEADS = new Set(['both', 'none'])

/** The arrows as saved: both ends on the board, not to itself, no two the same id. */
export function linksOf(list, cardIds) {
  const out = []
  const seen = new Set()
  for (const l of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_LINKS) break
    if (!l || typeof l.id !== 'string' || !l.id || seen.has(l.id)) continue
    if (typeof l.from !== 'string' || typeof l.to !== 'string' || l.from === l.to || !cardIds.has(l.from) || !cardIds.has(l.to)) continue
    seen.add(l.id)
    const label = typeof l.label === 'string' ? l.label.trim().slice(0, 200) : ''
    out.push({
      id: l.id.slice(0, 80),
      from: l.from,
      to: l.to,
      ...(SIDES.has(l.fromSide) ? { fromSide: l.fromSide } : {}),
      ...(SIDES.has(l.toSide) ? { toSide: l.toSide } : {}),
      ...(label ? { label } : {}),
      ...(l.dash === true ? { dash: true } : {}),
      ...(HEADS.has(l.heads) ? { heads: l.heads } : {}),
    })
  }
  return out
}

export function readBoard() {
  try {
    const b = JSON.parse(fs.readFileSync(file(), 'utf8'))
    const spaces = spacesOf(b.spaces)
    const space = spaces.some(s => s.id === b.space) ? b.space : 'main'
    const cards = Array.isArray(b.cards) ? b.cards : []
    return { cards, viewport: b.viewport || null, spaces, space, links: linksOf(b.links, new Set(cards.map(c => c?.id))) }
  } catch {
    return { cards: [], viewport: null, spaces: spacesOf([]), space: 'main', links: [] }
  }
}

/** The first time Cockpit opens (no board saved yet): a few sticky notes that say how it works, and Later. */
const WELCOME = [
  ['yellow', 'Welcome to Cockpit', 'A board for the links, files and notes you want in front of you. Everything stays on this PC.', 'Delete these notes whenever you like.'],
  ['green', 'Paste anything', 'Paste a link, a file path or an image anywhere on the board and it becomes a card where your mouse is. Drop images from Explorer too.', 'A key or password you paste goes into Snippets instead, hidden.'],
  ['pink', 'Sticky notes', 'Press N for a new one, or select one and just type. Click the top of a note to give it a title.', 'Hover any card for a + to leave a comment on it.'],
  ['orange', 'Read and compare', 'Select a card and press Space to open it full screen. Select two (Shift+click) and press Space to see them side by side.', "In an Excel file, click a cell to read all of it, and drag a column's edge to widen it."],
  ['ink', 'Claude on your board', 'Use Claude Code? Settings → Claude Code → Connect.', 'Then select a card and say "the selected card", or right-click one: Share with agents. Claude sees only what you share, and can read it, comment on it, and add notes, tasks and tables. What a chat makes shows under Outputs (O).'],
  ['green', 'Finding your way', 'Scroll to move around, and drag on empty board to select several cards. Ctrl+K adds or finds anything; ? lists every shortcut.', 'The name at the top left keeps more than one board (spaces). Sharing your screen? H hides what is in the selected cards.'],
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
      ...(c.sized === true ? { sized: true } : {}),
      ...(spaceId(c.space) !== 'main' ? { space: spaceId(c.space) } : {}),
      // tucked away at the top edge (off the board until brought back); its contents hidden (blurred) on the board
      ...(c.tucked === true ? { tucked: true } : {}),
      ...(c.veiled === true ? { veiled: true } : {}),
      // shared with agents, or private (agents never see it)
      ...(AGENT_MARKS.has(c.agents) ? { agents: c.agents } : {}),
      // a section's title
      ...(c.type === 'section' && typeof c.title === 'string' && c.title.trim() ? { title: c.title.trim().slice(0, 80) } : {}),
    }))
  const viewport = viewportOf(body.viewport)
  const spaces = spacesOf(body.spaces)
  // a card whose space is gone goes back to Main
  for (const c of cards) if (c.space && !spaces.some(s => s.id === c.space)) delete c.space
  const space = spaces.some(s => s.id === body.space) ? body.space : 'main'
  const links = linksOf(body.links, new Set(cards.map(c => c.id)))
  writeFileAtomic(file(), JSON.stringify({ cards, viewport, spaces, space, links }, null, 1) + '\n')
  backup()
  return { ok: true, count: cards.length, links: links.length }
}

const KEEP_BACKUPS = 14

/** A copy of the board once a day (the first save of the day), the last 14 kept: a bad save can be undone by hand. */
export function backup(now = new Date()) {
  try {
    const dir = path.join(DATA_DIR, 'backups')
    const name = `board-${now.toISOString().slice(0, 10)}.json`
    if (fs.existsSync(path.join(dir, name))) return
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(file(), path.join(dir, name))
    const old = fs.readdirSync(dir).filter(n => /^board-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(0, -KEEP_BACKUPS)
    for (const n of old) fs.rmSync(path.join(dir, n), { force: true })
  } catch {
    // a backup must never stop a save
  }
}
