// Browser tests: the board in Edge (the one on every Windows PC and CI runner, so nothing is downloaded), against a
// throwaway Cockpit with a board made up front. They cover what broke by hand before: pasting and Later, what an agent
// sees and changes, sticky notes rolling up, Fold all, the card menu's order and the board menu closing.
// Run with `npm run test:e2e` (after `npm run build`). Never touches the real notes, board or Claude settings.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-e2e-'))
const home = path.join(T, 'home')
const data = path.join(home, '.cockpit')
const notesDir = path.join(home, 'Documents', 'Cockpit')
const port = 4900 + Math.floor(Math.random() * 80)
const base = `http://127.0.0.1:${port}`
const H = { 'X-Cockpit': '1', 'Content-Type': 'application/json' }

let server
let browser
let page

const api = (p, init = {}) => fetch(base + p, { ...init, headers: { ...H, ...(init.headers || {}) } }).then(r => r.json())
/** One board-tool call, as Claude Code's makes it. */
const agent = (tool, input = {}) => api('/api/agent/call', { method: 'POST', body: JSON.stringify({ tool, input, agent: 'claude-code', label: 'Claude · e2e' }) })
const cardsSeen = out => (Array.isArray(out.output) ? out.output : []).filter(c => c.component === 'card').map(c => c.label).sort()
const note = title => page.locator('.react-flow__node-note', { hasText: title }).first()
const height = async loc => Math.round((await loc.boundingBox()).height)
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await check()
    if (v || Date.now() > end) return v
    await new Promise(r => setTimeout(r, 100))
  }
}

function seed() {
  const sticky = (name, text) => fs.writeFileSync(path.join(notesDir, 'stickies', name), text)
  fs.mkdirSync(path.join(notesDir, 'stickies'), { recursive: true })
  fs.mkdirSync(data, { recursive: true })
  sticky('shared.md', 'Shared plan\n\nthe first line of the plan\n')
  sticky('private.md', 'Private diary\n\nnot for agents\n')
  sticky('plain.md', 'Plain list\n\neggs\n')
  const n = (id, ref, x, y, extra = {}) => ({ id, type: 'note', ref, x, y, w: 300, h: 280, ...extra })
  const board = {
    cards: [
      n('shared', 'stickies/shared.md', 0, 0, { agents: 'shared' }),
      n('private', 'stickies/private.md', 340, 0, { agents: 'private' }),
      n('plain', 'stickies/plain.md', 680, 0),
      { id: 'later', type: 'later', ref: 'later', x: 0, y: 330, w: 440, h: 360 },
      { id: 'away', type: 'snippets', ref: 'snippets', x: 0, y: 0, w: 380, h: 300, space: 'work' },
    ],
    viewport: { x: 40, y: 60, zoom: 1 },
    spaces: [{ id: 'main', name: 'Main' }, { id: 'work', name: 'Work' }],
    space: 'main',
  }
  fs.writeFileSync(path.join(data, 'board.json'), JSON.stringify(board))
  // tables on (an extra): a table Claude fills in
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ extras: { tables: true } }))
}

before(async () => {
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) throw new Error('Build the web app first: npm run build')
  seed()
  server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    env: { ...process.env, COCKPIT_HOME: home, COCKPIT_DATA: data, COCKPIT_PORT: String(port) },
    stdio: 'ignore',
  })
  // (30 s: a busy PC, or one just done building, can take a while to start it)
  const up = await until(() => fetch(`${base}/api/health`).then(r => r.ok, () => false), 30000)
  assert.ok(up, 'the server started')
  browser = await chromium.launch({ channel: 'msedge' })
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', e => console.log('page error:', e.message))
  await page.goto(base + '/')
  await until(async () => (await page.locator('.react-flow__node').count()) >= 4, 15000)
  await page.waitForTimeout(800)
})

after(async () => {
  await browser?.close()
  server?.kill()
  fs.rmSync(T, { recursive: true, force: true })
})

/** The items of the open menu whose words run onto a second line (an item is one line, about 32px tall). */
const wrapped = () =>
  page.evaluate(() => [...document.querySelectorAll('[role=menu]:last-of-type [role=menuitem]')].filter(el => el.getBoundingClientRect().height > 40).map(el => el.textContent))

/** A spot of empty board: right of the cards, above the dock and the zoom buttons. */
const EMPTY = { x: 1200, y: 450 }
/** A click there: nothing selected. */
const clearSelection = async () => {
  await page.keyboard.press('Escape')
  await page.mouse.click(EMPTY.x, EMPTY.y)
  await page.waitForTimeout(250)
}

test('agents see only what is shared or selected; read gives one card; a private card never shows', async () => {
  await clearSelection()
  assert.deepEqual(cardsSeen(await agent('snapshot')), ['Shared plan'], 'only the shared card')
  const snap = await agent('snapshot')
  const board = snap.output.find(c => c.component === 'board')
  assert.match(board.value.sharing, /only what the user shares/)
  const shared = snap.output.find(c => c.label === 'Shared plan')
  assert.equal(shared.value.text, undefined, 'the overview has no contents')

  // on the paper, not the strip (its title button keeps the click, to rename)
  await note('Plain list').click({ position: { x: 150, y: 200 } })
  await page.waitForTimeout(300)
  assert.deepEqual(cardsSeen(await agent('snapshot')), ['Plain list', 'Shared plan'], 'a selected card shows')
  await clearSelection()

  const read = await agent('act', { steps: [{ ref: 'Shared plan', action: 'read' }] })
  assert.match(read.output.steps[0].result.text, /first line of the plan/)
  const priv = await agent('act', { steps: [{ ref: 'Private diary', action: 'read' }] })
  assert.equal(priv.output.ok, false)
  assert.deepEqual(cardsSeen(await agent('query', { text: 'Private' })), [])
})

test('an agent adds to a shared note and it shows at once; a rewrite waits for Allow', async () => {
  const line = `added ${Date.now()}`
  const added = await agent('act', { steps: [{ ref: 'Shared plan', action: 'append', args: [line] }] })
  assert.equal(added.output.steps[0].result, 'done')
  assert.ok(await until(async () => (await note(line).count()) > 0), 'the card shows it without a reload')

  const rewrite = agent('act', { steps: [{ ref: 'Shared plan', action: 'setText', args: ['Shared plan\n\nrewritten'] }] })
  const allow = page.getByRole('button', { name: 'Allow' })
  assert.ok(await until(async () => (await allow.count()) > 0), 'the Allow toast')
  await allow.click()
  assert.equal((await rewrite).output.ok, true)
  assert.match(fs.readFileSync(path.join(notesDir, 'stickies', 'shared.md'), 'utf8'), /rewritten/)
})

test('a sticky note rolls up into its strip and back; Fold all leaves sticky notes and other spaces be', async () => {
  await clearSelection()
  const n = note('Plain list')
  const open = await height(n)
  await n.hover()
  await n.getByRole('button', { name: 'Roll up into its strip (F)' }).click()
  assert.ok(await until(async () => (await height(n)) === 36), 'rolled to its strip')
  await n.hover()
  await n.getByRole('button', { name: 'Unroll' }).click()
  assert.ok(await until(async () => (await height(n)) === open), 'unrolled')

  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Fold all cards', exact: true }).click()
  await page.waitForTimeout(1500) // the board is saved a moment after a change
  const b = await api('/api/board')
  const folded = id => !!b.cards.find(c => c.id === id).folded
  assert.equal(folded('later'), true, 'Later folded')
  assert.equal(folded('plain'), false, 'a sticky note left as it is')
  assert.equal(folded('away'), false, "a card in another space left as it is")
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Unfold all cards', exact: true }).click()
})

