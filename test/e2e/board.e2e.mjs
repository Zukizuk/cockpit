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
  const order = ['Open full screen', 'Comment', 'Roll up into its strip', 'Lock in place', 'Stop sharing with agents', 'Move to Work', 'Remove from board']
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
  for (const l of ['Open full screen', 'Roll up into its strip', 'Focus on this card', 'Tuck away at the top', 'Lock in place', 'Hide its contents']) assert.ok(!viaButton.includes(l), `${l} is not`)
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
  for (const l of ['Fold these 2', 'Tuck these 2 away at the top', 'Lock these 2 in place', 'Hide their contents', 'Archive these 2 notes', 'Remove these 2 from board'])
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
  await page.keyboard.type('Ideas')
  await page.keyboard.press('Enter')
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
  await page.keyboard.type('Plan')
  await page.keyboard.press('Enter')
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

  await clearSelection()
  await removeSection('Plan')
  assert.ok(await until(async () => (await sections()).length === 0), 'its cards stay when it goes')
  assert.ok((await board()).cards.some(c => c.id === 'plain'))
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
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