test("a card's menu: what it does first, then view, lock, agents, spaces, and Remove from board last", async () => {
  await clearSelection()
  const box = await note('Shared plan').boundingBox()
  await page.mouse.click(box.x + 60, box.y + 12, { button: 'right' })
  const menu = page.locator('[role=menu]').last()
  await menu.waitFor()
  const labels = (await menu.locator('[role=menuitem]').allInnerTexts()).map(t => t.split('\n')[0]).filter(Boolean)
  assert.deepEqual(await wrapped(), [], 'no item wraps onto a second line')
  await page.keyboard.press('Escape')
  const at = l => labels.findIndex(x => x.startsWith(l))
  const order = ['Open full screen', 'Comment', 'Roll up into its strip', 'Stop sharing with agents', 'Move to Work', 'More', 'Remove from board']
  for (const l of order) assert.ok(at(l) >= 0, `${l} is in the menu`)
  assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order, 'in this order')
  assert.equal(labels.at(-1), 'Remove from board')
})

test('the board menu closes where it was opened, not at the top-left corner', async () => {
  await clearSelection()
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.locator('[role=menu]').last().waitFor()
  await page.keyboard.press('Escape')
  const anchor = await page.locator('span[data-anchor="board"]').evaluate(el => ({ left: el.style.left, top: el.style.top }))
  assert.deepEqual(anchor, { left: `${EMPTY.x}px`, top: `${EMPTY.y}px` })
})

test('full screen has the menu too (⋮ and a right-click on its bar), with only what makes sense there', async () => {
  await clearSelection()
  await note('Plain list').hover()
  await note('Plain list').getByRole('button', { name: 'Open full screen' }).click()
  const bar = page.locator('.reader .reader-bar')
  await bar.waitFor()
  const labels = async () => {
    const menu = page.locator('[role=menu]').last()
    await menu.waitFor()
    const l = (await menu.locator('[role=menuitem]').allInnerTexts()).map(t => t.split('\n')[0]).filter(Boolean)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
    return l
  }
  await bar.getByRole('button', { name: 'More' }).click()
  const viaButton = await labels()
  await bar.click({ button: 'right', position: { x: 60, y: 20 } })
  assert.deepEqual(await labels(), viaButton, 'right-click on the bar: the same menu')
  for (const l of ['Copy the text', 'Comment', 'Share with agents', 'Move to Work', 'Archive note', 'Remove from board']) assert.ok(viaButton.includes(l), `${l} is in it`)
  for (const l of ['Open full screen', 'Roll up into its strip', 'Focus on this card', 'Tuck away', 'Lock in place', 'Hide its contents']) assert.ok(!viaButton.includes(l), `${l} is not`)
  assert.equal(viaButton.at(-1), 'Remove from board')
  assert.ok(await bar.isVisible(), 'Esc on the menu left full screen open')
  await page.keyboard.press('Escape')
  await bar.waitFor({ state: 'hidden' })
})

test('arrows: drag from a card to another, change it from its menu, take it off and undo, and it hides with its card', async () => {
  await clearSelection()
  const links = async () => (await api('/api/board')).links || []
  const saved = async check => until(async () => check(await links()), 4000)
  const dot = async (id, side) => {
    await page.locator(`.react-flow__node[data-id="${id}"]`).hover({ position: { x: 150, y: 200 } })
    const b = await page.locator(`.react-flow__node[data-id="${id}"] .link-${side}`).boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
    await page.mouse.move(to.x, to.y, { steps: 5 })
    await page.mouse.up()
  }
  // to the middle of the next card, not to one of its dots
  const shared = await dot('shared', 'right')
  const target = await page.locator('.react-flow__node[data-id="private"]').boundingBox()
  await drag(shared, { x: target.x + target.width / 2, y: target.y + target.height / 2 })
  assert.ok(await saved(l => l.some(x => x.from === 'shared' && x.to === 'private')), 'saved')
  const arrow = page.locator('.react-flow__edge').first()
  assert.equal(await arrow.count(), 1, 'drawn')

  // its menu, from a right-click on the line itself
  const onLine = () =>
    page.evaluate(() => {
      const p = document.querySelector('.react-flow__edge .arrow-line')
      const at = p.getPointAtLength(p.getTotalLength() / 2)
      const m = p.getScreenCTM()
      return { x: at.x * m.a + m.e, y: at.y * m.d + m.f }
    })
  // the two cards are close: the middle of the line is under their dots, which pass the click on to it
  let at = await onLine()
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Dashed line' }).click()
  assert.ok(await saved(l => l[0]?.dash === true), 'dashed')
  at = await onLine()
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Point the other way' }).click()
  assert.ok(await saved(l => l[0]?.from === 'private' && l[0]?.to === 'shared'), 'reversed')

  // a label: double-click, type, Enter
  at = await onLine()
  await page.mouse.dblclick(at.x, at.y)
  await page.getByRole('textbox', { name: 'Arrow label' }).fill('feeds')
  await page.keyboard.press('Enter')
  assert.ok(await saved(l => l[0]?.label === 'feeds'), 'labelled')
  assert.equal(await page.locator('.arrow-label').innerText(), 'feeds')

  at = await onLine()
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /Remove the arrow/ }).click()
  assert.ok(await saved(l => l.length === 0), 'removed')
  await page.mouse.click(EMPTY.x, EMPTY.y)
  await page.keyboard.press('Control+z')
  assert.ok(await saved(l => l.length === 1 && l[0].label === 'feeds'), 'Undo brought it back')

  // a card in another space: its arrow goes out of view with it, and comes back
  await note('Private diary').click({ position: { x: 150, y: 200 } })
  await note('Private diary').click({ button: 'right', position: { x: 60, y: 12 } })
  await page.getByRole('menuitem', { name: 'Move to Work' }).click()
  assert.ok(await until(async () => (await page.locator('.react-flow__edge').count()) === 0), 'hidden with its card')
  assert.equal((await links()).length, 1, 'still saved')
  await page.keyboard.press('Control+z')
  assert.ok(await until(async () => (await page.locator('.react-flow__edge').count()) === 1), 'back with Undo')

  // let go on empty board: a new sticky note there, with the arrow to it
  const before = await page.locator('.react-flow__node-note').count()
  await clearSelection()
  await drag(await dot('plain', 'bottom'), { x: 1000, y: 760 })
  assert.ok(await until(async () => (await page.locator('.react-flow__node-note').count()) === before + 1), 'a new sticky note')
  assert.ok(await saved(l => l.some(x => x.from === 'plain')), 'with an arrow to it')
  await page.keyboard.press('Escape')
})

test('Claude draws an arrow between cards it can see, sees it on both, and taking it away waits for Allow', async () => {
  await clearSelection()
  await note('Plain list').click({ position: { x: 150, y: 200 } })
  const drew = await agent('act', { steps: [{ ref: 'Shared plan', action: 'connectTo', args: ['Plain list', 'next'] }] })
  assert.equal(drew.output.ok, true)
  const links = async () => (await api('/api/board')).links || []
  assert.ok(await until(async () => (await links()).some(l => l.from === 'shared' && l.to === 'plain' && l.label === 'next')), 'saved')
  const snap = await agent('snapshot')
  const arrowsOf = t => snap.output.find(c => c.label === t)?.value.arrows || []
  assert.ok(arrowsOf('Shared plan').includes('→ "Plain list": next'))
  assert.ok(arrowsOf('Plain list').includes('← "Shared plan": next'))
  assert.ok(!arrowsOf('Shared plan').some(a => /Private/.test(a)), 'no arrow to a card it cannot see')

  // lined up beside a card it has an arrow to, a card leaves room for the arrow: 96 apart, not 28
  const cards = async () => (await api('/api/board')).cards
  const was = (await cards()).find(c => c.id === 'shared')
  // (to the right of Plain list: in view, so the view stays where it is)
  const placed = await agent('act', { steps: [{ ref: 'Shared plan', action: 'placeNextTo', args: ['Plain list', 'right'] }] })
  assert.equal(placed.output.ok, true)
  assert.ok(
    await until(async () => {
      const all = await cards()
      const s = all.find(c => c.id === 'shared')
      const p = all.find(c => c.id === 'plain')
      return s.x === p.x + p.w + 96 && s.y === p.y
    }),
    'beside it, with room for the arrow',
  )
  // (Ctrl+Z goes to the board with nothing focused)
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.keyboard.press('Control+z')
  assert.ok(await until(async () => (await cards()).find(c => c.id === 'shared').x === was.x), 'Undo puts it back')

  const gone = agent('act', { steps: [{ ref: 'Shared plan', action: 'disconnect', args: ['Plain list'] }] })
  const allow = page.getByRole('button', { name: 'Allow' })
  assert.ok(await until(async () => (await allow.count()) > 0), 'the Allow toast')
  await allow.click()
  assert.equal((await gone).output.ok, true)
  assert.ok(await until(async () => !(await links()).some(l => l.from === 'shared' && l.to === 'plain')), 'taken away')
  await clearSelection()
})


test('an arrow leaves and reaches the middle of a side; a card dragged near level snaps into line and the arrow runs straight', async () => {
  await clearSelection()
  const card = id => page.locator(`.react-flow__node[data-id="${id}"]`)
  const ys = () =>
    page.evaluate(() => {
      const d = document.querySelector('.react-flow__edge[aria-label="Edge from private to shared"] .arrow-line').getAttribute('d')
      const n = d.match(/-?\d+(\.\d+)?/g).map(Number)
      return [...new Set(n.filter((_, i) => i % 2 === 1).map(Math.round))]
    })
  // the strip, right of its title: drag it by dy (the first pixel's move only starts the drag)
  const dragBy = async (id, dy) => {
    const b = await card(id).boundingBox()
    await page.mouse.move(b.x + 125, b.y + 10)
    await page.mouse.down()
    await page.mouse.move(b.x + 125, b.y + 10 + 3 * Math.sign(dy))
    await page.mouse.move(b.x + 125, b.y + 10 + 4 * Math.sign(dy))
    await page.mouse.move(b.x + 125, b.y + 10 + dy / 2, { steps: 4 })
    await page.mouse.move(b.x + 125, b.y + 10 + dy, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(900) // saved a moment after
  }
  const yOf = async id => (await api('/api/board')).cards.find(c => c.id === id).y

  await dragBy('private', 60)
  const down = await yOf('private')
  assert.ok(down >= 50 && down <= 62, `moved down, out of line (${down})`)
  // the ends stay at the middles of the two sides (140 and 140 + down), so the arrow steps between them
  const bent = await ys()
  assert.ok(bent.includes(140) && bent.includes(140 + down), `from middle to middle: ${bent}`)
  // to a few pixels short of level: it snaps the rest of the way, and runs straight from middle to middle
  await dragBy('private', -(down - 4))
  assert.equal(await yOf('private'), 0, 'snapped level with the card it points to')
  assert.deepEqual(await ys(), [140])
})

test('with several cards selected, a card menu acts on all of them, and leaves out what is for one card', async () => {
  await clearSelection()
  await note('Plain list').click({ position: { x: 150, y: 200 } })
  await note('Shared plan').click({ position: { x: 150, y: 200 }, modifiers: ['Shift'] })
  await note('Shared plan').click({ button: 'right', position: { x: 60, y: 12 } })
  const menu = page.locator('[role=menu]').last()
  await menu.waitFor()
  const labels = (await menu.locator('[role=menuitem]').allInnerTexts()).map(t => t.split('\n')[0]).filter(Boolean)
  for (const l of ['Fold these 2', 'Tuck these 2 away', 'Lock these 2 in place', 'Hide their contents', 'Archive these 2 notes', 'Remove these 2 from board'])
    assert.ok(labels.includes(l), `${l} is in it`)
  for (const l of ['Open full screen', 'Rename', 'Add a title', 'Copy the text', 'Comment']) assert.ok(!labels.includes(l), `${l} is not`)
  await menu.getByRole('menuitem', { name: 'Remove these 2 from board' }).click()
  const on = async () => (await api('/api/board')).cards.map(c => c.id)
  assert.ok(await until(async () => !(await on()).includes('plain') && !(await on()).includes('shared')), 'both taken off')
  await page.mouse.click(EMPTY.x, EMPTY.y)
  await page.keyboard.press('Control+z')
  assert.ok(await until(async () => (await on()).includes('plain') && (await on()).includes('shared')), 'one Undo brings both back')
  await clearSelection()
})

test('sections: one from the board menu or around selected cards, named, dragged with what is in it, and Claude sees it', async () => {
  await clearSelection()
  const board = () => api('/api/board')
  const sections = async () => (await board()).cards.filter(c => c.type === 'section')
  const titleBox = page.locator('.react-flow__node-section .section-title')
  // a new section's title box has the cursor (it takes it back from the closing menu)
  // (and keeps it: a closing menu hands focus back once more, a moment later, and the box takes it back again)
  const titleReady = async () => {
    await until(() => page.evaluate(() => document.activeElement?.matches('.section-title input')))
    await page.waitForTimeout(400)
    assert.ok(await page.evaluate(() => document.activeElement?.matches('.section-title input')), "the title box has the cursor")
  }
  const removeSection = async title => {
    await page.locator('.react-flow__node-section .section-title', { hasText: title }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Remove the section/ }).waitFor()
    assert.deepEqual(await wrapped(), [], 'no item in the section menu wraps')
    await page.getByRole('menuitem', { name: /^Remove the section/ }).click()
  }

  // from the board's menu: a new one where it was right-clicked, its title ready to type
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /Section here/ }).click()
  await titleReady()
  // into the title box itself (typing at the keyboard can lose a letter while focus settles)
  await page.locator('.section-title input').fill('Ideas')
  await page.locator('.section-title input').press('Enter')
  assert.ok(await until(async () => (await sections()).some(s => s.title === 'Ideas')), 'made and named')
  await removeSection('Ideas')
  assert.ok(await until(async () => (await sections()).length === 0), 'taken off')

  // around two selected cards (Ctrl+Alt+G); the one between them is in it too, its middle being inside. (The board
  // scrolled down a little first: a section's title sits above it, and the cards are at the top of the window.)
  await page.mouse.move(EMPTY.x, EMPTY.y)
  await page.mouse.wheel(0, -160)
  await page.waitForTimeout(400)
  await note('Plain list').click({ position: { x: 150, y: 200 } })
  await note('Shared plan').click({ position: { x: 150, y: 200 }, modifiers: ['Shift'] })
  await page.keyboard.press('Control+Alt+g')
  await titleReady()
  await page.locator('.section-title input').fill('Plan')
  await page.locator('.section-title input').press('Enter')
  assert.ok(await until(async () => (await sections()).some(s => s.title === 'Plan')), 'around the two')
  const snap = await agent('snapshot')
  assert.equal(snap.output.find(c => c.label === 'Shared plan').value.section, 'Plan', 'Claude sees which section a card is in')
  assert.ok(!snap.output.some(c => c.component === 'card' && /^Plan$|^Section$/.test(c.label)), 'a section is not a card to Claude')

  // dragged by its title: what's in it comes along
  const before = Object.fromEntries((await board()).cards.map(c => [c.id, { x: c.x, y: c.y }]))
  const t = await titleBox.boundingBox()
  await page.mouse.move(t.x + 20, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + 23, t.y + t.height / 2 + 3)
  await page.mouse.move(t.x + 24, t.y + t.height / 2 + 4)
  await page.mouse.move(t.x + 70, t.y + t.height / 2 + 34, { steps: 5 })
  await page.mouse.move(t.x + 120, t.y + t.height / 2 + 64, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(900)
  const after = Object.fromEntries((await board()).cards.map(c => [c.id, { x: c.x, y: c.y }]))
  const plan = (await sections())[0]
  const dx = after[plan.id].x - before[plan.id].x
  const dy = after[plan.id].y - before[plan.id].y
  assert.ok(dx > 50 && dy > 30, `the section moved (${dx}, ${dy})`)
  for (const id of ['plain', 'shared', 'private']) assert.deepEqual([after[id].x - before[id].x, after[id].y - before[id].y], [dx, dy], `${id} came along`)
  assert.deepEqual(after.later, before.later, 'a card outside it stayed')

  // Claude fits it to what's in it: 40 round the cards
  const fitted = await agent('act', { steps: [{ ref: 'Board', action: 'fitSection', args: ['Plan'] }] })
  assert.equal(fitted.output.ok, true)
  assert.ok(
    await until(async () => {
      const b = await board()
      const s = b.cards.find(c => c.type === 'section')
      const inside = b.cards.filter(c => ['plain', 'shared', 'private'].includes(c.id))
      return s.x === Math.min(...inside.map(c => c.x)) - 40 && s.y === Math.min(...inside.map(c => c.y)) - 40
    }),
    'fitted',
  )

  // Claude takes it off (after the user's Allow), its cards staying
  await clearSelection()
  const off = agent('act', { steps: [{ ref: 'Board', action: 'removeSection', args: ['Plan'] }] })
  const allowIt = page.getByRole('button', { name: 'Allow', exact: true })
  assert.ok(await until(async () => (await allowIt.count()) === 1), 'it asks first')
  await allowIt.click()
  assert.equal((await off).output.ok, true)
  assert.ok(await until(async () => (await sections()).length === 0), 'its cards stay when it goes')
  assert.ok((await board()).cards.some(c => c.id === 'plain'))
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await clearSelection()
})

test('a section folds to its bar and opens, tucks away with its cards, and goes with its last cards; Claude does both too', async () => {
  await clearSelection()
  const board = () => api('/api/board')
  const plan = async () => (await board()).cards.find(c => c.type === 'section' && c.title === 'Plan')
  // the section from the test before (put back by its undo), or a new one round the shared note
  if (!(await until(plan, 3000))) {
    await agent('act', { steps: [{ ref: 'Board', action: 'addSection', args: ['Plan', ['Shared plan']] }] })
    assert.ok(await until(plan), 'a section to work with')
  }
  const s = await plan()
  const all = async () => (await board()).cards
  const heldIds = async () => (await all()).filter(c => c.inside === s.id).map(c => c.id).sort()
  const inIt = (await all()).filter(c => c.type !== 'section' && !c.space && !c.tucked && c.x + c.w / 2 > s.x && c.x + c.w / 2 < s.x + s.w && c.y + c.h / 2 > s.y && c.y + c.h / 2 < s.y + s.h).map(c => c.id).sort()
  assert.ok(inIt.includes('shared'), 'the shared note is in it')
  const title = page.locator(`.react-flow__node-section[data-id="${s.id}"] .section-title`)
  const visible = id => page.locator(`.react-flow__node[data-id="${id}"]`).isVisible()

  // folded by the chevron in its title: a bar, the cards out of sight where they were
  await title.locator('.section-fold').click()
  assert.ok(await until(async () => (await plan()).folded && (await heldIds()).join() === inIt.join()), 'folded, holding what was in it')
  assert.equal(await visible('shared'), false, 'its cards are out of sight')
  assert.match(await page.locator('.section-bar').innerText(), new RegExp(`${inIt.length} cards? in it`), 'the bar says how many')
  const snap = await agent('snapshot')
  assert.equal(snap.output.find(c => c.label === 'Shared plan').value.inFoldedSection, true, 'Claude sees the card is in a folded section')
  assert.deepEqual(snap.output.find(c => c.component === 'board').value.foldedSections, ['Plan'])

  // dragged folded: what it holds comes along, out of sight
  const before = Object.fromEntries((await all()).map(c => [c.id, { x: c.x, y: c.y }]))
  const t = await title.boundingBox()
  await page.mouse.move(t.x + 40, t.y + t.height / 2)
  await page.mouse.down()
  await page.mouse.move(t.x + 43, t.y + t.height / 2 + 3)
  await page.mouse.move(t.x + 44, t.y + t.height / 2 + 4)
  await page.mouse.move(t.x + 100, t.y + t.height / 2 + 34, { steps: 5 })
  await page.mouse.move(t.x + 140, t.y + t.height / 2 + 54, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(900)
  const after = Object.fromEntries((await all()).map(c => [c.id, { x: c.x, y: c.y }]))
  const dx = after[s.id].x - before[s.id].x
  const dy = after[s.id].y - before[s.id].y
  assert.ok(dx > 50, `the section moved (${dx}, ${dy})`)
  for (const id of inIt) assert.deepEqual([after[id].x - before[id].x, after[id].y - before[id].y], [dx, dy], `${id} came along`)

  // opened from its bar: all back, in it
  await page.locator('.section-bar').click()
  assert.ok(await until(async () => !(await plan()).folded && (await heldIds()).length === 0), 'open again')
  assert.ok(await until(() => visible('shared')), 'its cards are back')

  // tucked from its menu: one tab, the cards with it
  await title.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Tuck away', exact: true }).click()
  assert.ok(await until(async () => (await plan()).tucked && (await heldIds()).join() === inIt.join()), 'tucked with what was in it')
  const tabs = page.locator('.tuck-tab')
  assert.deepEqual(await tabs.allInnerTexts(), ['Plan'], 'one tab, the section')
  assert.match(await tabs.first().getAttribute('class'), /is-section/, "a section's tab looks apart (dashed)")
  assert.deepEqual((await agent('snapshot')).output.find(c => c.component === 'board').value.tuckedSections, ['Plan'], 'Claude sees it tucked')
  await tabs.first().click()
  assert.ok(await until(async () => !(await plan()).tucked && (await heldIds()).length === 0), 'back')
  assert.ok(await until(() => visible('shared')), 'with its cards')

  // its cards tucked: it goes with them, no empty box left
  await title.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Select what/ }).click()
  await page.locator(`.react-flow__node[data-id="${inIt[0]}"]`).click({ button: 'right', position: { x: 60, y: 12 } })
  await page.getByRole('menuitem', { name: /^Tuck (these \d+ )?away/ }).click()
  assert.ok(await until(async () => (await plan()).tucked && (await heldIds()).join() === inIt.join()), 'the section went with its last cards')
  assert.deepEqual(await tabs.allInnerTexts(), ['Plan'], 'one tab, the section')

  // Claude brings it back, folds it and opens it
  const act = (action, args) => agent('act', { steps: [{ ref: 'Board', action, args }] })
  assert.equal((await act('tuckSection', ['Plan', false])).output.ok, true)
  assert.ok(await until(async () => !(await plan()).tucked && (await heldIds()).length === 0), 'Claude brought it back')
  assert.equal((await act('foldSection', ['Plan'])).output.ok, true)
  assert.ok(await until(async () => (await plan()).folded), 'Claude folded it')
  assert.equal((await act('foldSection', ['Plan', false])).output.ok, true)
  assert.ok(await until(async () => !(await plan()).folded && (await heldIds()).length === 0), 'Claude opened it')
  await clearSelection()
})

test('a card dragged into a section lights it up; let go on its cards, it moves beside them, and the section grows round it', async () => {
  await clearSelection()
  const cards = async () => (await api('/api/board')).cards
  const s0 = (await cards()).find(c => c.type === 'section' && c.title === 'Plan')
  assert.ok(s0, 'the section from the tests before')
  const sec = await page.locator(`.react-flow__node-section[data-id="${s0.id}"]`).boundingBox()
  const head = page.locator('.react-flow__node[data-id="later"] .card-drag').first()
  const h = await head.boundingBox()
  const card = await page.locator('.react-flow__node[data-id="later"]').boundingBox()
  // its middle just inside the section's lower edge, the rest hanging out below
  const to = { x: sec.x + sec.width / 2, y: sec.y + sec.height - 20 - card.height / 2 + (h.y + h.height / 2 - card.y) }
  await page.mouse.move(h.x + 40, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + 44, h.y + h.height / 2 - 4)
  await page.mouse.move(to.x, to.y, { steps: 12 })
  assert.ok(await until(async () => (await page.locator('.section.is-drop').count()) === 1, 2000), 'it lights up while the card is over it')
  await page.mouse.up()
  assert.ok(await until(async () => (await page.locator('.section.is-drop').count()) === 0, 2000), 'and not once let go')
  assert.ok(
    await until(async () => {
      const all = await cards()
      const s = all.find(c => c.id === s0.id)
      const l = all.find(c => c.id === 'later')
      return s.h > s0.h && s.y + s.h >= l.y + l.h + 40 && s.x <= l.x - 40
    }),
    'the section grew round it, with room',
  )
  // let go on top of the notes in it: it moved beside one of them instead
  const now = await cards()
  const l = now.find(c => c.id === 'later')
  const over = now.filter(c => ['shared', 'private', 'plain'].includes(c.id) && !(l.x + l.w <= c.x || c.x + c.w <= l.x || l.y + l.h <= c.y || c.y + c.h <= l.y))
  assert.deepEqual(over.map(c => c.id), [], 'not on top of a card in the section')
  await page.keyboard.press('Control+z')
  assert.ok(await until(async () => (await cards()).find(c => c.id === s0.id).h === s0.h), 'one Undo puts both back')
  await clearSelection()
})

test("a right-click inside a section gives its menu, then what can go there; outside, the board's menu", async () => {
  await clearSelection()
  const s0 = (await api('/api/board')).cards.find(c => c.type === 'section' && c.title === 'Plan')
  assert.ok(s0, 'the section from the tests before')
  const sec = await page.locator(`.react-flow__node-section[data-id="${s0.id}"]`).boundingBox()
  const labels = async () => (await page.locator('[role=menu]').last().locator('[role=menuitem]').allInnerTexts()).map(t => t.split('\n')[0]).filter(Boolean)
  // the empty strip along its bottom, under the notes (away from its left corner, where Later reaches in)
  await page.mouse.click(sec.x + sec.width * 0.6, sec.y + sec.height - 14, { button: 'right' })
  await page.locator('[role=menu]').last().waitFor()
  assert.match(await page.locator('.pane-section-label').innerText(), /Plan/, 'its name heads the menu')
  const inside = await labels()
  for (const l of ['Fold it to its bar', "Fit it to what's in it", 'Sticky note here', 'Section here']) assert.ok(inside.includes(l), `${l} is in it`)
  for (const l of ['Tidy', 'Settings', 'Show everything', 'Undo']) assert.ok(!inside.includes(l), `${l} is not (board-wide)`)
  assert.deepEqual(await wrapped(), [], 'nothing wraps')
  await page.getByRole('menuitem', { name: 'Fold it to its bar' }).click()
  const plan = async () => (await api('/api/board')).cards.find(c => c.id === s0.id)
  assert.ok(await until(async () => (await plan()).folded), 'folded from there')
  await page.locator('.section-bar').click()
  assert.ok(await until(async () => !(await plan()).folded), 'open again')

  // outside it: the board's menu, no section in it
  await page.mouse.click(Math.min(1380, sec.x + sec.width + 80), sec.y + sec.height / 2, { button: 'right' })
  await page.locator('[role=menu]').last().waitFor()
  const outside = await labels()
  assert.ok(outside.includes('Tidy') && !outside.includes('Fold it to its bar'), "the board's own menu")
  assert.equal(await page.locator('.pane-section-label').count(), 0)
  await page.keyboard.press('Escape')
  await clearSelection()
})

test('while Claude reads a card a frame round it says so, the pill says Claude is at work, and both go a moment later', async () => {
  await clearSelection()
  const out = await agent('act', { steps: [{ ref: 'Shared plan', action: 'read' }] })
  assert.equal(out.output.ok, true)
  const frame = page.locator('.agent-frame', { hasText: 'Claude · reading' })
  assert.ok(await until(async () => (await frame.count()) === 1), 'framed')
  const f = await frame.boundingBox()
  const c = await page.locator('.react-flow__node[data-id="shared"]').boundingBox()
  assert.ok(f.x < c.x && f.y < c.y && f.x + f.width > c.x + c.width && f.y + f.height > c.y + c.height, 'round the card read')
  // (a read is over in a moment: by now the pill says Claude worked on the board, just now)
  assert.match(await page.locator('.agent-pill.is-shown').innerText(), /Claude (is working on|worked on) the board/)
  assert.ok(await until(async () => (await page.locator('.agent-frame').count()) === 0, 9000), 'gone a few seconds later')
  // the pill stays a while, saying when Claude last was at work
  assert.match(await page.locator('.agent-pill.is-shown.is-after').innerText(), /Claude worked on the board · (just now|\d+ s ago)/)
})

test("a comment can be deleted from its card's thread, Claude's too", async () => {
  await clearSelection()
  await api('/api/comments', { method: 'POST', body: JSON.stringify({ card: 'plain', text: 'Mine', by: 'you' }) })
  await api('/api/comments', { method: 'POST', body: JSON.stringify({ card: 'plain', text: 'From Claude', by: 'Claude' }) })
  const thread = async () => ((await api('/api/comments')).cards?.plain || []).map(c => c.text)
  await page.locator('.react-flow__node[data-id="plain"] .comment-bubble').click()
  const del = page.getByRole('button', { name: 'Delete comment' })
  assert.ok(await until(async () => (await del.count()) === 2), 'a delete button on each')
  await del.last().click()
  assert.ok(await until(async () => JSON.stringify(await thread()) === JSON.stringify(['Mine'])), "Claude's comment deleted")
  await del.first().click()
  assert.ok(await until(async () => (await thread()).length === 0), 'and mine')
  await page.keyboard.press('Escape')
})

test('Claude asks a question with its guess in grey and carries on; the person answers or takes the guess; Claude reads it', async () => {
  await clearSelection()
  const asked = await agent('act', { steps: [{ ref: 'Questions list', action: 'ask', args: ['How many are coming?', 'About 25', 'Shared plan'] }] })
  assert.equal(asked.output.ok, true)
  const box = page.getByRole('textbox', { name: 'Answer: How many are coming?' })
  assert.ok(await until(async () => (await box.count()) === 1), 'the Questions card came onto the board, with the question')
  assert.equal(await box.getAttribute('placeholder'), 'About 25', 'the guess, in grey where the answer goes')
  await box.fill('40')
  // the arrow in the box keeps it (Enter does too)
  await page.getByRole('button', { name: 'Save the answer' }).first().click()
  const read = async () => {
    const o = (await agent('act', { steps: [{ ref: 'Questions list', action: 'read' }] })).output
    return o.steps?.[0]?.result || []
  }
  assert.ok(await until(async () => (await read()).some(q => q.question === 'How many are coming?' && q.answer === '40' && q.state === 'answered')), 'Claude reads the answer')

  await agent('act', { steps: [{ ref: 'Questions list', action: 'ask', args: ['Which room?', 'The big one'] }] })
  await page.getByRole('button', { name: 'Use the guess' }).click()
  assert.ok(await until(async () => (await read()).some(q => q.question === 'Which room?' && q.answer === 'The big one')), 'the guess taken as the answer')

  // choices: buttons to pick from, the guess marked
  await agent('act', { steps: [{ ref: 'Questions list', action: 'ask', args: ['Which day?', 'Friday', '', ['Thursday', 'Friday', 'Saturday']] }] })
  const friday = page.getByRole('button', { name: /^Friday/ })
  assert.ok(await until(async () => (await friday.count()) === 1), 'the choices, as buttons')
  assert.match(await friday.innerText(), /Claude's guess/)
  await page.getByRole('button', { name: 'Saturday' }).click()
  assert.ok(await until(async () => (await read()).some(q => q.question === 'Which day?' && q.answer === 'Saturday' && q.choices?.length === 3)), 'picked')

  // taking a question away waits for Allow, the Questions card framed meanwhile
  const gone = agent('act', { steps: [{ ref: 'Questions list', action: 'remove', args: ['Which day?'] }] })
  assert.ok(await until(async () => (await page.locator('.agent-frame', { hasText: 'Claude · wants to remove' }).count()) === 1), 'framed while it waits')
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  assert.equal((await gone).output.ok, true)

  // several in one call: one question for all of them, before any runs; not allowed, none run
  const two = [{ ref: 'Questions list', action: 'remove', args: ['How many are coming?'] }, { ref: 'Questions list', action: 'remove', args: ['Which room?'] }]
  const left = async () => (await api('/api/questions')).map(q => q.question)
  const refused = agent('act', { steps: two })
  assert.ok(await until(async () => /Claude wants to do 2 things/.test(await page.locator('body').innerText())), 'one question for both')
  const no = (await refused).output
  assert.equal(no.ok, false, 'not allowed (it timed out): nothing ran')
  assert.match(no.error?.message || '', /Nobody pressed Allow/, 'Claude is told nobody answered, not only "refused"')
  assert.ok((await left()).includes('How many are coming?') && (await left()).includes('Which room?'))
  const both = agent('act', { steps: two })
  const all = page.getByRole('button', { name: 'Allow all' })
  assert.ok(await until(async () => (await all.count()) === 1), 'Allow all')
  assert.ok((await all.boundingBox()).height <= 30, '"Allow all" on one line')
  await all.click()
  assert.equal((await both).output.ok, true)
  assert.ok(await until(async () => !(await left()).some(q => q === 'How many are coming?' || q === 'Which room?')), 'both gone, one Allow')
  await page.locator('.react-flow__node-questions').evaluate(el => el.scrollIntoView())
})

test('a chat listening for the board shows on the pill; Tell Claude wakes it with what was typed', async () => {
  await clearSelection()
  // what scripts/wait-ping.mjs does: an open request, answered when the user pings
  const waiting = fetch(`${base}/api/agent/wait?label=${encodeURIComponent('Claude · e2e')}`, { headers: H }).then(r => r.json())
  // (the pill says "Claude is listening", or, in the half minute after Claude worked, that it did; the button either way)
  const tell = page.locator('.agent-pill.is-shown').getByRole('button', { name: 'Tell Claude' })
  assert.ok(await until(async () => (await tell.count()) === 1), 'the pill has a Tell Claude button')
  // changed your mind: the close button sends nothing and leaves Tell Claude there
  let woke = false
  waiting.then(() => (woke = true))
  await tell.click()
  await page.getByRole('textbox', { name: /Tell Claude/ }).fill('never mind')
  await page.getByRole('button', { name: 'Close without telling Claude' }).click()
  assert.equal(await tell.count(), 1, 'Tell Claude is back')
  await page.waitForTimeout(400)
  assert.equal(woke, false, 'nothing was sent')
  await tell.click()
  await page.getByRole('textbox', { name: /Tell Claude/ }).fill('Have a look at my plan')
  await page.keyboard.press('Enter')
  const got = await waiting
  assert.equal(got.ping?.text, 'Have a look at my plan')
  assert.ok(await until(async () => (await page.getByRole('button', { name: 'Tell Claude' }).count()) === 0), 'no one listening now: no button')
})

// last: a pasted card lands where the mouse is, on the empty spot the other tests use
test('pasting: a link becomes a card, Ctrl+Shift+V keeps one on Later, a short password goes to Snippets', async () => {
  await clearSelection()
  const paste = text =>
    page.evaluate(t => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    }, text)
  const items = () => page.locator('.react-flow__node-item').count()

  const n0 = await items()
  await paste(`${base}/api/health?card`)
  assert.ok(await until(async () => (await items()) === n0 + 1, 15000), 'a card')

  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyV')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await paste(`${base}/api/health?later`)
  const kept = await until(async () => (await api('/api/shown')).find(e => /later$/.test(e.url || '') && e.later === 'todo'))
  assert.ok(kept, 'kept on Later')
  assert.equal(await items(), n0 + 1, 'no card for it')

  await paste('nkC6Hsyvm8UnRe')
  const secret = await until(async () => (await api('/api/snippets')).find(s => s.secret))
  assert.ok(secret, 'kept in Snippets as a secret')
})

test('Ctrl+K shows a few recent things, Show more opens up the rest, and typing searches all of them', async () => {
  await clearSelection()
  // a long history: 30 kept links, the oldest first
  for (let i = 1; i <= 30; i++) {
    await api('/api/shown', { method: 'POST', body: JSON.stringify({ url: `${base}/api/health?kept${i}`, title: `Kept page ${String(i).padStart(2, '0')}${i === 1 ? ' zebra' : ''}` }) })
    await new Promise(r => setTimeout(r, 15))
  }
  const box = page.locator('[cmdk-root]')
  const group = box.locator('[cmdk-group]', { hasText: /^Kept/ })
  const rows = () => group.locator('[cmdk-item]:not([data-value^="__more"])').count()
  const moreRow = group.locator('[cmdk-item][data-value^="__more"]')
  await until(async () => (await api('/api/shown')).length >= 30)
  await page.keyboard.press('Control+KeyK')
  assert.ok(await until(async () => (await rows()) === 6, 8000), 'six recent kept things, not the whole history')
  assert.match(await moreRow.innerText(), /Show 20 more/)
  await moreRow.click()
  assert.ok(await until(async () => (await rows()) === 26), 'twenty more after Show more')

  // the oldest one is far past what is shown, and typing finds it
  const input = box.locator('[cmdk-input]')
  assert.ok(await until(() => input.evaluate(el => el === document.activeElement), 2000), 'the search box keeps the keys after Show more')
  await page.keyboard.type('zebra')
  const found = await until(async () => (await rows()) === 1 && /Kept page 01 zebra/.test(await group.innerText()))
  assert.ok(found, `found by searching all of them; typed "${await input.inputValue()}", shown: ${(await box.innerText()).slice(0, 300)}`)
  await page.keyboard.press('Escape')
})

test('many tucked cards: as many tabs as fit, the rest under "N more", found and brought back from its list', async () => {
  await clearSelection()
  for (let i = 1; i <= 16; i++) await agent('act', { steps: [{ ref: 'Board', action: 'addSticky', args: [`Parked idea ${i}

for later`] }] })
  let lastTuck
  for (let i = 1; i <= 16; i++) {
    let r
    for (let k = 0; k < 20; k++) {
      r = await agent('act', { steps: [{ ref: `Parked idea ${i}`, action: 'tuck' }] })
      if (r.output?.ok !== false) break
      await new Promise(res => setTimeout(res, 150))
    }
    lastTuck = r
  }
  const shown = page.locator('.tuck-tray .tuck-tab:not(.is-over):not(.tuck-more)')
  const more = page.locator('.tuck-tray .tuck-more')
  assert.ok(await until(async () => (await more.count()) === 1, 8000), `an N more tab; tabs: ${await page.locator('.tuck-tray .tuck-tab').count()}, notes: ${await page.locator('.react-flow__node-note').count()}, last: ${JSON.stringify(lastTuck).slice(0, 300)}`)
  const n = await shown.count()
  assert.ok(n > 0 && n < 16, `some tabs fit across, not all (${n})`)
  const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.tuck-tray .tuck-tab:not(.is-over)')].map(t => t.getBoundingClientRect().right)))
  assert.ok(right <= 1400, 'nothing runs off the screen')
  assert.match(await more.innerText(), new RegExp(`${16 - n} more`))

  await more.click()
  const rows = page.locator('.tuck-row')
  assert.equal(await rows.count(), 16 - n, 'the rest, listed')
  // a long list has a search box
  if (16 - n > 7) {
    await page.locator('.tuck-search').fill('idea 16')
    assert.ok(await until(async () => (await rows.count()) === 1), 'found by its title')
  }
  await rows.filter({ hasText: 'Parked idea 16' }).click()
  assert.ok(await until(async () => (await page.locator('.react-flow__node-note', { hasText: 'Parked idea 16' }).count()) === 1), 'brought back to the board')
  await page.keyboard.press('Escape')
})

test('put away on the shelf: until when, off the board and the tray, listed with its day, back on its day or by hand', async () => {
  await clearSelection()
  await agent('act', { steps: [{ ref: 'Board', action: 'addSticky', args: ['Team call notes\n\nfor the 27th'] }] })
  const card = note('Team call notes')
  assert.ok(await until(async () => (await card.count()) === 1, 8000), 'the card')
  await agent('act', { steps: [{ ref: 'Team call notes', action: 'focus' }] })
  await page.waitForTimeout(500)
  // (it may sit partly above the window: bring it down)
  const box = await card.boundingBox()
  if (box && box.y < 80) {
    await page.mouse.move(700, 600)
    await page.mouse.wheel(0, box.y - 160)
    await page.waitForTimeout(400)
  }
  await card.click({ button: 'right', position: { x: 60, y: 14 } })
  await page.getByRole('menuitem', { name: 'Put on the shelf…' }).click()
  await page.getByRole('button', { name: /^In two weeks/ }).click()
  assert.ok(await until(async () => (await card.isHidden())), 'off the board')
  const shelfTab = page.locator('.shelf-corner')
  assert.ok(await until(async () => /Shelf\s*1/.test(await shelfTab.innerText().catch(() => ''))), 'the shelf tab counts it')
  assert.equal(await page.locator('.tuck-tray .tuck-tab', { hasText: 'Team call notes' }).count(), 0, 'not among the tucked tabs')
  await shelfTab.click()
  const row = page.locator('.shelf-row', { hasText: 'Team call notes' })
  assert.match(await row.innerText(), /back /, 'says the day it comes back')
  await page.keyboard.press('Escape')

  // its day comes (the clock moved on 15 days): back in the tray at the top, off the shelf
  await page.evaluate(() => {
    const real = (window.__realNow = Date.now)
    Date.now = () => real() + 15 * 86_400_000
    dispatchEvent(new Event('focus'))
  })
  assert.ok(await until(async () => (await page.locator('.tuck-tray .tuck-tab', { hasText: 'Team call notes' }).count()) === 1), 'back in the tray')
  assert.equal(await shelfTab.count(), 0, 'the shelf is empty')
  // (the tray may be full from the test before: then it's under N more)
  const tab = page.locator('.tuck-tray .tuck-tab', { hasText: 'Team call notes' })
  if (await tab.evaluate(el => el.classList.contains('is-over'))) {
    await page.locator('.tuck-tray .tuck-more').click()
    await page.locator('.tuck-row', { hasText: 'Team call notes' }).click()
    await page.keyboard.press('Escape')
  } else await tab.click()
  assert.ok(await until(async () => (await card.isVisible())), 'and on the board again')

  // put away with no day, and brought back from the shelf's list
  await card.click({ button: 'right', position: { x: 60, y: 14 } })
  await page.getByRole('menuitem', { name: 'Put on the shelf…' }).click()
  await page.getByRole('button', { name: 'Until I bring it back' }).click()
  await until(async () => (await shelfTab.count()) === 1)
  await shelfTab.click()
  await page.locator('.shelf-row', { hasText: 'Team call notes' }).click()
  assert.ok(await until(async () => (await card.isVisible())), 'brought back by hand')
  // the saved board keeps it as it is now: on the board, not on the shelf
  const saved = (await api('/api/board')).cards.find(c => c.type === 'note' && /team-call|Team call/i.test(c.ref + (c.title || '')))
  assert.ok(!saved || !saved.shelf, 'not on the shelf in the saved board')

  // Claude puts it on the shelf for three days, and brings it back
  await page.evaluate(() => {
    Date.now = window.__realNow
    dispatchEvent(new Event('focus'))
  })
  const r1 = await agent('act', { steps: [{ ref: 'Team call notes', action: 'putOnShelf', args: [3] }] })
  assert.notEqual(r1.output?.ok, false, JSON.stringify(r1).slice(0, 200))
  assert.ok(await until(async () => (await shelfTab.count()) === 1 && (await card.isHidden())), 'Claude put it on the shelf')
  assert.ok(await until(async () => (await api('/api/board')).cards.find(c => c.shelf)?.shelf?.until > Date.now() + 2 * 86_400_000), 'back in about three days')
  await agent('act', { steps: [{ ref: 'Team call notes', action: 'bringBack' }] })
  assert.ok(await until(async () => await card.isVisible()), 'and brought back')
})

test('a page Claude makes keeps what is typed and ticked in it, after the board reloads; Claude reads it back', async () => {
  await clearSelection()
  const html = `<style>body{font:16px sans-serif;padding:12px}</style>
    <label>People <input id="people" type="number" value="1"></label>
    <label>Cost <input id="cost" type="number" value="0"></label>
    <label><input id="paid" type="checkbox"> Paid</label>
    <p>Each: <b id="each">0</b></p>
    <ul id="list"></ul>
    <button id="add" type="button">Add</button>
    <script>
      const calc = () => (document.getElementById('each').textContent = (Number(cost.value) / Math.max(1, Number(people.value))).toFixed(2))
      document.addEventListener('input', calc)
      calc()
      const draw = () => (document.getElementById('list').innerHTML = (cockpit.get('items') || []).map((x, i) => '<li><input type="checkbox" id="it-' + i + '"> ' + x + '</li>').join(''))
      document.getElementById('add').onclick = () => { cockpit.set('items', [...(cockpit.get('items') || []), 'Item ' + ((cockpit.get('items') || []).length + 1)]); draw() }
      addEventListener('cockpit-ready', draw)
    </script>`
  const r = await agent('act', { steps: [{ ref: 'Board', action: 'addPage', args: ['Trip splitter', html] }] })
  assert.notEqual(r.output?.ok, false, JSON.stringify(r).slice(0, 300))
  const card = page.locator('.react-flow__node-item', { hasText: 'Trip splitter' })
  assert.ok(await until(async () => (await card.count()) === 1, 10000), `the page is on the board; items: ${JSON.stringify(await page.locator('.react-flow__node-item').allInnerTexts()).slice(0, 400)}; shown: ${JSON.stringify((await api('/api/shown')).slice(0, 3).map(e => [e.title, e.path]))}; r: ${JSON.stringify(r).slice(0, 200)}`)
  // (earlier tests leave cards about: bring it into view, alone)
  await agent('act', { steps: [{ ref: 'Board', action: 'focusOn', args: [['Trip splitter']] }] })
  await page.waitForTimeout(600)
  const frame = card.frameLocator('iframe')
  await frame.locator('#people').fill('4')
  await frame.locator('#cost').fill('300')
  await frame.locator('#paid').click()
  await frame.locator('#add').click()
  await frame.locator('#add').click()
  // a checkbox the page drew itself, after it loaded
  await frame.locator('#it-1').click()
  assert.equal(await frame.locator('#each').innerText(), '75.00')
  // kept by the board (a moment for the page to say so)
  const entry = async () => (await api('/api/shown')).find(e => e.title === 'Trip splitter')
  assert.ok(
    await until(async () => {
      const st = (await entry())?.pageState
      return st?.fields?.['#cost'] === '300' && st?.fields?.['#paid'] === true && st?.data?.items?.length === 2 && st?.fields?.['#it-1'] === true
    }, 5000),
    'saved with the card',
  )

  await agent('act', { steps: [{ ref: 'Board', action: 'bringBack' }] })
  await page.reload()
  const again = page.locator('.react-flow__node-item', { hasText: 'Trip splitter' }).frameLocator('iframe')
  assert.ok(await until(async () => (await again.locator('#cost').inputValue().catch(() => '')) === '300', 15000), 'the cost is back')
  assert.equal(await again.locator('#people').inputValue(), '4')
  assert.equal(await again.locator('#paid').isChecked(), true)
  assert.equal(await again.locator('#each').innerText(), '75.00', 'and the page worked it out again')
  assert.equal(await again.locator('#list li').count(), 2, 'what the page kept itself')
  assert.ok(await until(async () => await again.locator('#it-1').isChecked()), 'a field drawn later gets its tick back too')
  assert.equal(await again.locator('#it-0').isChecked(), false)

  const read = await agent('act', { steps: [{ ref: 'Trip splitter', action: 'read' }] })
  const typed = read.output?.steps?.[0]?.result?.typed
  assert.equal(typed?.fields?.['#people'], '4', `Claude reads what's typed: ${JSON.stringify(read).slice(0, 300)}`)
  assert.deepEqual(typed?.data?.items, ['Item 1', 'Item 2'])
})

test('a table tucked away: Claude adds to it and fills a cell, each once, answered at once', async () => {
  await clearSelection()
  const made = await agent('act', { steps: [{ ref: 'Board', action: 'addTable', args: ['Roadmap test', [['Feature', 'Status'], ['Arrows', 'Done']]] }] })
  assert.notEqual(made.output?.ok, false, JSON.stringify(made).slice(0, 300))
  assert.ok(await until(async () => (await page.locator('.react-flow__node-table', { hasText: 'Roadmap test' }).count()) === 1, 8000), 'the table')
  // in a section, and the section tucked away (as the user had it)
  const sec = await agent('act', { steps: [{ ref: 'Board', action: 'addSection', args: ['Roadmap', ['Roadmap test']] }] })
  assert.notEqual(sec.output?.ok, false, JSON.stringify(sec).slice(0, 300))
  const tuck = await agent('act', { steps: [{ ref: 'Board', action: 'tuckSection', args: ['Roadmap', true] }] })
  assert.notEqual(tuck.output?.ok, false, JSON.stringify(tuck).slice(0, 300))
  // the window minimised: the page hidden, and its timers slowed right down, as the browser does to a hidden page
  await page.evaluate(() => {
    const st = window.setTimeout
    window.__fastSetTimeout = st
    window.setTimeout = (f, ms, ...a) => st(f, Math.max(Number(ms) || 0, 20000), ...a)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
  })
  const t0 = Date.now()
  const r = await agent('act', { steps: [{ ref: 'Roadmap test', action: 'addRows', args: [[['Shelf', 'Done']]] }, { ref: 'Roadmap test', action: 'setCell', args: ['Arrows', 'Status', 'Done · 0.2.9'] }] })
  const took = Date.now() - t0
  assert.notEqual(r.output?.ok, false, JSON.stringify(r).slice(0, 300))
  assert.ok(took < 8000, `answered at once, though hidden (took ${took} ms)`)
  // and the page's own timers back once it's answered
  assert.ok(await page.evaluate(() => String(window.setTimeout).includes('20000')), "the page's timers are its own again")
  await page.evaluate(() => {
    window.setTimeout = window.__fastSetTimeout
    delete document.hidden
  })
  const read = await agent('act', { steps: [{ ref: 'Roadmap test', action: 'read' }] })
  assert.deepEqual(read.output?.steps?.[0]?.result?.rows, [['Feature', 'Status'], ['Arrows', 'Done · 0.2.9'], ['Shelf', 'Done']], 'each change made once')
})

test('Claude sees cards on top of each other, a section lays them out, a whole section goes on the shelf in one step, and a dialog hides nothing', async () => {
  await clearSelection()
  const made = await agent('act', { steps: ['Lay A', 'Lay B', 'Lay C'].map(t => ({ ref: 'Board', action: 'addSticky', args: [t] })) })
  assert.equal(made.output.ok, true, JSON.stringify(made).slice(0, 300))
  // (just after a reload the window isn't answering yet: nothing)
  const snap = async () => {
    const o = (await agent('snapshot')).output
    return Array.isArray(o) ? o : []
  }
  const boardOf = async () => (await snap()).find(c => c.component === 'board')?.value
  const card = async t => (await snap()).find(c => c.label === t)?.value
  assert.ok(await until(async () => !!(await card('Lay C'))), 'made')
  await page.waitForTimeout(1500)

  // two of them put on top of each other (as Claude's first layout left the user's board), the board reloaded
  const b = await api('/api/board')
  const notesNow = b.cards.filter(c => c.type === 'note').slice(-3)
  const spots = [[5000, 5000], [5040, 5030], [5000, 5700]]
  notesNow.forEach((c, i) => Object.assign(c, { x: spots[i][0], y: spots[i][1] }))
  await api('/api/board', { method: 'PUT', body: JSON.stringify(b) })
  await page.reload()
  assert.ok(await until(async () => (await card('Lay B'))?.overlaps?.includes('Lay A'), 15000), 'a card says what it lies on top of')
  assert.ok((await boardOf()).overlapping?.some(p => p.includes('"Lay A"') && p.includes('"Lay B"')), 'the board lists the pair')
  assert.equal((await card('Lay C'))?.overlaps, undefined, 'one apart from them overlaps nothing')

  // a section round them lays them out in rows: nothing on top of anything, nothing sticking out
  const sec = await agent('act', { steps: [{ ref: 'Board', action: 'addSection', args: ['Lay out', ['Lay A', 'Lay B', 'Lay C']] }] })
  assert.equal(sec.output.ok, true, JSON.stringify(sec).slice(0, 300))
  assert.equal(sec.output.layout, undefined, `nothing overlaps once it's made: ${JSON.stringify(sec.output.layout)}`)
  const v = await boardOf()
  assert.ok(!v.overlapping?.some(p => p.includes('Lay ')) && !v.stickingOut?.some(p => p.includes('Lay ')), 'laid out inside it')

  // the dialog the user opens (Settings) doesn't hide the board from Claude
  await page.getByRole('button', { name: /^Settings/ }).click()
  assert.ok(await until(async () => (await page.getByRole('dialog').count()) > 0), 'a dialog open')
  const behind = await snap()
  assert.ok(behind.some(c => c.component === 'board') && behind.some(c => c.label === 'Lay A'), 'Claude still sees the board behind it')
  await page.keyboard.press('Escape')

  // the whole section on the shelf, in one step: Claude sees it there, and its cards say so
  const shelf = await agent('act', { steps: [{ ref: 'Board', action: 'putSectionOnShelf', args: ['Lay out', 3] }] })
  assert.equal(shelf.output.ok, true, JSON.stringify(shelf).slice(0, 300))
  assert.ok(await until(async () => /^Lay out \(until /.test((await boardOf())?.shelvedSections?.[0] || '')), 'the board lists it on the shelf, with its day')
  assert.match((await card('Lay A'))?.onShelf || '', /^until /, 'its cards say they are on the shelf')
  const saved = async () => (await api('/api/board')).cards.find(c => c.type === 'section' && c.title === 'Lay out')
  assert.ok(await until(async () => { const s = await saved(); return s?.tucked && s?.shelf?.until > Date.now() }), 'kept on the shelf, with its day (once saved)')

  // tidy(section) after it's back: the same rows
  assert.equal((await agent('act', { steps: [{ ref: 'Board', action: 'tuckSection', args: ['Lay out', false] }] })).output.ok, true)
  const t = await agent('act', { steps: [{ ref: 'Board', action: 'tidy', args: ['Lay out'] }] })
  assert.equal(t.output.ok, true, JSON.stringify(t).slice(0, 300))
  assert.equal(t.output.layout, undefined)
  await clearSelection()
})

// after the last: a card made and taken off (making one moves the view)
test("a card taken off isn't in what Claude sees any more", async () => {
  await clearSelection()
  const made = await agent('act', { steps: [{ ref: 'Board', action: 'addSticky', args: ['Gone soon'] }] })
  assert.equal(made.output.ok, true)
  const titles = async () => (await agent('snapshot')).output.filter(c => c.component === 'card').map(c => c.label)
  assert.ok(await until(async () => (await titles()).includes('Gone soon')), 'there')
  const off = agent('act', { steps: [{ ref: 'Gone soon', action: 'remove' }] })
  const allow = page.getByRole('button', { name: 'Allow', exact: true })
  assert.ok(await until(async () => (await allow.count()) === 1))
  await allow.click()
  assert.equal((await off).output.ok, true)
  assert.ok(await until(async () => !(await titles()).includes('Gone soon')), 'not listed, not even as off the page')
  assert.deepEqual((await agent('query', { text: 'Gone soon' })).output, [], 'not found either')
})
